import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer
} from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

import type { AppConfig } from "@shape-of-you/config";
import { buildApp, getFastifyInstance } from "../src/app.js";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import {
  assertRecoveryErasureManifestComplete,
  exportRecoveryErasureManifest
} from "../src/recovery/recovery-erasure-manifest.js";
import { RecoveryRepository } from "../src/storage/recovery-repository.js";
import { IntegrationRepository } from "../src/storage/integration-repository.js";
import { TrainingRepository } from "../src/storage/training-repository.js";
import { ConnectionCredentialCipher } from "../src/integrations/credential-cipher.js";
import { FakeHealthDataProvider } from "../src/integrations/fake-provider.js";
import { IntegrationService } from "../src/integrations/integration.service.js";
import { SyntheticPersonContext } from "../src/application/person-context.js";

let container: StartedPostgreSqlContainer;
let database: DatabaseContext;
let app: NestFastifyApplication;
let repository: RecoveryRepository;
let databaseUrl: string;

const personA = "00000000-0000-4000-8000-000000000001";
const personB = "00000000-0000-4000-8000-000000000002";
const personC = "00000000-0000-4000-8000-000000000003";
const personD = "00000000-0000-4000-8000-000000000004";

async function acknowledgeAcceptedErasure(requestId: string): Promise<void> {
  await database.pool.query(
    "update recovery_erasure_requests set journal_accepted_at = now() where id = $1",
    [requestId]
  );
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_recovery_test")
    .withUsername("shape_of_you")
    .withPassword("shape_of_you")
    .start();
  databaseUrl = container.getConnectionUri();
  const config: AppConfig = {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 3_000,
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: "silent",
    PERSON_CONTEXT_MODE: "synthetic",
    SYNTHETIC_PERSON_ID: personA,
    SHUTDOWN_TIMEOUT_MS: 1_000
  };
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = personA;
  await runMigrations(databaseUrl);
  database = createDatabase(config);
  await database.pool.query(
    "insert into persons (id, kind, status) values ($1, 'real', 'active'), ($2, 'real', 'active'), ($3, 'real', 'active')",
    [personB, personC, personD]
  );
  repository = new RecoveryRepository(database);
  app = await buildApp({ config, database });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await database?.pool.end();
  await container?.stop();
});

