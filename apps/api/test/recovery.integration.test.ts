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
import { TrainingService } from "../src/training/training.service.js";
import { readTrainingBaselineDays } from "../src/training/personal-baseline-history.js";
import { readRecoveryBaselineDays } from "../src/recovery/personal-baseline-history.js";
import { DailyAssessmentRepository } from "../src/storage/daily-assessment-repository.js";
import { loadRetrospectiveEvidence } from "../src/commands/run-daily-assessment-retrospective.js";
import { ConnectionCredentialCipher } from "../src/integrations/credential-cipher.js";
import { FakeHealthDataProvider } from "../src/integrations/fake-provider.js";
import type { ProviderReconciliation } from "../src/integrations/provider.js";
import { IntegrationService } from "../src/integrations/integration.service.js";
import { SyntheticPersonContext } from "../src/application/person-context.js";
import { RecoveryService } from "../src/recovery/recovery.service.js";
import { CurrentRecoveryContextService } from "../src/coaching/current-recovery-context.service.js";
import type { DailyAssessmentStore } from "../src/storage/daily-assessment-repository.js";

let container: StartedPostgreSqlContainer;
let database: DatabaseContext;
let app: NestFastifyApplication;
let repository: RecoveryRepository;
let databaseUrl: string;

const personA = "00000000-0000-4000-8000-000000000001";
const personB = "00000000-0000-4000-8000-000000000002";
const personC = "00000000-0000-4000-8000-000000000003";
const personD = "00000000-0000-4000-8000-000000000004";
const personE = "00000000-0000-4000-8000-000000000005";
const personF = "00000000-0000-4000-8000-000000000006";
const personG = "00000000-0000-4000-8000-000000000007";
const personH = "00000000-0000-4000-8000-000000000008";
const personI = "00000000-0000-4000-8000-000000000009";
const personJ = "00000000-0000-4000-8000-000000000010";

class FailAfterFirstFactLinkRepository extends IntegrationRepository {
  private failAfterFirstFactLink = true;

  public override async linkRecoveryFact(
    connectionId: string,
    consentId: string,
    identity: string,
    receiptId: string,
    factKey: string,
    checksum: string,
    observationId: string
  ): Promise<boolean> {
    const linked = await super.linkRecoveryFact(
      connectionId,
      consentId,
      identity,
      receiptId,
      factKey,
      checksum,
      observationId
    );
    if (this.failAfterFirstFactLink) {
      this.failAfterFirstFactLink = false;
      throw new Error("mid-record normalization failure");
    }
    return linked;
  }
}

class FailBeforeFactLinkRepository extends IntegrationRepository {
  private failed = false;

  public constructor(databaseContext: DatabaseContext, private readonly targetFactKey: string) {
    super(databaseContext);
  }

  public override linkRecoveryFact(
    connectionId: string,
    consentId: string,
    identity: string,
    receiptId: string,
    factKey: string,
    checksum: string,
    observationId: string
  ): Promise<boolean> {
    if (!this.failed && factKey === this.targetFactKey) {
      this.failed = true;
      throw new Error("post-observation pre-pointer failure");
    }
    return super.linkRecoveryFact(
      connectionId,
      consentId,
      identity,
      receiptId,
      factKey,
      checksum,
      observationId
    );
  }
}