describe("Recovery PostgreSQL vertical", () => {
  it("imports account wellness through IntegrationService with no-op, A-B-A, field removal and disconnect stop", async () => {
    const integrations = new IntegrationRepository(database);
    const training = new TrainingRepository(database);
    const provider = new FakeHealthDataProvider();
    const cipher = new ConnectionCredentialCipher("v1", new Map([["v1", randomBytes(32)]]));
    const id = "00000000-0000-4000-8000-000000000121";
    const recoveryConnectionId = "00000000-0000-4000-8000-000000000122";
    const consentId = "00000000-0000-4000-8000-000000000123";
    const credential = cipher.encrypt("wellness-token", `intervals_icu:${personD}:${id}`);
    await integrations.activate({ id, recoveryConnectionId, consentId, personId: personD, externalUserId: "athlete-d", credential, authorizationStartedAt: new Date(Date.now() - 1_000) });
    const service = new IntegrationService(new SyntheticPersonContext(personD), integrations, provider, cipher, repository, training);
    const connection = (await integrations.findActive(personD))!;
    const wellness = { identity: "2026-09-06", localDate: "2026-09-06", timezone: "UTC", totalSleepMinutes: 400, sleepScore: null, restingHeartRate: null, hrvRmssd: null, bodyBattery: null };

    provider.reconciliation = { wellness: [wellness], activities: [] };
    await service.reconcileConnection(connection);
    await service.reconcileConnection(connection);
    provider.reconciliation = { wellness: [{ ...wellness, totalSleepMinutes: 450 }], activities: [] };
    await service.reconcileConnection(connection);
    provider.reconciliation = { wellness: [wellness], activities: [] };
    await service.reconcileConnection(connection);
    await service.reconcileConnection(connection);
    provider.reconciliation = { wellness: [{ ...wellness, totalSleepMinutes: null }], activities: [] };
    await service.reconcileConnection(connection);

    const history = await database.pool.query<{ count: string; withdrawals: string }>(
      "select count(*)::text as count, count(withdrawn_at)::text as withdrawals from recovery_observations where person_id = $1 and connection_id = $2",
      [personD, recoveryConnectionId]
    );
    expect(history.rows[0]).toEqual({ count: "4", withdrawals: "1" });
    expect((await repository.listObservations(personD, { limit: 50 })).items).toHaveLength(0);
    await integrations.beginDisconnect(personD, "test disconnect");
    provider.reconciliation = { wellness: [{ ...wellness, totalSleepMinutes: 500 }], activities: [] };
    await service.reconcileConnection(connection);
    expect((await database.pool.query("select 1 from recovery_observations where person_id = $1", [personD])).rowCount).toBe(4);

    await database.pool.query("update integration_connections set next_attempt_at = now() - interval '1 second' where id = $1", [id]);
    const firstRetry = await integrations.claimRemoteDisconnectDue("worker-timeout", 30_000);
    expect(firstRetry?.id).toBe(id);
    provider.nextFailure = "provider_timeout";
    await service.retryRemoteDisconnect(firstRetry!);
    expect(await integrations.status(personD)).toMatchObject({ lifecycle: "disconnected", failureCode: "provider_timeout" });
    await database.pool.query("update integration_connections set next_attempt_at = now() - interval '1 second' where id = $1", [id]);
    const secondRetry = await integrations.claimRemoteDisconnectDue("worker-retry", 30_000);
    expect(secondRetry?.id).toBe(id);
    await service.retryRemoteDisconnect(secondRetry!);
    expect(await integrations.claimRemoteDisconnectDue("worker-finished", 30_000)).toBeNull();
    expect(await integrations.status(personD)).toMatchObject({ lifecycle: "disconnected", failureCode: null });
    const erasure = await repository.requestErasure(personD, recoveryConnectionId, "person-d-erasure", "retention_expired", null);
    expect(erasure.status).toBe("pending");
    await expect(integrations.activate({ id, recoveryConnectionId, consentId: "00000000-0000-4000-8000-000000000124", personId: personD, externalUserId: "athlete-d", credential, authorizationStartedAt: new Date() }))
      .rejects.toThrow("erasure must complete");
  });

  it("persists encrypted Intervals state and immutable activity corrections", async () => {
    const integrations = new IntegrationRepository(database);
    const training = new TrainingRepository(database);
    const id = "00000000-0000-4000-8000-000000000111";
    const recoveryConnectionId = "00000000-0000-4000-8000-000000000112";
    const consentId = "00000000-0000-4000-8000-000000000113";
    const cipher = new ConnectionCredentialCipher("v1", new Map([["v1", randomBytes(32)]]));
    const credential = cipher.encrypt("opaque-provider-token", `intervals_icu:${personC}:${id}`);

    await integrations.createAuthorization(personC, "a".repeat(64), "/connections", new Date(Date.now() + 60_000));
    expect(await integrations.consumeAuthorization("a".repeat(64), new Date())).toMatchObject({ personId: personC, returnTo: "/connections" });
    expect(await integrations.consumeAuthorization("a".repeat(64), new Date())).toBeNull();
    await integrations.createAuthorization(personC, "d".repeat(64), "/connections", new Date(Date.now() - 1));
    expect(await integrations.consumeAuthorization("d".repeat(64), new Date())).toBeNull();
    await integrations.activate({ id, recoveryConnectionId, consentId, personId: personC, externalUserId: "athlete-c", credential, authorizationStartedAt: new Date(Date.now() - 1_000) });
    expect(await integrations.status(personC)).toMatchObject({ lifecycle: "active", recoveryConnectionId });

    const connection = await integrations.findActive(personC);
    expect(connection).not.toBeNull();
    const activity = {
      identity: "activity-c", occurredAt: "2026-09-07T06:00:00.000Z", localDate: "2026-09-07", timezone: "UTC",
      name: "Run", durationSeconds: 3600, distanceMeters: 10_000, trainingLoad: 80,
      averageHeartRate: 145, maximumHeartRate: 175, deviceName: "Garmin Test", garminAttributed: true
    };
    const trainingInput = (value: typeof activity, checksum: string) => ({
      connectionId: connection!.id, personId: connection!.personId, providerIdentity: value.identity,
      normalizedChecksum: checksum, occurredAt: value.occurredAt, localDate: value.localDate, timezone: value.timezone,
      name: value.name, durationSeconds: value.durationSeconds, distanceMeters: value.distanceMeters,
      trainingLoad: value.trainingLoad, averageHeartRate: value.averageHeartRate, maximumHeartRate: value.maximumHeartRate,
      deviceName: value.deviceName, sourceProvider: "intervals_icu", garminAttributed: value.garminAttributed
    });
    expect(await training.importExternalActivity(trainingInput(activity, "b".repeat(64)))).toBe("created");
    expect(await training.importExternalActivity(trainingInput(activity, "b".repeat(64)))).toBe("unchanged");
    expect(await training.importExternalActivity(trainingInput({ ...activity, durationSeconds: 3660 }, "c".repeat(64)))).toBe("corrected");
    expect(await training.importExternalActivity(trainingInput(activity, "b".repeat(64)))).toBe("corrected");
    const rows = await database.pool.query<{ count: string; garmin: boolean }>(
      "select count(*)::text as count, bool_and(garmin_attributed) as garmin from integration_activity_facts where connection_id = $1",
      [id]
    );
    expect(rows.rows[0]).toEqual({ count: "3", garmin: true });
    expect(await training.listExternalActivities(personC)).toHaveLength(1);

    const disconnect = await integrations.beginDisconnect(personC, "test disconnect");
    expect(disconnect?.id).toBe(id);
    expect(await integrations.status(personC)).toMatchObject({ lifecycle: "disconnected" });
    await expect(integrations.activate({ id, recoveryConnectionId, consentId: "00000000-0000-4000-8000-000000000114", personId: personC, externalUserId: "athlete-c", credential, authorizationStartedAt: new Date(0) }))
      .rejects.toThrow("superseded by disconnect");
    expect(await training.importExternalActivity(trainingInput({ ...activity, durationSeconds: 3_720 }, "e".repeat(64)))).toBe("stopped");
    expect((await database.pool.query("select 1 from integration_activity_facts where connection_id = $1", [id])).rowCount).toBe(3);
    await integrations.completeRemoteDisconnect(id);
    const erasure = await repository.requestErasure(personC, recoveryConnectionId, "activity-erasure", "retention_expired", null);
    await acknowledgeAcceptedErasure(erasure.id);
    const job = await repository.claimErasure("activity-erasure-worker", 30_000);
    await repository.completeErasure(job!);
    expect(await training.listExternalActivities(personC)).toHaveLength(0);
  });

  it("applies the additive Recovery migration on a clean schema", async () => {
    const clean = await database.pool.query<{ name: string | null }>(
      `select to_regclass('public.recovery_observations')::text as name
       union all select to_regclass('public.recovery_assessments')::text
       union all select to_regclass('public.recovery_consents')::text`
    );
    expect(clean.rows.map((row) => row.name)).toEqual([
      "recovery_observations",
      "recovery_assessments",
      "recovery_consents"
    ]);
  });

  it("persists a wearable sleep score as an independent local-date fact", async () => {
    const created = await repository.createObservation(personA, {
      kind: "metric",
      observedFrom: null,
      observedUntil: null,
      temporalPrecision: "local_date",
      localDate: "2026-08-31",
      timezone: "Europe/Moscow",
      quality: "reliable",
      connectionId: null,
      consentId: null,
      dedupeKey: "manual:sleep-score:2026-08-31",
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: null
      },
      detail: { type: "metric", metric: "sleep_score", value: 86, unit: "score" }
    });
    const listed = await repository.listObservations(personA, {
      localDate: "2026-08-31"
    });

    expect(created.observation).toMatchObject({
      localDate: "2026-08-31",
      detail: { type: "metric", metric: "sleep_score", value: 86, unit: "score" }
    });
    expect(listed.items).toContainEqual(created.observation);
  });

  it("reuses shared device knowledge while isolating Person-owned connections", async () => {
    const first = await repository.registerDeviceModel({
      providerKey: "synthetic-provider",
      providerName: "Синтетический поставщик",
      modelKey: "synthetic-watch",
      version: 1,
      name: "Синтетические часы",
      capabilities: ["sleep", "metric", "subjective"]
    });
    const second = await repository.registerDeviceModel({
      providerKey: "synthetic-provider",
      providerName: "Синтетический поставщик",
      modelKey: "synthetic-watch",
      version: 1,
      name: "Синтетические часы",
      capabilities: ["sleep", "metric", "subjective"]
    });
    const connectionA = await repository.createConnection(personA, {
      deviceModelVersionId: first.id,
      label: "Часы A",
      dedupeKey: "watch:a"
    });
    const connectionB = await repository.createConnection(personB, {
      deviceModelVersionId: first.id,
      label: "Часы B",
      dedupeKey: "watch:b"
    });

    expect(second.id).toBe(first.id);
    expect(connectionA.device.modelVersion.id).toBe(connectionB.device.modelVersion.id);
    expect(connectionA.personId).not.toBe(connectionB.personId);
  });

  it("enforces consent, idempotency, correction history and Person isolation", async () => {
    const model = await repository.registerDeviceModel({
      providerKey: "consent-provider",
      providerName: "Поставщик согласия",
      modelKey: "sleep-band",
      version: 1,
      name: "Браслет сна",
      capabilities: ["sleep"]
    });
    const connection = await repository.createConnection(personA, {
      deviceModelVersionId: model.id,
      label: null,
      dedupeKey: "consent-connection"
    });
    const consent = await repository.grantConsent(personA, connection.id, {
      purpose: "Оценка восстановления",
      allowedKinds: ["sleep"],
      retentionMode: "until",
      retainUntil: "2027-01-01T00:00:00.000Z"
    });
    const input = {
      kind: "sleep" as const,
      observedFrom: "2026-10-24T22:00:00.000Z",
      observedUntil: "2026-10-25T06:00:00.000Z",
      timezone: "Europe/Berlin",
      quality: "reliable" as const,
      connectionId: connection.id,
      consentId: consent.id,
      dedupeKey: "device:sleep:2026-10-25",
      sourceReference: {
        channel: "device" as const,
        externalSystem: "synthetic-provider",
        externalRecordId: "sleep-2026-10-25",
        occurredAt: "2026-10-25T06:00:00.000Z"
      },
      detail: {
        type: "sleep" as const,
        totalSleepMinutes: 480,
        deepSleepMinutes: null,
        remSleepMinutes: null,
        lightSleepMinutes: null,
        sleepQuality: 4
      }
    };
    const concurrent = await Promise.all([
      repository.createObservation(personA, input),
      repository.createObservation(personA, input)
    ]);
    const created = concurrent.find((item) => item.created)!;
    const duplicate = concurrent.find((item) => !item.created)!;

    expect(concurrent.map((item) => item.created).sort()).toEqual([false, true]);
    expect(created.created).toBe(true);
    expect(duplicate).toMatchObject({ created: false, observation: { id: created.observation.id, localDate: "2026-10-25" } });
    expect(await repository.findObservation(personB, created.observation.id)).toBeNull();

    await repository.revokeConsent(personA, consent.id, { reason: "Проверка отзыва" });
    await expect(repository.createObservation(personA, {
      ...input,
      dedupeKey: "device:sleep:after-revoke",
      sourceReference: { ...input.sourceReference, externalRecordId: "after-revoke" }
    })).rejects.toThrow("not permitted");

    const manual = await repository.createObservation(personA, {
      ...input,
      connectionId: null,
      consentId: null,
      dedupeKey: "manual:sleep:1",
      sourceReference: { channel: "manual", externalSystem: null, externalRecordId: null, occurredAt: input.observedUntil }
    });
    const corrected = await repository.correctObservation(personA, manual.observation.id, {
      ...input,
      connectionId: null,
      consentId: null,
      dedupeKey: "manual:sleep:2",
      sourceReference: { channel: "manual", externalSystem: null, externalRecordId: null, occurredAt: input.observedUntil },
      detail: {
        type: "sleep",
        totalSleepMinutes: 420,
        deepSleepMinutes: null,
        remSleepMinutes: null,
        lightSleepMinutes: null,
        sleepQuality: 3
      },
      reason: "Исправлена длительность"
    });
    const history = await repository.observationHistory(personA, corrected.observation.id);
    expect(history?.items.map((item) => item.id)).toEqual([manual.observation.id, corrected.observation.id]);
  });

  it("quarantines a connection immediately and erases only its owned graph", async () => {
    const model = await repository.registerDeviceModel({
      providerKey: "erasure-provider",
      providerName: "Erasure provider",
      modelKey: "erasure-watch",
      version: 1,
      name: "Erasure watch",
      capabilities: ["metric"]
    });
    const connection = await repository.createConnection(personA, {
      deviceModelVersionId: model.id,
      label: "Disposable connection",
      dedupeKey: "erasure:connection"
    });
    const consent = await repository.grantConsent(personA, connection.id, {
      purpose: "Erasure integration test",
      allowedKinds: ["metric"],
      retentionMode: "until",
      retainUntil: "2027-01-01T00:00:00.000Z"
    });
    const deviceInput = {
      kind: "metric" as const,
      observedFrom: "2026-11-01T06:00:00.000Z",
      observedUntil: "2026-11-01T06:00:00.000Z",
      timezone: "Europe/Moscow",
      quality: "reliable" as const,
      connectionId: connection.id,
      consentId: consent.id,
      dedupeKey: "erasure:device:one",
      sourceReference: {
        channel: "device" as const,
        externalSystem: "erasure-provider",
        externalRecordId: "device-one",
        occurredAt: "2026-11-01T06:00:00.000Z"
      },
      detail: {
        type: "metric" as const,
        metric: "resting_heart_rate" as const,
        value: 55,
        unit: "bpm" as const
      }
    };
    const deviceObservation = await repository.createObservation(personA, deviceInput);
    const manualObservation = await repository.createObservation(personA, {
      ...deviceInput,
      connectionId: null,
      consentId: null,
      dedupeKey: "erasure:manual:one",
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: "2026-11-01T06:00:00.000Z"
      }
    });

    const request = await repository.requestErasure(
      personA,
      connection.id,
      "erasure:request:one",
      "user_request",
      "00000000-0000-4000-8000-000000000094"
    );
    const duplicate = await repository.requestErasure(
      personA,
      connection.id,
      "erasure:request:one",
      "user_request",
      "00000000-0000-4000-8000-000000000094"
    );

    expect(duplicate.id).toBe(request.id);
    expect((await repository.listConnections(personA)).items[0]).toMatchObject({
      id: connection.id,
      status: "disconnected"
    });
    expect((await repository.listConnections(personA)).items[0]?.erasureRequestedAt).not.toBeNull();
    expect(await repository.findObservation(personA, deviceObservation.observation.id)).toBeNull();
    expect(await repository.findObservation(personA, manualObservation.observation.id)).not.toBeNull();
    await expect(repository.createObservation(personA, {
      ...deviceInput,
      dedupeKey: "erasure:device:after-request",
      sourceReference: { ...deviceInput.sourceReference, externalRecordId: "after-request" }
    })).rejects.toThrow("not permitted");

    expect(await repository.claimErasure("integration-worker", 30_000)).toBeNull();
    await acknowledgeAcceptedErasure(request.id);
    const job = await repository.claimErasure("integration-worker", 30_000);
    expect(job).toMatchObject({ id: request.id, personId: personA, connectionId: connection.id });
    await repository.completeErasure(job!);

    expect(await repository.findErasureRequest(personA, request.id)).toMatchObject({
      status: "completed"
    });
    expect((await repository.listConnections(personA)).items).not.toContainEqual(
      expect.objectContaining({ id: connection.id })
    );
    expect(await repository.findObservation(personA, manualObservation.observation.id)).not.toBeNull();
    const retainedModel = await repository.registerDeviceModel({
      providerKey: "erasure-provider",
      providerName: "Erasure provider",
      modelKey: "erasure-watch",
      version: 1,
      name: "Erasure watch",
      capabilities: ["metric"]
    });
    expect(retainedModel.id).toBe(model.id);
    const erased = await database.pool.query<{ count: string }>(
      "select count(*)::text as count from recovery_observations where connection_id = $1",
      [connection.id]
    );
    expect(erased.rows[0]?.count).toBe("0");
    const manifest = await exportRecoveryErasureManifest(
      database.pool,
      () => new Date("2026-11-02T00:00:00.000Z")
    );
    expect(manifest.markers).toContainEqual({
      id: request.id,
      personId: personA,
      connectionId: connection.id,
      reason: "user_request",
      requestedAt: request.requestedAt
    });
  });

  it("enqueues expired exact retention once and leaves indefinite consent active", async () => {
    const model = await repository.registerDeviceModel({
      providerKey: "retention-provider",
      providerName: "Retention provider",
      modelKey: "retention-watch",
      version: 1,
      name: "Retention watch",
      capabilities: ["metric"]
    });
    const expired = await repository.createConnection(personA, {
      deviceModelVersionId: model.id,
      label: null,
      dedupeKey: "retention:expired"
    });
    const indefinite = await repository.createConnection(personA, {
      deviceModelVersionId: model.id,
      label: null,
      dedupeKey: "retention:indefinite"
    });
    await repository.grantConsent(personA, expired.id, {
      purpose: "Expired retention test",
      allowedKinds: ["metric"],
      retentionMode: "until",
      retainUntil: "2020-01-01T00:00:00.000Z"
    });
    await repository.grantConsent(personA, indefinite.id, {
      purpose: "Indefinite retention test",
      allowedKinds: ["metric"],
      retentionMode: "indefinite",
      retainUntil: null
    });

    expect(await repository.enqueueExpiredRetention(10)).toBe(1);
    expect(await repository.enqueueExpiredRetention(10)).toBe(0);
    expect((await repository.listConnections(personA)).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expired.id, status: "disconnected" }),
        expect.objectContaining({ id: indefinite.id, status: "active", erasureRequestedAt: null })
      ])
    );
    const expiredRequest = await database.pool.query<{ id: string }>(
      "select id from recovery_erasure_requests where connection_id = $1",
      [expired.id]
    );
    await acknowledgeAcceptedErasure(expiredRequest.rows[0]!.id);
    const claims = await Promise.all([
      repository.claimErasure("retention-worker-a", 30_000),
      repository.claimErasure("retention-worker-b", 30_000)
    ]);
    const claimed = claims.find((item) => item !== null)!;
    expect(claims.filter((item) => item !== null)).toHaveLength(1);
    expect(claimed.connectionId).toBe(expired.id);
    await repository.failErasure(claimed, "TRANSIENT_TEST_FAILURE", 0);
    const retried = await repository.claimErasure("retention-worker-c", 30_000);
    expect(retried?.id).toBe(claimed.id);
    await repository.completeErasure(retried!);
    expect((await repository.listConnections(personA)).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: indefinite.id, status: "active" })
      ])
    );
  });

  it("replays an independent marker idempotently without a request in the restored database", async () => {
    const model = await repository.registerDeviceModel({
      providerKey: "restore-provider",
      providerName: "Restore provider",
      modelKey: "restore-watch",
      version: 1,
      name: "Restore watch",
      capabilities: ["metric"]
    });
    const connection = await repository.createConnection(personA, {
      deviceModelVersionId: model.id,
      label: null,
      dedupeKey: "restore:connection"
    });
    const marker = {
      id: "00000000-0000-4000-8000-000000009400",
      personId: personA,
      connectionId: connection.id,
      reason: "user_request" as const,
      requestedAt: "2026-11-03T00:00:00.000Z"
    };

    await repository.replayErasureMarker(marker);
    await repository.replayErasureMarker(marker);

    expect((await repository.listConnections(personA)).items).not.toContainEqual(
      expect.objectContaining({ id: connection.id })
    );
    expect(await repository.findErasureRequest(personA, marker.id)).toBeNull();
  });

  it("replays a post-backup erasure into an isolated pre-erasure restore", async () => {
    const model = await repository.registerDeviceModel({
      providerKey: "restore-drill-provider",
      providerName: "Restore drill provider",
      modelKey: "restore-drill-watch",
      version: 1,
      name: "Restore drill watch",
      capabilities: ["metric"]
    });
    const connection = await repository.createConnection(personA, {
      deviceModelVersionId: model.id,
      label: null,
      dedupeKey: "restore-drill:connection"
    });
    const consent = await repository.grantConsent(personA, connection.id, {
      purpose: "Restore drill",
      allowedKinds: ["metric"],
      retentionMode: "indefinite",
      retainUntil: null
    });
    const device = await repository.createObservation(personA, {
      kind: "metric",
      observedFrom: "2026-11-04T06:00:00.000Z",
      observedUntil: "2026-11-04T06:00:00.000Z",
      timezone: "Europe/Moscow",
      quality: "reliable",
      connectionId: connection.id,
      consentId: consent.id,
      dedupeKey: "restore-drill:device",
      sourceReference: {
        channel: "device",
        externalSystem: "restore-drill-provider",
        externalRecordId: "restore-drill-device",
        occurredAt: "2026-11-04T06:00:00.000Z"
      },
      detail: { type: "metric", metric: "resting_heart_rate", value: 56, unit: "bpm" }
    });
    const manual = await repository.createObservation(personA, {
      kind: "metric",
      observedFrom: "2026-11-04T07:00:00.000Z",
      observedUntil: "2026-11-04T07:00:00.000Z",
      timezone: "Europe/Moscow",
      quality: "reliable",
      connectionId: null,
      consentId: null,
      dedupeKey: "restore-drill:manual",
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: "2026-11-04T07:00:00.000Z"
      },
      detail: { type: "metric", metric: "resting_heart_rate", value: 57, unit: "bpm" }
    });
    const dump = await container.exec([
      "pg_dump", "-U", "shape_of_you", "-Fc", "-f", "/tmp/pre-erasure.dump",
      "shape_of_you_recovery_test"
    ]);
    expect(dump.exitCode, dump.output).toBe(0);

    const request = await repository.requestErasure(
      personA,
      connection.id,
      "restore-drill:request",
      "user_request",
      "00000000-0000-4000-8000-000000000096"
    );
    await acknowledgeAcceptedErasure(request.id);
    const job = await repository.claimErasure("restore-drill-worker", 30_000);
    expect(job?.id).toBe(request.id);
    await repository.completeErasure(job!);
    const manifest = await exportRecoveryErasureManifest(database.pool);
    assertRecoveryErasureManifestComplete(manifest, manifest.completeThrough);
    expect(() => assertRecoveryErasureManifestComplete(
      manifest,
      new Date(new Date(manifest.completeThrough).getTime() + 1).toISOString()
    )).toThrow("incomplete");

    const createdRestore = await container.exec([
      "createdb", "-U", "shape_of_you", "shape_of_you_recovery_restore_test"
    ]);
    expect(createdRestore.exitCode, createdRestore.output).toBe(0);
    const restoredDump = await container.exec([
      "pg_restore", "-U", "shape_of_you", "-d", "shape_of_you_recovery_restore_test",
      "/tmp/pre-erasure.dump"
    ]);
    expect(restoredDump.exitCode, restoredDump.output).toBe(0);
    const restoredUrl = new URL(databaseUrl);
    restoredUrl.pathname = "/shape_of_you_recovery_restore_test";
    const restoredDatabase = createDatabase({
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 3_000,
      DATABASE_URL: restoredUrl.toString(),
      LOG_LEVEL: "silent",
      PERSON_CONTEXT_MODE: "synthetic",
      SYNTHETIC_PERSON_ID: personA,
      SHUTDOWN_TIMEOUT_MS: 1_000
    });
    try {
      const restoredRepository = new RecoveryRepository(restoredDatabase);
      expect(await restoredRepository.findObservation(personA, device.observation.id)).not.toBeNull();
      for (const marker of manifest.markers) {
        await restoredRepository.replayErasureMarker(marker);
      }
      expect(await restoredRepository.findObservation(personA, device.observation.id)).toBeNull();
      expect(await restoredRepository.findObservation(personA, manual.observation.id)).not.toBeNull();
    } finally {
      await restoredDatabase.pool.end();
    }
  });

  it("creates immutable policy-pinned assessments with hard-stop evidence", async () => {
    const policyVersionId = await repository.registerPolicyVersion({
      policyKey: "synthetic-readiness",
      policyName: "Синтетическая готовность",
      version: 1,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveUntil: null,
      analysisWindowDays: 7,
      minimumObservations: 2,
      sufficientObservations: 3,
      insufficientConfidenceCap: 0.25,
      poorQualityConfidenceCap: 0.4,
      targetSleepMinutes: 480,
      fatigueWeight: 20,
      sorenessWeight: 15,
      stressWeight: 10,
      lowEnergyWeight: 15,
      lowSleepQualityWeight: 10,
      sleepDeficitWeight: 20,
      externalSetWeight: 1,
      bodyweightSetWeight: 0.5,
      assistedSetWeight: 0.25,
      moderateRiskThreshold: 25,
      highRiskThreshold: 50
    });
    const fastify = getFastifyInstance(app);
    const exerciseResponse = await fastify.inject({
      method: "POST",
      url: "/v1/training/catalog/exercises",
      payload: {
        visibility: "shared",
        name: "Синтетическое упражнение Recovery",
        category: "strength",
        movementPattern: "push",
        equipment: null,
        instructions: null,
        note: null
      }
    });
    expect(exerciseResponse.statusCode, exerciseResponse.body).toBe(201);
    const exerciseVersionId = exerciseResponse.json().currentVersion.id;
    const sessionResponse = await fastify.inject({
      method: "POST",
      url: "/v1/training/sessions",
      payload: {
        occurredAt: "2026-10-24T18:00:00.000Z",
        timezone: "Europe/Berlin",
        programVersionId: null,
        workoutName: "Синтетическая тренировка Recovery",
        feeling: null,
        note: null,
        exercises: [
          { exerciseVersionId, loadBasis: "external_weight", feeling: null, note: null, sets: [{ weightKg: 20, reps: 5, rir: 2 }] },
          { exerciseVersionId, loadBasis: "body_weight", feeling: null, note: null, sets: [{ weightKg: null, reps: 5, rir: 2 }, { weightKg: null, reps: 5, rir: 2 }] },
          { exerciseVersionId, loadBasis: "assisted", feeling: null, note: null, sets: [{ weightKg: null, reps: 5, rir: 2 }, { weightKg: null, reps: 5, rir: 2 }, { weightKg: null, reps: 5, rir: 2 }] }
        ],
        sourceReference: { channel: "manual", externalSystem: null, externalRecordId: null, occurredAt: "2026-10-24T18:00:00.000Z" },
        dedupeKey: "training:recovery:evidence",
        confidence: 1
      }
    });
    expect(sessionResponse.statusCode, sessionResponse.body).toBe(201);
    const observationResponse = await fastify.inject({
      method: "POST",
      url: "/v1/recovery/observations",
      payload: {
      kind: "subjective",
      observedFrom: "2026-10-25T07:00:00.000Z",
      observedUntil: "2026-10-25T07:00:00.000Z",
      timezone: "Europe/Berlin",
      quality: "poor",
      connectionId: null,
      consentId: null,
      dedupeKey: "manual:subjective:hard-stop",
      sourceReference: { channel: "manual", externalSystem: null, externalRecordId: null, occurredAt: "2026-10-25T07:00:00.000Z" },
      detail: { type: "subjective", energy: 4, fatigue: 2, muscleSoreness: 2, stress: 2, sleepQuality: 4, acuteIllness: true, injuryConcern: false }
      }
    });
    expect(observationResponse.statusCode, observationResponse.body).toBe(201);
    const observation = observationResponse.json();
    const beforeAssessment = await database.pool.query<{ sessions: string; observations: string; consents: string }>(
      `select
         (select count(*)::text from workout_sessions) as sessions,
         (select count(*)::text from recovery_observations) as observations,
         (select count(*)::text from recovery_consents) as consents`
    );
    const assessmentInput = {
        policyVersionId,
        asOf: "2026-10-25T08:00:00.000Z",
        timezone: "Europe/Berlin",
        dedupeKey: "assessment:hard-stop"
    };
    const createdResponse = await fastify.inject({
      method: "POST",
      url: "/v1/recovery/assessments",
      payload: assessmentInput
    });
    const duplicateResponse = await fastify.inject({
      method: "POST",
      url: "/v1/recovery/assessments",
      payload: assessmentInput
    });
    expect(createdResponse.statusCode, createdResponse.body).toBe(201);
    expect(duplicateResponse.statusCode, duplicateResponse.body).toBe(200);
    const created = createdResponse.json();
    const duplicate = duplicateResponse.json();

    expect(created).toMatchObject({
      riskLevel: "blocked",
      readinessScore: 0,
      hardStop: true,
      confidence: 0.4,
      dataQuality: "limited"
    });
    expect(created.observationIds).toContain(observation.id);
    expect(created.workoutSessionIds).toContain(sessionResponse.json().id);
    expect(created.calculation.trainingComponents).toEqual({
      external: 1,
      bodyweight: 1,
      assisted: 0.75
    });
    expect(duplicate.id).toBe(created.id);
    expect(await repository.findAssessment(personB, created.id)).toBeNull();
    const afterAssessment = await database.pool.query<{ sessions: string; observations: string; consents: string }>(
      `select
         (select count(*)::text from workout_sessions) as sessions,
         (select count(*)::text from recovery_observations) as observations,
         (select count(*)::text from recovery_consents) as consents`
    );
    expect(afterAssessment.rows[0]).toEqual(beforeAssessment.rows[0]);
  });
});