function currentRecoveryContext(
  personId: string,
  integrations: IntegrationRepository,
  localDate: string
): Promise<Awaited<ReturnType<CurrentRecoveryContextService["read"]>>> {
  const personContext = new SyntheticPersonContext(personId);
  const preferences = {
    getPreferences: async () => ({ timezone: "UTC", updatedAt: new Date(0).toISOString() })
  } as unknown as DailyAssessmentStore;
  return new CurrentRecoveryContextService(
    personContext,
    preferences,
    integrations,
    new RecoveryService(repository, personContext)
  ).read(new Date(`${localDate}T12:00:00.000Z`));
}

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
    "insert into persons (id, kind, status) values ($1, 'real', 'active'), ($2, 'real', 'active'), ($3, 'real', 'active'), ($4, 'real', 'active'), ($5, 'real', 'active'), ($6, 'real', 'active'), ($7, 'real', 'active'), ($8, 'real', 'active'), ($9, 'real', 'active')",
    [personB, personC, personD, personE, personF, personG, personH, personI, personJ]
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
  it("does not inherit delivery evidence across consent generations and preserves idempotent corrections", async () => {
    const integrations = new IntegrationRepository(database);
    const training = new TrainingRepository(database);
    const provider = new FakeHealthDataProvider();
    const cipher = new ConnectionCredentialCipher("v1", new Map([["v1", randomBytes(32)]]));
    const id = "00000000-0000-4000-8000-000000000171";
    const recoveryConnectionId = "00000000-0000-4000-8000-000000000172";
    const oldConsentId = "00000000-0000-4000-8000-000000000173";
    const newConsentId = "00000000-0000-4000-8000-000000000174";
    const credential = cipher.encrypt("generation-token", `intervals_icu:${personI}:${id}`);
    const service = new IntegrationService(
      new SyntheticPersonContext(personI), integrations, provider, cipher, repository, training
    );
    const baseWellness = {
      identity: "2026-09-18",
      localDate: "2026-09-18",
      timezone: "Europe/Belgrade",
      updatedAt: "2026-09-18T12:00:00.000Z",
      steps: 2_834,
      totalSleepMinutes: null,
      sleepScore: null,
      restingHeartRate: null,
      averageSleepingHeartRate: null,
      hrvRmssd: 57,
      oxygenSaturation: null,
      respirationRate: null,
      bodyBatteryMinimum: null,
      bodyBatteryMaximum: null
    };

    await integrations.activate({
      id, recoveryConnectionId, consentId: oldConsentId, personId: personI,
      externalUserId: "athlete-i", credential,
      authorizationStartedAt: new Date(Date.now() - 2_000)
    });
    provider.reconciliation = { wellness: [baseWellness], activities: [] };
    await service.reconcileConnection((await integrations.findActive(personI))!);

    await integrations.beginDisconnect(personI, "test reconnect");
    await integrations.activate({
      id, recoveryConnectionId, consentId: newConsentId, personId: personI,
      externalUserId: "athlete-i", credential,
      authorizationStartedAt: new Date(Date.now() + 1_000)
    });

    const beforeFirstSync = await integrations.connectedRecoveryDelivery(personI, "2026-09-18");
    expect(beforeFirstSync).toMatchObject({
      lastSuccessfulSyncAt: null,
      targetDateRecordReceived: false,
      targetDateSupportedFactsPresent: false
    });
    expect(beforeFirstSync?.metricDelivery).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "hrv_rmssd", state: "retained_unconfirmed" }),
      expect.objectContaining({ metric: "steps", state: "retained_unconfirmed" }),
      expect.objectContaining({ metric: "sleep", state: "unknown" })
    ]));
    expect((await repository.listObservations(personI, { localDate: "2026-09-18", limit: 50 })).items)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ detail: expect.objectContaining({ metric: "steps", value: 2_834 }) }),
        expect.objectContaining({ detail: expect.objectContaining({ metric: "hrv_rmssd", value: 57 }) })
      ]));

    provider.reconciliation = {
      wellness: [{ ...baseWellness, steps: null }],
      activities: []
    };
    const failingIntegrations = new FailAfterFirstFactLinkRepository(database);
    const failingService = new IntegrationService(
      new SyntheticPersonContext(personI), failingIntegrations, provider, cipher, repository, training
    );
    await failingService.reconcileConnection((await integrations.findActive(personI))!);

    const afterPartialFailure = await integrations.connectedRecoveryDelivery(personI, "2026-09-18");
    expect(afterPartialFailure).toMatchObject({
      lifecycle: "degraded",
      lastSuccessfulSyncAt: null,
      targetDateRecordReceived: false,
      targetDateSupportedFactsPresent: false
    });
    expect(afterPartialFailure?.metricDelivery).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "hrv_rmssd", state: "retained_unconfirmed" }),
      expect.objectContaining({ metric: "steps", state: "retained_unconfirmed" }),
      expect.objectContaining({ metric: "sleep", state: "unknown" })
    ]));
    expect((await database.pool.query(
      `select status from integration_inbox
        where connection_id = $1 and consent_id = $2 and provider_identity = '2026-09-18'`,
      [id, newConsentId]
    )).rows).toEqual([{ status: "pending" }]);

    await service.reconcileConnection((await integrations.findActive(personI))!);
    const partial = await integrations.connectedRecoveryDelivery(personI, "2026-09-18");
    expect(partial?.metricDelivery).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "hrv_rmssd", state: "confirmed_present" }),
      expect.objectContaining({ metric: "steps", state: "confirmed_absent" }),
      expect.objectContaining({ metric: "sleep", state: "confirmed_absent" })
    ]));
    expect((await database.pool.query(
      `select count(*)::int as count from recovery_observations o
       join recovery_metric_details d on d.observation_id = o.id
       where o.person_id = $1 and d.metric = 'hrv_rmssd'`,
      [personI]
    )).rows[0]).toEqual({ count: 1 });

    provider.reconciliation = {
      wellness: [{ ...baseWellness, steps: 12_002, updatedAt: "2026-09-18T21:00:00.000Z" }],
      activities: []
    };
    const current = (await integrations.findActive(personI))!;
    await service.reconcileConnection(current);
    await service.reconcileConnection(current);
    const currentSteps = (await repository.listObservations(personI, { localDate: "2026-09-18", limit: 50 })).items
      .filter((item) => item.detail.type === "metric" && item.detail.metric === "steps");
    expect(currentSteps).toHaveLength(1);
    expect(currentSteps[0]).toMatchObject({
      consentId: newConsentId,
      correctionReason: "provider_record_changed",
      sourceReference: { occurredAt: "2026-09-18T21:00:00.000Z" },
      detail: { metric: "steps", value: 12_002, unit: "count" }
    });
    expect((await database.pool.query(
      `select count(*)::int as count from recovery_observations o
       join recovery_metric_details d on d.observation_id = o.id
       where o.person_id = $1 and d.metric = 'steps'`,
      [personI]
    )).rows[0]).toEqual({ count: 3 });
    expect((await database.pool.query(
      `select count(*)::int as count
         from integration_inbox
        where connection_id = $1 and consent_id = $2 and provider_identity = '2026-09-18'`,
      [id, newConsentId]
    )).rows[0]).toEqual({ count: 2 });
    expect((await database.pool.query(
      `select normalized_checksum, confirmed_consent_id
         from integration_recovery_facts
        where connection_id = $1 and provider_identity = '2026-09-18' and fact_key = 'steps'`,
      [id]
    )).rows[0]).toMatchObject({ confirmed_consent_id: newConsentId });
  });

  it("fails closed when create, correction or withdrawal commits before pointer publication", async () => {
    const integrations = new IntegrationRepository(database);
    const training = new TrainingRepository(database);
    const provider = new FakeHealthDataProvider();
    const cipher = new ConnectionCredentialCipher("v1", new Map([["v1", randomBytes(32)]]));
    const id = "00000000-0000-4000-8000-000000000181";
    const recoveryConnectionId = "00000000-0000-4000-8000-000000000182";
    const consentId = "00000000-0000-4000-8000-000000000183";
    const credential = cipher.encrypt("projection-fence-token", `intervals_icu:${personJ}:${id}`);
    const wellness = (localDate: string, totalSleepMinutes: number | null, hrvRmssd: number | null) => ({
      identity: localDate,
      localDate,
      timezone: "UTC",
      updatedAt: `${localDate}T08:00:00.000Z`,
      steps: null,
      totalSleepMinutes,
      sleepScore: null,
      restingHeartRate: null,
      averageSleepingHeartRate: null,
      hrvRmssd,
      oxygenSaturation: null,
      respirationRate: null,
      bodyBatteryMinimum: null,
      bodyBatteryMaximum: null
    });
    const personContext = new SyntheticPersonContext(personJ);
    const service = new IntegrationService(
      personContext,
      integrations,
      provider,
      cipher,
      repository,
      training
    );

    await integrations.activate({
      id,
      recoveryConnectionId,
      consentId,
      personId: personJ,
      externalUserId: "athlete-j",
      credential,
      authorizationStartedAt: new Date(Date.now() - 1_000)
    });
    provider.reconciliation = {
      wellness: [
        wellness("2026-09-10", 400, null),
        wellness("2026-09-11", null, 57),
        wellness("2026-09-12", null, 57)
      ],
      activities: []
    };
    await service.reconcileConnection((await integrations.findActive(personJ))!);

    provider.reconciliation = { wellness: [wellness("2026-09-10", 400, 60)], activities: [] };
    await new IntegrationService(
      personContext,
      new FailBeforeFactLinkRepository(database, "hrv_rmssd"),
      provider,
      cipher,
      repository,
      training
    ).reconcileConnection((await integrations.findActive(personJ))!);
    const afterCreateCut = await currentRecoveryContext(personJ, integrations, "2026-09-10");
    expect(afterCreateCut).toMatchObject({
      state: "available",
      targetDateDelivery: "record_without_supported_facts",
      metricDelivery: expect.arrayContaining([
        expect.objectContaining({ metric: "hrv_rmssd", state: "retained_unconfirmed" })
      ]),
      observations: {
        items: expect.arrayContaining([
          expect.objectContaining({ detail: { type: "metric", metric: "hrv_rmssd", value: 60, unit: "ms" } })
        ])
      }
    });

    provider.reconciliation = { wellness: [wellness("2026-09-11", null, 58)], activities: [] };
    await new IntegrationService(
      personContext,
      new FailBeforeFactLinkRepository(database, "hrv_rmssd"),
      provider,
      cipher,
      repository,
      training
    ).reconcileConnection((await integrations.findActive(personJ))!);
    const afterCorrectionCut = await currentRecoveryContext(personJ, integrations, "2026-09-11");
    expect(afterCorrectionCut).toMatchObject({
      state: "available",
      targetDateDelivery: "record_without_supported_facts",
      metricDelivery: expect.arrayContaining([
        expect.objectContaining({ metric: "hrv_rmssd", state: "retained_unconfirmed" })
      ]),
      observations: {
        items: expect.arrayContaining([
          expect.objectContaining({ detail: { type: "metric", metric: "hrv_rmssd", value: 58, unit: "ms" } })
        ])
      }
    });

    provider.reconciliation = { wellness: [wellness("2026-09-12", null, null)], activities: [] };
    await new IntegrationService(
      personContext,
      new FailBeforeFactLinkRepository(database, "hrv_rmssd"),
      provider,
      cipher,
      repository,
      training
    ).reconcileConnection((await integrations.findActive(personJ))!);
    const afterWithdrawalCut = await currentRecoveryContext(personJ, integrations, "2026-09-12");
    expect(afterWithdrawalCut).toMatchObject({
      state: "available",
      targetDateDelivery: "record_without_supported_facts",
      metricDelivery: expect.arrayContaining([
        expect.objectContaining({ metric: "hrv_rmssd", state: "unknown" })
      ])
    });
    if (afterWithdrawalCut.state !== "available") throw new Error("Recovery context must be available");
    expect(afterWithdrawalCut.observations.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ detail: expect.objectContaining({ metric: "hrv_rmssd" }) })
    ]));
  });

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
    const wellness = {
      identity: "2026-09-06",
      localDate: "2026-09-06",
      timezone: "UTC",
      updatedAt: "2026-09-06T20:15:00.000Z",
      steps: 12_345,
      totalSleepMinutes: 400,
      sleepScore: 82,
      restingHeartRate: 52,
      averageSleepingHeartRate: 49,
      hrvRmssd: 61,
      oxygenSaturation: 96.5,
      respirationRate: 15.4,
      bodyBatteryMinimum: 17,
      bodyBatteryMaximum: 92
    };

    provider.reconciliation = { wellness: [wellness], activities: [] };
    await service.reconcileConnection(connection);
    await service.reconcileConnection(connection);
    expect(await integrations.connectedRecoveryDelivery(personD, "2026-09-06")).toMatchObject({
      lifecycle: "active",
      failureCode: null,
      targetDateRecordReceived: true,
      targetDateSupportedFactsPresent: true
    });
    expect(await integrations.connectedRecoveryDelivery(personD, "2026-09-07")).toMatchObject({
      targetDateRecordReceived: false,
      targetDateSupportedFactsPresent: false
    });
    await integrations.markSyncFailed(id, consentId, "provider_timeout");
    expect(await integrations.connectedRecoveryDelivery(personD, "2026-09-07")).toMatchObject({
      lifecycle: "degraded",
      failureCode: "provider_timeout"
    });
    await integrations.markSyncSucceeded(id, consentId, false);
    await database.pool.query(
      "update integration_connections set last_successful_sync_at = now() - interval '16 minutes' where id = $1",
      [id]
    );
    expect((await integrations.connectedRecoveryDelivery(personD, "2026-09-07"))?.lastSuccessfulSyncAt)
      .toSatisfy((value: Date | null) => value !== null && value < new Date(Date.now() - 15 * 60_000));
    await integrations.markSyncSucceeded(id, consentId, false);
    expect(await integrations.connectedRecoveryDelivery(personE, "2026-09-06")).toBeNull();
    expect(
      (await repository.listObservations(personD, { limit: 50 })).items
        .filter((item) => item.detail.type === "metric")
        .map((item) => item.detail.type === "metric" ? item.detail.metric : null)
        .sort()
    ).toEqual([
      "body_battery_max",
      "body_battery_min",
      "hrv_rmssd",
      "night_heart_rate",
      "oxygen_saturation",
      "respiration_rate",
      "resting_heart_rate",
      "sleep_score",
      "steps"
    ]);
    provider.reconciliation = {
      wellness: [{
        ...wellness,
        totalSleepMinutes: 450,
        averageSleepingHeartRate: 48,
        oxygenSaturation: 97,
        respirationRate: 14.9,
        bodyBatteryMinimum: 15,
        bodyBatteryMaximum: 94
      }],
      activities: []
    };
    await service.reconcileConnection(connection);
    provider.reconciliation = { wellness: [wellness], activities: [] };
    const replayFailingService = new IntegrationService(
      new SyntheticPersonContext(personD),
      new FailAfterFirstFactLinkRepository(database),
      provider,
      cipher,
      repository,
      training
    );
    await replayFailingService.reconcileConnection(connection);
    const failedReplay = await integrations.connectedRecoveryDelivery(personD, "2026-09-06");
    expect(failedReplay).toMatchObject({ lifecycle: "degraded", failureCode: "provider_unavailable" });
    expect(failedReplay?.metricDelivery).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "sleep", state: "retained_unconfirmed" }),
      expect.objectContaining({ metric: "night_heart_rate", state: "confirmed_present" })
    ]));
    expect((await database.pool.query(
      `select count(*)::int as count,
              count(*) filter (where status = 'pending')::int as pending,
              count(*) filter (where status = 'normalized')::int as normalized
         from integration_inbox
        where connection_id = $1 and consent_id = $2 and provider_identity = '2026-09-06'
      `,
      [id, consentId]
    )).rows[0]).toEqual({ count: 3, pending: 1, normalized: 2 });
    await service.reconcileConnection(connection);
    await service.reconcileConnection(connection);
    expect((await integrations.connectedRecoveryDelivery(personD, "2026-09-06"))?.metricDelivery)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ metric: "sleep", state: "confirmed_present" }),
        expect.objectContaining({ metric: "night_heart_rate", state: "confirmed_present" })
      ]));
    expect((await database.pool.query(
      `select count(*)::int as count,
              count(*) filter (where status = 'pending')::int as pending,
              count(*) filter (where status = 'normalized')::int as normalized
         from integration_inbox
        where connection_id = $1 and consent_id = $2 and provider_identity = '2026-09-06'`,
      [id, consentId]
    )).rows[0]).toEqual({ count: 3, pending: 0, normalized: 3 });
    provider.reconciliation = {
      wellness: [{
        ...wellness,
        totalSleepMinutes: null,
        sleepScore: null,
        restingHeartRate: null,
        averageSleepingHeartRate: null,
        hrvRmssd: null,
        oxygenSaturation: null,
        respirationRate: null,
        bodyBatteryMinimum: null,
        bodyBatteryMaximum: null,
        steps: null
      }],
      activities: []
    };
    await service.reconcileConnection(connection);
    expect(await integrations.connectedRecoveryDelivery(personD, "2026-09-06")).toMatchObject({
      targetDateRecordReceived: true,
      targetDateSupportedFactsPresent: false
    });

    const history = await database.pool.query<{ count: string; withdrawals: string }>(
      "select count(*)::text as count, count(withdrawn_at)::text as withdrawals from recovery_observations where person_id = $1 and connection_id = $2",
      [personD, recoveryConnectionId]
    );
    expect(history.rows[0]).toEqual({ count: "32", withdrawals: "10" });
    expect((await repository.listObservations(personD, { limit: 50 })).items).toHaveLength(0);
    await integrations.beginDisconnect(personD, "test disconnect");
    expect(await integrations.connectedRecoveryDelivery(personD, "2026-09-06")).toMatchObject({
      lifecycle: "disconnected",
      importEnabled: false
    });
    provider.reconciliation = { wellness: [{ ...wellness, totalSleepMinutes: 500 }], activities: [] };
    await service.reconcileConnection(connection);
    expect((await database.pool.query("select 1 from recovery_observations where person_id = $1", [personD])).rowCount).toBe(32);

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
    const pendingRecoveryClient = await database.pool.connect();
    try {
      expect(await readRecoveryBaselineDays(
        pendingRecoveryClient, personD, "2026-09-06", "2026-09-06"
      )).toEqual([]);
    } finally {
      pendingRecoveryClient.release();
    }
    await expect(integrations.activate({ id, recoveryConnectionId, consentId: "00000000-0000-4000-8000-000000000124", personId: personD, externalUserId: "athlete-d", credential, authorizationStartedAt: new Date() }))
      .rejects.toThrow("erasure must complete");
    await acknowledgeAcceptedErasure(erasure.id);
    const erasureJob = await repository.claimErasure("person-d-erasure-worker", 30_000);
    await repository.completeErasure(erasureJob!);
    expect((await database.pool.query(
      "select 1 from recovery_observations where person_id = $1 and connection_id = $2",
      [personD, recoveryConnectionId]
    )).rowCount).toBe(0);
    expect((await database.pool.query(
      "select 1 from integration_recovery_facts where connection_id = $1",
      [id]
    )).rowCount).toBe(0);
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
      trainingLoadBasis: "relative_training_stress" as const,
      trainingLoadBasisVersion: "intervals-icu-icu-training-load-v1",
      averageHeartRate: 145, maximumHeartRate: 175, deviceName: "Garmin Test", garminAttributed: true
    };
    const trainingInput = (value: typeof activity, checksum: string) => ({
      connectionId: connection!.id, personId: connection!.personId, consentId: connection!.consentId,
      providerIdentity: value.identity,
      normalizedChecksum: checksum, occurredAt: value.occurredAt, localDate: value.localDate, timezone: value.timezone,
      name: value.name, durationSeconds: value.durationSeconds, distanceMeters: value.distanceMeters,
      trainingLoad: value.trainingLoad, trainingLoadBasis: value.trainingLoadBasis,
      trainingLoadBasisVersion: value.trainingLoadBasisVersion,
      averageHeartRate: value.averageHeartRate, maximumHeartRate: value.maximumHeartRate,
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
    expect(await training.listExternalActivities(personC, 10)).toHaveLength(1);
    const newerActivity = {
      ...activity,
      identity: "activity-c-2",
      occurredAt: "2026-09-08T06:00:00.000Z",
      localDate: "2026-09-08",
      name: "Ride"
    };
    expect(await training.importExternalActivity(
      trainingInput(newerActivity, "d".repeat(64))
    )).toBe("created");
    expect(await training.listExternalActivities(personC, 1)).toMatchObject([
      { providerIdentity: "activity-c-2", name: "Ride" }
    ]);
    expect(await training.listExternalActivities(personB, 10)).toEqual([]);
    expect(await training.listExternalActivities(personC, 10)).toMatchObject([
      { providerIdentity: "activity-c-2" },
      { providerIdentity: "activity-c", durationSeconds: 3600 }
    ]);
    const baselineClient = await database.pool.connect();
    try {
      expect(await readTrainingBaselineDays(
        baselineClient, personC, "2026-09-07", "2026-09-08"
      )).toEqual([
        expect.objectContaining({ localDate: "2026-09-07", trainingLoad: 80, loadSeriesKey: "relative_training_stress:intervals-icu-icu-training-load-v1", loadBasis: "relative_training_stress", loadBasisVersion: "intervals-icu-icu-training-load-v1", workoutSessionCount: 0, externalActivityCount: 1, incompatibleLoadSources: false }),
        expect.objectContaining({ localDate: "2026-09-08", trainingLoad: 80, loadSeriesKey: "relative_training_stress:intervals-icu-icu-training-load-v1", loadBasis: "relative_training_stress", loadBasisVersion: "intervals-icu-icu-training-load-v1", workoutSessionCount: 0, externalActivityCount: 1, incompatibleLoadSources: false })
      ]);
      expect(await readTrainingBaselineDays(
        baselineClient, personB, "2026-09-07", "2026-09-08"
      )).toEqual([]);
    } finally {
      baselineClient.release();
    }
    const semanticsModel = await repository.registerDeviceModel({
      providerKey: "second-load-semantics",
      providerName: "Second load semantics",
      modelKey: "second-load-source",
      version: 1,
      name: "Second load source",
      capabilities: ["metric"]
    });
    const semanticsRecoveryConnection = await repository.createConnection(personC, {
      deviceModelVersionId: semanticsModel.id,
      label: null,
      dedupeKey: "second-load-semantics:recovery"
    });
    const semanticsConsent = await repository.grantConsent(
      personC,
      semanticsRecoveryConnection.id,
      {
        purpose: "Cross-day load semantics test",
        allowedKinds: ["metric"],
        retentionMode: "indefinite",
        retainUntil: null
      }
    );
    const semanticsIntegrationId = "00000000-0000-4000-8000-000000000115";
    await database.pool.query(
      `insert into integration_connections
         (id, person_id, recovery_connection_id, consent_id, provider_key, external_user_id)
       values ($1, $2, $3, $4, 'second_load_semantics', 'test-athlete')`,
      [semanticsIntegrationId, personC, semanticsRecoveryConnection.id, semanticsConsent.id]
    );
    await database.pool.query(
      `insert into integration_activity_facts
         (connection_id, person_id, provider_identity, normalized_checksum,
          occurred_at, local_date, timezone, name, duration_seconds,
          training_load, source_provider, garmin_attributed)
       values ($1, $2, 'second-semantics-day', $3,
               '2026-09-09T06:00:00.000Z', '2026-09-09', 'UTC',
               'Second semantics activity', 1800, 35, 'second_load_semantics', false)`,
      [semanticsIntegrationId, personC, "f".repeat(64)]
    );
    const semanticsClient = await database.pool.connect();
    try {
      expect(await readTrainingBaselineDays(
        semanticsClient, personC, "2026-09-07", "2026-09-09"
      )).toEqual([
        expect.objectContaining({
          localDate: "2026-09-07",
          loadSeriesKey: "relative_training_stress:intervals-icu-icu-training-load-v1",
          incompatibleLoadSources: false
        }),
        expect.objectContaining({
          localDate: "2026-09-08",
          loadSeriesKey: "relative_training_stress:intervals-icu-icu-training-load-v1",
          incompatibleLoadSources: false
        }),
        expect.objectContaining({
          localDate: "2026-09-09",
          loadSeriesKey: null,
          trainingLoad: null,
          incompatibleLoadSources: true
        })
      ]);
    } finally {
      semanticsClient.release();
    }
    await database.pool.query(
      "delete from integration_connections where id = $1",
      [semanticsIntegrationId]
    );
    const trainingCoverage = await training.getDataCoverage(
      personC,
      "2026-06-10",
      "2026-09-08",
      "2026-09-09"
    );
    expect(trainingCoverage).toMatchObject({
      firstDataDate: "2026-09-07",
      lastDataDate: "2026-09-08"
    });
    expect([...trainingCoverage.days].sort((left, right) => left.localDate.localeCompare(right.localDate))).toEqual([
      { localDate: "2026-09-07", usable: true },
      { localDate: "2026-09-08", usable: true }
    ]);
    const retainedActivity = (await training.listExternalActivities(personC, 1))[0]!;
    const dailyAssessments = new DailyAssessmentRepository(database);
    const activitySnapshot = {
      localDate: "2026-09-08",
      timezone: "UTC",
      status: "caution",
      usedFacts: {
        recoveryObservationIds: [], recoveryAssessmentIds: [], workoutSessionIds: [],
        externalActivityIds: [retainedActivity.id], mealIds: [], weightMeasurementIds: [],
        activeTrainingProgramVersionId: null,
        coveragePolicyVersion: "profile-data-coverage-v1",
        coverageReadiness: {
          sleep: "sparse", hrv: "sparse", restingHeartRate: "sparse",
          bodyBattery: "sparse", training: "good", weight: "sparse", nutrition: "sparse"
        },
        summary: {
          recoveryRiskLevel: null, recoveryHardStop: false, sleepMinutes: null,
          hrvMs: null, hrvBaselineMs: null, restingHeartRateBpm: null,
          restingHeartRateBaselineBpm: null, bodyBattery: null,
          bodyBatteryMin: null, bodyBatteryMax: null, recentWorkoutCount: 0,
          recentExternalActivityCount: 1, recentTrainingLoad: 80,
          nutritionCompleteness: "partial", mealCount: 0, caloriesKcal: null,
          proteinG: null, latestWeightKg: null
        }
      },
      missingImportantData: [
        "sleep", "hrv", "resting_heart_rate", "body_battery", "training_program",
        "weight", "nutrition"
      ],
      reasons: ["recent_training_load", "no_active_training_program"],
      recommendedAction: {
        type: "recovery_first", text: "Keep the load conservative.",
        trainingProgramVersionId: null
      },
      alternatives: [],
      limitations: ["not_medical_advice"],
      confidence: 0.7,
      policyVersion: "daily-assessment-v1",
      evidenceChecksum: "9".repeat(64)
    } as const;
    const legacySnapshot = await dailyAssessments.createOrGet(personC, activitySnapshot);
    expect(legacySnapshot.policyVersion).toBe("daily-assessment-v1");
    expect(legacySnapshot).not.toHaveProperty("personalBaseline");
    await expect(dailyAssessments.createOrGet(personB, {
      ...activitySnapshot,
      evidenceChecksum: "8".repeat(64)
    })).rejects.toThrow();
    const crossPersonSnapshotClient = await database.pool.connect();
    try {
      const crossPersonEvidence = await loadRetrospectiveEvidence(
        crossPersonSnapshotClient, personB, "2026-09-08", "2026-09-08"
      );
      expect(crossPersonEvidence).toEqual([expect.objectContaining({
        localDate: "2026-09-08", values: {}, contextEligibilityAvailable: true
      })]);
      expect(crossPersonEvidence[0]?.v1Status).toBeUndefined();
      expect(crossPersonEvidence[0]?.counterfactualV1).toBeUndefined();
    } finally {
      crossPersonSnapshotClient.release();
    }

    const disconnect = await integrations.beginDisconnect(personC, "test disconnect");
    expect(disconnect?.id).toBe(id);
    expect(await integrations.status(personC)).toMatchObject({ lifecycle: "disconnected" });
    await expect(integrations.activate({ id, recoveryConnectionId, consentId: "00000000-0000-4000-8000-000000000114", personId: personC, externalUserId: "athlete-c", credential, authorizationStartedAt: new Date(0) }))
      .rejects.toThrow("superseded by disconnect");
    expect(await training.importExternalActivity(trainingInput({ ...activity, durationSeconds: 3_720 }, "e".repeat(64)))).toBe("stopped");
    expect((await database.pool.query("select 1 from integration_activity_facts where connection_id = $1", [id])).rowCount).toBe(4);
    await integrations.completeRemoteDisconnect(id);
    const erasure = await repository.requestErasure(personC, recoveryConnectionId, "activity-erasure", "retention_expired", null);
    const pendingTrainingClient = await database.pool.connect();
    try {
      expect(await readTrainingBaselineDays(
        pendingTrainingClient, personC, "2026-09-07", "2026-09-08"
      )).toEqual([]);
    } finally {
      pendingTrainingClient.release();
    }
    await acknowledgeAcceptedErasure(erasure.id);
    const job = await repository.claimErasure("activity-erasure-worker", 30_000);
    await repository.completeErasure(job!);
    expect(await training.listExternalActivities(personC, 10)).toHaveLength(0);
    const erasedActivitySnapshotClient = await database.pool.connect();
    try {
      const erasedEvidence = await loadRetrospectiveEvidence(
        erasedActivitySnapshotClient, personC, "2026-09-08", "2026-09-08"
      );
      expect(erasedEvidence).toEqual([expect.objectContaining({
        localDate: "2026-09-08", values: {}, contextEligibilityAvailable: true
      })]);
      expect(erasedEvidence[0]?.v1Status).toBeUndefined();
      expect(erasedEvidence[0]?.counterfactualV1).toBeUndefined();
    } finally {
      erasedActivitySnapshotClient.release();
    }
  });

  it("starts historical import explicitly and resumes from the durable bounded cursor", async () => {
    const integrations = new IntegrationRepository(database);
    const training = new TrainingRepository(database);
    const provider = new FakeHealthDataProvider();
    provider.reconciliation = {
      wellness: [{
        identity: "2026-09-05",
        localDate: "2026-09-05",
        timezone: "UTC",
        totalSleepMinutes: 430,
        sleepScore: 80,
        restingHeartRate: 54,
        averageSleepingHeartRate: 50,
        hrvRmssd: 59,
        oxygenSaturation: 96,
        respirationRate: 15,
        bodyBatteryMinimum: 20,
        bodyBatteryMaximum: 88
      }],
      activities: [{
        identity: "history-run-e",
        occurredAt: "2026-09-05T06:00:00.000Z",
        localDate: "2026-09-05",
        timezone: "UTC",
        name: "Historical run",
        durationSeconds: 2_700,
        distanceMeters: 7_000,
        trainingLoad: 62,
        trainingLoadBasis: "relative_training_stress",
        trainingLoadBasisVersion: "intervals-icu-icu-training-load-v1",
        averageHeartRate: 146,
        maximumHeartRate: 172,
        deviceName: "Garmin Test",
        garminAttributed: true
      }]
    };
    const cipher = new ConnectionCredentialCipher("v1", new Map([["v1", randomBytes(32)]]));
    const id = "00000000-0000-4000-8000-000000000131";
    const recoveryConnectionId = "00000000-0000-4000-8000-000000000132";
    const consentId = "00000000-0000-4000-8000-000000000133";
    const credential = cipher.encrypt("history-token", `intervals_icu:${personE}:${id}`);
    await integrations.activate({
      id, recoveryConnectionId, consentId, personId: personE,
      externalUserId: "athlete-e", credential,
      authorizationStartedAt: new Date(Date.now() - 1_000)
    });
    expect(await integrations.status(personE)).toMatchObject({
      historicalImport: { status: "not_requested", processedThroughDate: null }
    });

    const service = new IntegrationService(
      new SyntheticPersonContext(personE), integrations, provider, cipher, repository, training
    );
    await expect(service.startHistoricalImport()).resolves.toMatchObject({
      historicalImport: { status: "running", processedThroughDate: null }
    });
    const connection = (await integrations.findActive(personE))!;
    await service.reconcileConnection(connection);

    expect(provider.reconcileCalls).toHaveLength(2);
    expect((await repository.listObservations(personE, { limit: 50 })).items).toHaveLength(9);
    const trainingContext = await new TrainingService(
      training,
      new SyntheticPersonContext(personE)
    ).getTrainingContext({ historyLimit: 10 });
    expect(trainingContext).toMatchObject({
      status: "absent",
      recentExternalActivities: [{
        name: "Historical run",
        localDate: "2026-09-05",
        distanceMeters: 7_000,
        garminAttributed: true
      }]
    });
    expect(Object.keys(trainingContext.recentExternalActivities[0]!).sort()).toEqual([
      "averageHeartRate",
      "classification",
      "deviceName",
      "distanceMeters",
      "durationSeconds",
      "garminAttributed",
      "id",
      "localDate",
      "maximumHeartRate",
      "name",
      "occurredAt",
      "timezone",
      "trainingLoad"
    ]);
    const [rolling, historical] = provider.reconcileCalls;
    expect(historical!.newest < rolling!.oldest).toBe(true);
    const historicalDays = Math.round(
      (Date.parse(`${historical!.newest}T00:00:00.000Z`) - Date.parse(`${historical!.oldest}T00:00:00.000Z`)) / 86_400_000
    ) + 1;
    expect(historicalDays).toBeLessThanOrEqual(180);
    expect(await integrations.status(personE)).toMatchObject({
      lifecycle: "active",
      historicalImport: {
        status: "running",
        processedThroughDate: historical!.oldest,
        failureCode: null
      }
    });

    await database.pool.query(
      "update integration_connections set historical_next_attempt_at = now() - interval '1 second' where id = $1",
      [id]
    );
    await service.reconcileConnection((await integrations.findActive(personE))!);
    expect(provider.reconcileCalls).toHaveLength(4);
    expect((await repository.listObservations(personE, { limit: 50 })).items).toHaveLength(9);
    expect(await training.listExternalActivities(personE, 10)).toHaveLength(1);
    const secondHistorical = provider.reconcileCalls[3]!;
    const expectedSecondNewest = new Date(Date.parse(`${historical!.oldest}T00:00:00.000Z`) - 86_400_000)
      .toISOString().slice(0, 10);
    expect(secondHistorical.newest).toBe(expectedSecondNewest);
    expect(await integrations.status(personE)).toMatchObject({
      historicalImport: {
        status: "running",
        processedThroughDate: secondHistorical.oldest,
        failureCode: null
      }
    });

    await integrations.beginDisconnect(personE, "test disconnect");
    await expect(service.startHistoricalImport()).rejects.toThrow("active Intervals.icu connection");
    expect(await integrations.status(personE)).toMatchObject({
      lifecycle: "disconnected",
      historicalImport: { status: "not_requested", processedThroughDate: null }
    });
  });

  it("restarts completed history after reconnect and fences stale claims across disconnect", async () => {
    const integrations = new IntegrationRepository(database);
    const training = new TrainingRepository(database);
    const provider = new FakeHealthDataProvider();
    const cipher = new ConnectionCredentialCipher("v1", new Map([["v1", randomBytes(32)]]));
    const id = "00000000-0000-4000-8000-000000000141";
    const recoveryConnectionId = "00000000-0000-4000-8000-000000000142";
    const credential = cipher.encrypt("reimport-token", `intervals_icu:${personF}:${id}`);
    await integrations.activate({
      id,
      recoveryConnectionId,
      consentId: "00000000-0000-4000-8000-000000000143",
      personId: personF,
      externalUserId: "athlete-f",
      credential,
      authorizationStartedAt: new Date(Date.now() - 1_000)
    });
    await database.pool.query(
      `update integration_connections set
         historical_import_status = 'completed',
         historical_cursor_before = '2000-01-01',
         historical_requested_at = now() - interval '1 hour',
         historical_last_attempt_at = now(),
         historical_completed_at = now(),
         historical_next_attempt_at = null,
         historical_failure_code = null,
         historical_claim_token = null,
         historical_claim_until = null
       where id = $1`,
      [id]
    );

    await integrations.beginDisconnect(personF, "completed history disconnect");
    expect(await integrations.status(personF)).toMatchObject({
      lifecycle: "disconnected",
      historicalImport: { status: "completed", processedThroughDate: "2000-01-01" }
    });
    await integrations.activate({
      id,
      recoveryConnectionId,
      consentId: "00000000-0000-4000-8000-000000000144",
      personId: personF,
      externalUserId: "athlete-f",
      credential,
      authorizationStartedAt: new Date(Date.now() + 1_000)
    });
    const service = new IntegrationService(
      new SyntheticPersonContext(personF), integrations, provider, cipher, repository, training
    );
    expect(await service.startHistoricalImport()).toMatchObject({
      historicalImport: { status: "running", processedThroughDate: null }
    });

    const firstClaimToken = "00000000-0000-4000-8000-000000000145";
    expect(await integrations.claimHistoricalWindow(id, "00000000-0000-4000-8000-000000000144", null, firstClaimToken, 30 * 60_000)).toEqual({
      claimToken: firstClaimToken,
      cursorBefore: null
    });
    expect(await integrations.claimHistoricalWindow(
      id,
      "00000000-0000-4000-8000-000000000144",
      null,
      "00000000-0000-4000-8000-000000000146",
      30 * 60_000
    )).toBeNull();
    expect(await integrations.markHistoricalWindowSucceeded(
      id,
      "00000000-0000-4000-8000-000000000146",
      "2026-01-01",
      false
    )).toBe(false);

    expect(await integrations.markHistoricalImportFailed(id, firstClaimToken, "provider_timeout", true)).toBe(true);
    expect(await integrations.status(personF)).toMatchObject({
      lifecycle: "active",
      historicalImport: { status: "running", processedThroughDate: null, failureCode: "provider_timeout" }
    });
    await database.pool.query(
      "update integration_connections set historical_next_attempt_at = now() - interval '1 second' where id = $1",
      [id]
    );
    const retryClaimToken = "00000000-0000-4000-8000-000000000147";
    expect(await integrations.claimHistoricalWindow(id, "00000000-0000-4000-8000-000000000144", null, retryClaimToken, 30 * 60_000)).not.toBeNull();

    await integrations.beginDisconnect(personF, "claim fencing disconnect");
    expect(await integrations.markHistoricalWindowSucceeded(id, retryClaimToken, "2026-01-01", false)).toBe(false);
    expect(await integrations.status(personF)).toMatchObject({
      lifecycle: "disconnected",
      historicalImport: { status: "not_requested", processedThroughDate: null, failureCode: null }
    });
  });

  it("rejects a stale historical activity response after disconnect and reconnect", async () => {
    const integrations = new IntegrationRepository(database);
    const training = new TrainingRepository(database);
    const provider = new FakeHealthDataProvider();
    const cipher = new ConnectionCredentialCipher("v1", new Map([["v1", randomBytes(32)]]));
    const id = "00000000-0000-4000-8000-000000000151";
    const recoveryConnectionId = "00000000-0000-4000-8000-000000000152";
    const oldConsentId = "00000000-0000-4000-8000-000000000153";
    const newConsentId = "00000000-0000-4000-8000-000000000154";
    const credential = cipher.encrypt("race-token", `intervals_icu:${personG}:${id}`);
    await integrations.activate({
      id,
      recoveryConnectionId,
      consentId: oldConsentId,
      personId: personG,
      externalUserId: "athlete-g",
      credential,
      authorizationStartedAt: new Date(Date.now() - 1_000)
    });
    const service = new IntegrationService(
      new SyntheticPersonContext(personG), integrations, provider, cipher, repository, training
    );
    await service.startHistoricalImport();
    const staleConnection = (await integrations.findActive(personG))!;
    let releaseHistorical!: (result: ProviderReconciliation) => void;
    let reportHistoricalStarted!: () => void;
    const historicalStarted = new Promise<void>((resolve) => { reportHistoricalStarted = resolve; });
    const heldHistorical = new Promise<ProviderReconciliation>((resolve) => { releaseHistorical = resolve; });
    provider.reconcile = async (accessToken: string, oldest: string, newest: string) => {
      provider.reconcileCalls.push({ accessToken, oldest, newest });
      if (provider.reconcileCalls.length === 1) return { wellness: [], activities: [] };
      reportHistoricalStarted();
      return await heldHistorical;
    };

    const staleReconciliation = service.reconcileConnection(staleConnection);
    await historicalStarted;
    await integrations.beginDisconnect(personG, "disconnect while history request is held");
    await integrations.activate({
      id,
      recoveryConnectionId,
      consentId: newConsentId,
      personId: personG,
      externalUserId: "athlete-g",
      credential,
      authorizationStartedAt: new Date(Date.now() + 1_000)
    });
    releaseHistorical({
      wellness: [],
      activities: [{
        identity: "stale-history-activity",
        occurredAt: "2020-01-02T06:00:00.000Z",
        localDate: "2020-01-02",
        timezone: "UTC",
        name: "Stale run",
        durationSeconds: 3_600,
        distanceMeters: 10_000,
        trainingLoad: 75,
        trainingLoadBasis: "relative_training_stress",
        trainingLoadBasisVersion: "intervals-icu-icu-training-load-v1",
        averageHeartRate: 145,
        maximumHeartRate: 175,
        deviceName: "Garmin Test",
        garminAttributed: true
      }]
    });
    await staleReconciliation;

    expect((await database.pool.query(
      "select 1 from integration_activity_facts where connection_id = $1 and provider_identity = 'stale-history-activity'",
      [id]
    )).rowCount).toBe(0);
    expect(await integrations.status(personG)).toMatchObject({
      lifecycle: "active",
      historicalImport: { status: "not_requested", processedThroughDate: null }
    });
    expect(await integrations.connectedRecoveryDelivery(
      personG,
      new Date().toISOString().slice(0, 10)
    )).toMatchObject({
      lifecycle: "active",
      importEnabled: true,
      lastSuccessfulSyncAt: null,
      targetDateRecordReceived: false,
      targetDateSupportedFactsPresent: false
    });
  });

  it("does not let a stale rolling worker claim newly restarted history", async () => {
    const integrations = new IntegrationRepository(database);
    const training = new TrainingRepository(database);
    const provider = new FakeHealthDataProvider();
    const cipher = new ConnectionCredentialCipher("v1", new Map([["v1", randomBytes(32)]]));
    const id = "00000000-0000-4000-8000-000000000161";
    const recoveryConnectionId = "00000000-0000-4000-8000-000000000162";
    const oldConsentId = "00000000-0000-4000-8000-000000000163";
    const newConsentId = "00000000-0000-4000-8000-000000000164";
    const credential = cipher.encrypt("held-rolling-token", `intervals_icu:${personH}:${id}`);
    await integrations.activate({
      id,
      recoveryConnectionId,
      consentId: oldConsentId,
      personId: personH,
      externalUserId: "athlete-h",
      credential,
      authorizationStartedAt: new Date(Date.now() - 1_000)
    });
    await integrations.startHistoricalImport(personH);
    const staleConnection = (await integrations.findActive(personH))!;
    let releaseRolling!: (result: ProviderReconciliation) => void;
    let reportRollingStarted!: () => void;
    const rollingStarted = new Promise<void>((resolve) => { reportRollingStarted = resolve; });
    const heldRolling = new Promise<ProviderReconciliation>((resolve) => { releaseRolling = resolve; });
    provider.reconcile = async (accessToken: string, oldest: string, newest: string) => {
      provider.reconcileCalls.push({ accessToken, oldest, newest });
      reportRollingStarted();
      return await heldRolling;
    };
    const staleService = new IntegrationService(
      new SyntheticPersonContext(personH), integrations, provider, cipher, repository, training
    );

    const staleReconciliation = staleService.reconcileConnection(staleConnection);
    await rollingStarted;
    await integrations.beginDisconnect(personH, "disconnect while rolling request is held");
    await integrations.activate({
      id,
      recoveryConnectionId,
      consentId: newConsentId,
      personId: personH,
      externalUserId: "athlete-h",
      credential,
      authorizationStartedAt: new Date(Date.now() + 1_000)
    });
    await staleService.startHistoricalImport();
    releaseRolling({
      wellness: [{
        identity: "2026-09-19",
        localDate: "2026-09-19",
        timezone: "UTC",
        updatedAt: "2026-09-19T09:00:00.000Z",
        steps: 4_321,
        totalSleepMinutes: null,
        sleepScore: null,
        restingHeartRate: null,
        averageSleepingHeartRate: null,
        hrvRmssd: 58,
        oxygenSaturation: null,
        respirationRate: null,
        bodyBatteryMinimum: null,
        bodyBatteryMaximum: null
      }],
      activities: []
    });
    await staleReconciliation;

    expect(provider.reconcileCalls).toHaveLength(1);
    expect(await integrations.status(personH)).toMatchObject({
      lifecycle: "active",
      lastSuccessfulSyncAt: null,
      historicalImport: { status: "running", processedThroughDate: null, lastAttemptAt: null }
    });
    expect((await database.pool.query(
      "select 1 from integration_inbox where connection_id = $1 and provider_identity = '2026-09-19'",
      [id]
    )).rowCount).toBe(0);
    expect((await database.pool.query(
      "select 1 from recovery_observations where person_id = $1 and local_date = '2026-09-19'",
      [personH]
    )).rowCount).toBe(0);
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

  it("summarizes provider-neutral Recovery evidence without treating partial or poor data as usable", async () => {
    const sourceReference = {
      channel: "manual" as const,
      externalSystem: null,
      externalRecordId: null,
      occurredAt: null
    };
    const common = {
      observedFrom: null,
      observedUntil: null,
      temporalPrecision: "local_date" as const,
      timezone: "UTC",
      connectionId: null,
      consentId: null,
      sourceReference
    };
    await repository.createObservation(personH, {
      ...common,
      kind: "sleep",
      localDate: "2026-09-10",
      quality: "reliable",
      dedupeKey: "coverage:sleep:2026-09-10",
      detail: { type: "sleep", totalSleepMinutes: 440, sleepQuality: 4 }
    });
    await repository.createObservation(personH, {
      ...common,
      kind: "metric",
      localDate: "2026-09-11",
      quality: "poor",
      dedupeKey: "coverage:hrv:2026-09-11",
      detail: { type: "metric", metric: "hrv_rmssd", value: 51, unit: "ms" }
    });
    await repository.createObservation(personH, {
      ...common,
      kind: "metric",
      localDate: "2026-09-11",
      quality: "reliable",
      dedupeKey: "coverage:rhr:2026-09-11",
      detail: { type: "metric", metric: "resting_heart_rate", value: 54, unit: "bpm" }
    });
    await repository.createObservation(personH, {
      ...common,
      kind: "metric",
      localDate: "2026-09-12",
      quality: "reliable",
      dedupeKey: "coverage:body-battery-min:2026-09-12",
      detail: { type: "metric", metric: "body_battery_min", value: 18, unit: "score" }
    });
    await repository.createObservation(personH, {
      ...common,
      kind: "metric",
      localDate: "2026-09-12",
      quality: "reliable",
      dedupeKey: "coverage:body-battery-max:2026-09-12",
      detail: { type: "metric", metric: "body_battery_max", value: 82, unit: "score" }
    });

    const coverage = await repository.getDataCoverage(
      personH,
      "2026-06-15",
      "2026-09-12",
      "2026-09-13"
    );

    expect(coverage.sleep).toEqual({
      firstDataDate: "2026-09-10",
      lastDataDate: "2026-09-10",
      days: [{ localDate: "2026-09-10", usable: true }]
    });
    expect(coverage.hrv).toEqual({
      firstDataDate: "2026-09-11",
      lastDataDate: "2026-09-11",
      days: [{ localDate: "2026-09-11", usable: false }]
    });
    expect(coverage.restingHeartRate.days).toEqual([
      { localDate: "2026-09-11", usable: true }
    ]);
    expect(coverage.bodyBattery.days).toEqual([
      { localDate: "2026-09-12", usable: true }
    ]);
    await database.pool.query(
      `update source_references source
          set evidence_purpose = 'operational_verification'
         from recovery_observations observation
        where observation.person_id = $1
          and observation.source_reference_id = source.id
          and observation.person_id = source.person_id`,
      [personH]
    );
    expect(await repository.getDataCoverage(
      personH,
      "2026-06-15",
      "2026-09-12",
      "2026-09-13"
    )).toEqual({
      sleep: { firstDataDate: null, lastDataDate: null, days: [] },
      hrv: { firstDataDate: null, lastDataDate: null, days: [] },
      restingHeartRate: { firstDataDate: null, lastDataDate: null, days: [] },
      bodyBattery: { firstDataDate: null, lastDataDate: null, days: [] }
    });
    expect(await repository.getDataCoverage(
      personG,
      "2026-06-15",
      "2026-09-12",
      "2026-09-13"
    )).toEqual({
      sleep: { firstDataDate: null, lastDataDate: null, days: [] },
      hrv: { firstDataDate: null, lastDataDate: null, days: [] },
      restingHeartRate: { firstDataDate: null, lastDataDate: null, days: [] },
      bodyBattery: { firstDataDate: null, lastDataDate: null, days: [] }
    });
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
    const baselineClient = await database.pool.connect();
    try {
      expect(await readRecoveryBaselineDays(
        baselineClient, personA, created.localDate, created.localDate
      )).toEqual([expect.objectContaining({ assessmentPresent: true, hardStop: true })]);
      expect(await readTrainingBaselineDays(
        baselineClient,
        personA,
        sessionResponse.json().localDate,
        sessionResponse.json().localDate
      )).toEqual([expect.objectContaining({ workoutSessionCount: 1 })]);
    } finally {
      baselineClient.release();
    }
    await repository.createObservation(personA, {
      kind: "metric",
      observedFrom: "2026-10-25T07:30:00.000Z",
      observedUntil: "2026-10-25T07:30:00.000Z",
      timezone: "Europe/Berlin",
      quality: "reliable",
      connectionId: null,
      consentId: null,
      dedupeKey: "manual:late:assessment-window",
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: "2026-10-25T07:30:00.000Z"
      },
      detail: {
        type: "metric",
        metric: "resting_heart_rate",
        value: 55,
        unit: "bpm"
      }
    });
    const lateEvidenceClient = await database.pool.connect();
    try {
      expect(await readRecoveryBaselineDays(
        lateEvidenceClient, personA, created.localDate, created.localDate
      )).toEqual([expect.objectContaining({
        assessmentPresent: false,
        hardStop: false,
        acuteIllness: true
      })]);
    } finally {
      lateEvidenceClient.release();
    }
    await repository.withdrawObservation(
      personA,
      observation.id,
      "manual:subjective:hard-stop:withdrawn",
      "Corrected hard-stop evidence"
    );
    const correctedBaselineClient = await database.pool.connect();
    try {
      expect(await readRecoveryBaselineDays(
        correctedBaselineClient, personA, created.localDate, created.localDate
      )).toEqual([expect.objectContaining({
        assessmentPresent: false,
        hardStop: false,
        acuteIllness: false
      })]);
    } finally {
      correctedBaselineClient.release();
    }
  });
});
