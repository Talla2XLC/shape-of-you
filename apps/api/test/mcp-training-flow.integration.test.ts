import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { activityFit } from "./fixtures/activity-fit.js";
import { parseFitActivityDetails } from "../src/integrations/intervals-icu/fit-activity-details.js";
import { IntegrationRepository } from "../src/storage/integration-repository.js";
import { RecoveryService } from "../src/recovery/recovery.service.js";
import { DailyContextNoteService } from "../src/daily-context-notes/daily-context-note.service.js";
import { DailyContextNoteRepository } from "../src/storage/daily-context-note-repository.js";
import { RecoveryRepository } from "../src/storage/recovery-repository.js";
import { DailyAssessmentRepository } from "../src/storage/daily-assessment-repository.js";
import { CurrentRecoveryContextService } from "../src/coaching/current-recovery-context.service.js";
import { IntegrationService } from "../src/integrations/integration.service.js";
import { FakeHealthDataProvider } from "../src/integrations/fake-provider.js";
import { ConnectionCredentialCipher } from "../src/integrations/credential-cipher.js";
import { SyntheticPersonContext } from "../src/application/person-context.js";
import { IntegrationProviderError } from "../src/integrations/provider.js";

import { RequestPersonContext } from "../src/application/person-context.js";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { MCP_RECOVERY_RETRY_POLICY, registerMcpRoutes, type McpRouteOptions } from "../src/mcp/server.js";
import { TrainingRepository } from "../src/storage/training-repository.js";
import { TrainingService } from "../src/training/training.service.js";

let container: StartedPostgreSqlContainer;
let database: DatabaseContext;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = "00000000-0000-4000-8000-000000000001";
  await runMigrations(container.getConnectionUri());
  database = createDatabase({ NODE_ENV: "test", HOST: "127.0.0.1", PORT: 3000,
    DATABASE_URL: container.getConnectionUri(), LOG_LEVEL: "silent", PERSON_CONTEXT_MODE: "synthetic",
    SYNTHETIC_PERSON_ID: process.env.SYNTHETIC_PERSON_ID, SHUTDOWN_TIMEOUT_MS: 1000 });
});

afterAll(async () => {
  await database?.pool.end();
  await container?.stop();
});

async function fixture(lostAcknowledgementTool?: string) {
  const personId = randomUUID();
  const context = new RequestPersonContext(personId);
  const repository = new TrainingRepository(database);
  const training = new TrainingService(repository, context);
  await database.pool.query("insert into persons (id, kind, status, timezone) values ($1, 'real', 'active', 'Europe/Belgrade')", [personId]);
  const providerId = randomUUID(), recoveryConnectionId = randomUUID();
  const consentId = randomUUID(), connectionId = randomUUID();
  await database.pool.query("insert into recovery_providers (id, key, name) values ($1, $2, 'MCP flow test')", [providerId, personId]);
  await database.pool.query("insert into recovery_connections (id, person_id, provider_id, dedupe_key) values ($1, $2, $3, $4)", [recoveryConnectionId, personId, providerId, personId]);
  await database.pool.query("insert into recovery_consents (id, person_id, connection_id, purpose, retention_mode) values ($1, $2, $3, 'training', 'indefinite')", [consentId, personId, recoveryConnectionId]);
  await database.pool.query("insert into integration_connections (id, person_id, recovery_connection_id, consent_id, provider_key, external_user_id) values ($1, $2, $3, $4, 'intervals_icu', $5)", [connectionId, personId, recoveryConnectionId, consentId, personId]);
  const unavailable = async (): Promise<never> => { throw new Error("Unrelated service called"); };
  const fastify = Fastify();
  const recovery = new RecoveryService(new RecoveryRepository(database), context);
  const integrations = new IntegrationRepository(database);
  const currentRecovery = new CurrentRecoveryContextService(
    context, new DailyAssessmentRepository(database), integrations, recovery
  );
  const dailyContextNotes = new DailyContextNoteService(new DailyContextNoteRepository(database), context);
  // Only the acknowledgement is faulted: the actual PostgreSQL operation finishes first.
  if (lostAcknowledgementTool) {
    let lost = false;
    const afterCommit = async <T>(operation: Promise<T>): Promise<T> => {
      const committed = await operation;
      if (!lost) { lost = true; throw new Error("Synthetic acknowledgement loss after commit"); }
      return committed;
    };
    if (lostAcknowledgementTool === "record_recovery_observation") {
      const original = recovery.createObservation.bind(recovery);
      vi.spyOn(recovery, "createObservation").mockImplementation((input) => afterCommit(original(input)));
    } else if (lostAcknowledgementTool === "correct_recovery_observation") {
      const original = recovery.correctObservation.bind(recovery);
      vi.spyOn(recovery, "correctObservation").mockImplementation((id, input) => afterCommit(original(id, input)));
    } else if (lostAcknowledgementTool === "record_daily_context_note") {
      const original = dailyContextNotes.create.bind(dailyContextNotes);
      vi.spyOn(dailyContextNotes, "create").mockImplementation((input) => afterCommit(original(input)));
    } else {
      const original = dailyContextNotes.correct.bind(dailyContextNotes);
      vi.spyOn(dailyContextNotes, "correct").mockImplementation((id, input) => afterCommit(original(id, input)));
    }
  }
  registerMcpRoutes({
    fastify, issuer: "https://identity.example.test", resource: "https://api.example.test/mcp",
    // OAuth cryptography has its own suite; domain results here are never mocked.
    authorizer: { authorize: async () => ({ personId, roles: ["owner"] }) },
    personContext: context,
    services: {
      training,
      weights: { list: unavailable, create: unavailable, correct: unavailable },
      bodyMeasurements: { list: unavailable, create: unavailable, correct: unavailable },
      nutrition: { listMeals: unavailable, createMeal: unavailable, correctMeal: unavailable },
      recovery,
      dailyContextNotes,
      dailyProjection: { projection: unavailable },
      currentRecoveryContext: { read: () => currentRecovery.read(new Date("2026-10-06T12:00:00.000Z")) }
    } satisfies McpRouteOptions["services"]
  });
  let requestId = 0;
  const rawCall = async (name: string, args: object = {}) => {
    const response = await fastify.inject({ method: "POST", url: "/mcp",
      headers: { accept: "application/json, text/event-stream", authorization: "Bearer test" },
      payload: { jsonrpc: "2.0", id: ++requestId, method: "tools/call", params: { name, arguments: args } }
    });
    expect(response.statusCode).toBe(200);
    const result = response.json().result;
    expect(result, JSON.stringify(response.json())).toBeDefined();
    return result;
  };
  const call = async (name: string, args: object = {}) => {
    const result = await rawCall(name, args);
    expect(result.isError, result.content?.[0]?.text).not.toBe(true);
    return result.structuredContent;
  };
  const saved = await call("save_confirmed_training_program", {
    expectedActiveProgramId: null, expectedLockVersion: null, name: "Ahilej A/B", note: null,
    cadence: { kind: "rolling_weekly", strengthSessionsPerWeek: 2, workoutSequence: [1, 2], lightCardio: null },
    workouts: ["A", "B"].map((name) => ({ name: `Ahilej ${name}`, prescriptions: [{
      exercise: { name: `${personId} press`, category: "strength", movementPattern: null, equipment: null, instructions: null, note: null },
      loadBasis: "external_weight", targetWeightKg: 20, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12,
      targetRir: 2, progressionIncrementKg: 2.5, note: null
    }] }))
  });
  const program = saved.program;
  await call("set_activity_recording_mode", { expectedLockVersion: 0, title: "Силовая тренировка" });
  const importActivity = async (date = "2026-10-02", name = "Силовая тренировка", durationSeconds = 3600) => {
    const providerIdentity = randomUUID();
    await repository.importExternalActivity({ connectionId, personId, consentId, providerIdentity,
      normalizedChecksum: "a".repeat(64), occurredAt: `${date}T12:00:00.000Z`, localDate: date,
      timezone: "Europe/Belgrade", name, durationSeconds, distanceMeters: null,
      trainingLoad: 20, trainingLoadBasis: "relative_training_stress", trainingLoadBasisVersion: "1",
      averageHeartRate: 107, maximumHeartRate: 142, deviceName: "Garmin Forerunner 970",
      sourceProvider: "intervals_icu", garminAttributed: true });
    return (await repository.listExternalActivities(personId, 20)).find((item) => item.providerIdentity === providerIdentity)!;
  };
  return { fastify, call, rawCall, program, importActivity, repository, personId, connectionId, consentId, recoveryConnectionId, integrations };
}

describe("Current Recovery MCP composition with PostgreSQL", () => {
  it("keeps night sleep and resleep distinct, diagnoses an owner read failure and then reads successfully", async () => {
    const { fastify, call, rawCall, integrations, personId } = await fixture();
    try {
      for (const [key, minutes] of [["synthetic-night", 360], ["synthetic-resleep", 50]] as const) {
        await call("record_recovery_observation", {
          localDate: "2026-10-06", timezone: "Europe/Belgrade", kind: "sleep",
          quality: "estimated", dedupeKey: key,
          detail: { type: "sleep", totalSleepMinutes: minutes }
        });
      }
      const delivery = vi.spyOn(integrations, "connectedRecoveryDelivery");
      delivery.mockRejectedValueOnce(new Error("Synthetic owner read interruption"));
      const failed = await rawCall("get_current_recovery_context");
      expect(failed).toMatchObject({ isError: true,
        structuredContent: { outcome: "unknown", reason: "read_failed", diagnosticId: expect.any(String) } });
      expect(failed.content[0].text).toContain(`Diagnostic ID: ${failed.structuredContent.diagnosticId}`);
      expect(JSON.stringify(failed)).not.toContain("Synthetic owner read interruption");
      const context = await call("get_current_recovery_context");
      expect(delivery).toHaveBeenLastCalledWith(personId, "2026-10-06");
      expect(context).toMatchObject({ state: "available", localDate: "2026-10-06", timezone: "Europe/Belgrade" });
      expect(context.observations.items.map((item: { detail: { totalSleepMinutes: number } }) =>
        item.detail.totalSleepMinutes).sort((a: number, b: number) => a - b)).toEqual([50, 360]);
      expect(context.observations.items).toHaveLength(2);
      expect(context.metricDelivery).toHaveLength(10);
      expect(context.observations.items.every((item: object) => !Object.hasOwn(item, "personId"))).toBe(true);
      expect(JSON.stringify(context)).not.toContain(personId);
      const facts = await call("list_recovery_observations", { localDate: "2026-10-06" });
      expect(facts.items).toHaveLength(2);
      const training = await rawCall("get_training_context_v2", { localDate: "2026-10-06" });
      expect(training.isError).not.toBe(true);
      expect(training.content[0].text).toContain("do not recommend today's strength workout");
      expect(training.content[0].text).toContain("A successful daily context with a missing individual metric is different");
    } finally { vi.restoreAllMocks(); await fastify.close(); }
  });
});

describe("Recovery MCP retries after lost acknowledgement with PostgreSQL", () => {
  it.each(["record_recovery_observation", "correct_recovery_observation",
    "record_daily_context_note", "correct_daily_context_note"])(
    "%s preserves the committed fact on an exact retry and keeps distinct reports separate", async (tool) => {
      const { fastify, call, rawCall, personId } = await fixture(tool);
      try {
        const localDate = "2026-09-14", timezone = "Europe/Belgrade";
        const isNote = tool.includes("context_note");
        const readTool = isNote ? "list_daily_context_notes" : "list_recovery_observations";
        const createTool = isNote ? "record_daily_context_note" : "record_recovery_observation";
        const sourceReference = { channel: "manual", externalSystem: null, externalRecordId: null, occurredAt: null };
        const base = isNote
          ? { localDate, timezone, sourceReference, text: "Synthetic resleep of unknown duration", contextKind: "general" }
          : { kind: "metric", localDate, timezone, temporalPrecision: "local_date", quality: "reliable", sourceReference,
            detail: { type: "metric", metric: "hrv_rmssd", value: 57, unit: "ms" } };
        const original = tool.startsWith("correct")
          ? await call(createTool, { ...base, dedupeKey: "synthetic:original-report" }) : null;
        const command = { ...base, dedupeKey: "synthetic:stable-command",
          ...(original ? { id: original.id, reason: "Synthetic correction" } : {}) };
        const failed = await rawCall(tool, command);
        expect(failed).toMatchObject({ isError: true, structuredContent: { outcome: "unknown", reason: "write_failed" } });
        expect(failed.content[0].text).toContain(MCP_RECOVERY_RETRY_POLICY);
        const read = await rawCall(readTool, { localDate });
        expect(read.content[0].text).toContain(MCP_RECOVERY_RETRY_POLICY);
        expect(read.structuredContent.items).toHaveLength(1);
        const committed = read.structuredContent.items[0];
        expect(committed.dedupeKey).toBe(command.dedupeKey);
        expect(committed.supersedesId).toBe(original?.id ?? null);
        const sourcesBefore = await database.pool.query("select id from source_references where person_id=$1", [personId]);
        const repeated = await rawCall(tool, command);
        expect(repeated.isError).not.toBe(true);
        expect(repeated.structuredContent).toEqual(committed);
        expect(repeated.content[0].text).toContain(MCP_RECOVERY_RETRY_POLICY);
        expect((await call(readTool, { localDate })).items).toEqual([committed]);
        expect((await database.pool.query("select id from source_references where person_id=$1", [personId])).rowCount)
          .toBe(sourcesBefore.rowCount);
        if (original) {
          const stale = await rawCall(tool, { ...command, dedupeKey: "synthetic:different-correction" });
          expect(stale).toMatchObject({ isError: true, structuredContent: {
            outcome: "not_saved", reason: "stale_or_conflicting_fact" } });
          expect((await call(readTool, { localDate })).items).toEqual([committed]);
        }
        // This new report intentionally has the same value and date, but a distinct identity.
        const separate = await call(createTool, { ...base, dedupeKey: "synthetic:distinct-report" });
        expect(separate.id).not.toBe(committed.id);
        expect((await call(readTool, { localDate })).items).toHaveLength(2);
        const initialized = await fastify.inject({ method: "POST", url: "/mcp",
          headers: { accept: "application/json, text/event-stream", authorization: "Bearer test" },
          payload: { jsonrpc: "2.0", id: "retry-policy", method: "initialize", params: {
            protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } } });
        expect(initialized.json().result.instructions).toContain(MCP_RECOVERY_RETRY_POLICY);
        const catalog = await fastify.inject({ method: "POST", url: "/mcp",
          headers: { accept: "application/json, text/event-stream", authorization: "Bearer test" },
          payload: { jsonrpc: "2.0", id: "retry-tools", method: "tools/list", params: {} } });
        for (const published of catalog.json().result.tools.filter((item: { name: string }) =>
          ["record_recovery_observation", "correct_recovery_observation", "list_recovery_observations",
            "record_daily_context_note", "correct_daily_context_note", "list_daily_context_notes"].includes(item.name))) {
          expect(published.description).toContain(MCP_RECOVERY_RETRY_POLICY);
          if (published.name.startsWith("record") || published.name.startsWith("correct")) {
            expect(published.inputSchema.properties.dedupeKey.description).toContain("original key");
          }
        }
      } finally { await fastify.close(); }
    });
});

describe("MCP training conversation flow with PostgreSQL", () => {
  it("imports a FIT once and delivers actual segment evidence through MCP, then corrects and withdraws without summary changes", async () => {
    const { fastify, call, repository, personId, connectionId, consentId } = await fixture();
    try {
      const cipher = new ConnectionCredentialCipher("test", new Map([["test", Buffer.alloc(32, 1)]]));
      const credential = cipher.encrypt("synthetic-token", `intervals_icu:${personId}:${connectionId}`);
      await database.pool.query("update integration_connections set credential_key_id=$2, credential_nonce=$3, credential_ciphertext=$4, credential_tag=$5 where id=$1",
        [connectionId, credential.keyId, credential.nonce, credential.ciphertext, credential.tag]);
      const provider = new FakeHealthDataProvider();
      const identity = randomUUID();
      provider.reconciliation = { wellness: [], activities: [{ identity, fileType: "fit", occurredAt: "2026-10-04T14:00:00Z",
        localDate: "2026-10-04", timezone: "Europe/Belgrade", name: "Бег на дорожке", durationSeconds: 22,
        distanceMeters: 90, trainingLoad: 20, trainingLoadBasis: "relative_training_stress", trainingLoadBasisVersion: "1",
        averageHeartRate: 130, maximumHeartRate: 180, deviceName: "Garmin", garminAttributed: true }] };
      const initialDamage = activityFit(); initialDamage[initialDamage.length - 1]! ^= 1;
      provider.activityFiles.set(identity, initialDamage);
      const integrations = new IntegrationRepository(database);
      const service = new IntegrationService(new SyntheticPersonContext(personId), integrations, provider, cipher, new RecoveryRepository(database), repository);
      await service.reconcilePerson(personId);
      const context = await call("get_training_context_v2", { localDate: "2026-10-04" });
      const activityId = context.recentExternalActivities[0].id;
      expect(await call("get_external_activity_details", { activityId })).toMatchObject({ availability: "unavailable", latestImportIssue: "invalid_fit", buckets: [] });
      await database.pool.query("delete from integration_inbox where connection_id=$1", [connectionId]);
      provider.activityFiles.set(identity, activityFit());
      await service.reconcilePerson(personId);
      const first = await call("get_external_activity_details", { activityId, bucketSeconds: 30, zoneBoundariesBpm: [130, 160] });
      expect(first).toMatchObject({ availability: "available", latestImportIssue: null, sourceActivityVersion: activityId, zoneBasis: "analysis_supplied",
        buckets: [{ activeSeconds: 22, channels: { heartRateBpm: { maximum: 180, coveredSeconds: 19, average: 2520 / 19 } }, zoneSeconds: [12, 1, 6] }] });
      expect(first.channels).toContain("powerW");
      await service.reconcilePerson(personId);
      expect(provider.activityFileCalls).toHaveLength(2);
      expect((await database.pool.query("select id from external_activity_details where person_id=$1", [personId])).rowCount).toBe(1);
      // A fresh daily review of the same summary must inspect the corrected original file.
      const review = async () => {
        await database.pool.query("delete from integration_inbox where connection_id=$1", [connectionId]);
        await service.reconcilePerson(personId);
      };
      provider.activityFiles.set(identity, activityFit(190));
      await review();
      const corrected = await call("get_external_activity_details", { activityId });
      expect(corrected.detailsVersion).not.toBe(first.detailsVersion);
      expect(corrected.buckets[0].channels.heartRateBpm.maximum).toBe(190);
      expect((await repository.listExternalActivities(personId, 20))).toHaveLength(1);
      await review();
      expect((await database.pool.query("select id from external_activity_details where person_id=$1", [personId])).rowCount).toBe(2);
      const damaged = activityFit(); damaged[damaged.length - 1]! ^= 1;
      provider.activityFiles.set(identity, damaged);
      await review();
      expect(await call("get_external_activity_details", { activityId })).toMatchObject({ availability: "available", latestImportIssue: "invalid_fit", detailsVersion: corrected.detailsVersion });
      const unattempted = await integrations.recordInbox(connectionId, consentId, "activity", identity, "a".repeat(64));
      expect(unattempted.state).toBe("process");
      expect((await call("get_external_activity_details", { activityId })).latestImportIssue).toBe("invalid_fit");
      if (unattempted.state !== "process") throw new Error("Expected a pending receipt");
      await integrations.setActivityDetailsIssue(connectionId, consentId, unattempted.receiptId, null);
      expect((await call("get_external_activity_details", { activityId })).latestImportIssue).toBeNull();
      provider.activityFiles.set(identity, new Uint8Array(2000001));
      await review();
      expect(await call("get_external_activity_details", { activityId })).toMatchObject({ availability: "available", latestImportIssue: "limit_exceeded", detailsVersion: corrected.detailsVersion });
      vi.spyOn(provider, "originalActivityFile").mockRejectedValueOnce(new IntegrationProviderError("provider_timeout"));
      await review();
      expect(await call("get_external_activity_details", { activityId })).toMatchObject({ availability: "available", latestImportIssue: "provider_unavailable", detailsVersion: corrected.detailsVersion });
      provider.activityFiles.set(identity, activityFit(190));
      const pending = (await database.pool.query("select id from integration_inbox where connection_id=$1", [connectionId])).rows[0].id;
      await service.reconcilePerson(personId);
      expect((await database.pool.query("select id, activity_details_issue from integration_inbox where connection_id=$1", [connectionId])).rows).toEqual([{ id: pending, activity_details_issue: null }]);
      expect((await call("get_external_activity_details", { activityId })).latestImportIssue).toBeNull();
      provider.activityFiles.set(identity, null);
      await review();
      expect(await call("get_external_activity_details", { activityId })).toMatchObject({ availability: "no_supported_data", latestImportIssue: "source_file_unavailable", records: [], buckets: [] });
      expect(await repository.importExternalActivityDetails({ personId, connectionId, consentId: randomUUID(), providerIdentity: identity,
        fileChecksum: "c".repeat(64), normalizationVersion: "standard-fit-details-v1", payload: parseFitActivityDetails(activityFit()) })).toBe(false);
    } finally { await fastify.close(); }
  });

  it("scopes detail reads to Person and current consent, preserves summary lineage and erases stored samples", async () => {
    const { fastify, call, importActivity, repository, personId, connectionId, consentId, recoveryConnectionId } = await fixture();
    try {
      const activity = await importActivity("2026-10-04", "Бег на дорожке", 30);
      const input = { personId, connectionId, consentId, providerIdentity: activity.providerIdentity, fileChecksum: "a".repeat(64),
        normalizationVersion: "standard-fit-details-v1", payload: parseFitActivityDetails(activityFit()) };
      expect(await repository.importExternalActivityDetails(input)).toBe(true);
      const integrations = new IntegrationRepository(database);
      const receipt = await integrations.recordInbox(connectionId, consentId, "activity", activity.providerIdentity, "f".repeat(64));
      if (receipt.state !== "process") throw new Error("Missing test receipt");
      expect(await integrations.setActivityDetailsIssue(connectionId, consentId, receipt.receiptId, "unsupported_fit")).toBe(true);
      await expect(repository.readExternalActivityDetails(randomUUID(), activity.id)).rejects.toThrow("not found");
      const details = await call("get_external_activity_details", { activityId: activity.id });
      expect(details.latestImportIssue).toBe("unsupported_fit");
      await repository.importExternalActivity({ ...activity, consentId, name: "Corrected title", normalizedChecksum: "b".repeat(64) });
      const current = (await repository.listExternalActivities(personId, 20))[0]!;
      const linked = await call("get_external_activity_details", { activityId: current.id });
      expect(linked.detailsVersion).toBe(details.detailsVersion);
      expect(linked.sourceActivityVersion).toBe(activity.id);
      await expect(repository.readExternalActivityDetails(personId, activity.id)).rejects.toThrow("not found");
      const newConsent = randomUUID();
      await database.pool.query("insert into recovery_consents (id, person_id, connection_id, purpose, retention_mode) values ($1,$2,$3,'training','indefinite')", [newConsent, personId, recoveryConnectionId]);
      await database.pool.query("update integration_connections set consent_id=$2 where id=$1", [connectionId, newConsent]);
      expect(await call("get_external_activity_details", { activityId: current.id })).toMatchObject({ availability: "not_imported", latestImportIssue: null, records: [] });
      expect(await integrations.setActivityDetailsIssue(connectionId, consentId, receipt.receiptId, "invalid_fit")).toBe(false);
      expect(await repository.importExternalActivityDetails(input)).toBe(false);
      expect(await repository.importExternalActivityDetails({ ...input, consentId: newConsent })).toBe(true);
      await database.pool.query("update recovery_consents set status='revoked', revoked_at=now(), revocation_reason='test' where id=$1", [newConsent]);
      expect((await call("get_external_activity_details", { activityId: current.id })).availability).toBe("not_imported");
      await database.pool.query("delete from recovery_connections where id=$1", [recoveryConnectionId]);
      expect((await database.pool.query("select id from external_activity_details where person_id=$1", [personId])).rowCount).toBe(0);
    } finally { await fastify.close(); }
  });
  it("keeps frequency advisory across Monday and preserves mixed-precision A/B after the window expires", async () => {
    const { fastify, call, program } = await fixture();
    try {
      for (const [index, date] of ["2026-09-27", "2026-09-28", "2026-09-29", "2026-10-02", "2026-10-03"].entries()) {
        await call("record_workout_session_v2", {
          // Oct 3 shortly after local midnight precedes the previous date's synthetic UTC end.
          occurredAt: index === 4 ? "2026-10-02T22:15:00.000Z" : null,
          temporalPrecision: index === 4 ? "instant" : "local_date", localDate: date, timezone: "Europe/Belgrade",
          programVersionId: program.activeVersionId, programWorkoutPosition: index % 2 + 1,
          externalActivityId: null, completionState: "completed", workoutName: "Reported workout",
          venueLabel: null, feeling: null, note: null, exercises: [], dedupeKey: date,
          sourceReference: { channel: "manual", externalSystem: "chatgpt", externalRecordId: date, occurredAt: null },
          confidence: 1
        });
      }
      for (const [date, from, strengthCompleted] of [
        ["2026-10-04", "2026-09-28", 4], ["2026-10-05", "2026-09-29", 3], ["2026-10-12", "2026-10-06", 0]
      ] as const) {
        const result = await call("get_training_context_v2", { localDate: date, historyLimit: 1 });
        expect(result.nextStep).toMatchObject({ state: "training_options", policyVersion: "training-next-step-v5",
          recentProgress: { from, to: date, strengthCompleted, strengthTarget: 2, targetMeaning: "guidance" },
          strength: { workoutPosition: 2 }, lastStrengthLocalDate: "2026-10-03" });
      }
    } finally { await fastify.close(); }
  });
  it("confirms a historical date-only workout/ Garmin pair from today's context and counts it once", async () => {
    const { fastify, call, program, importActivity } = await fixture();
    try {
      const session = await call("record_workout_session_v2", {
        occurredAt: null, temporalPrecision: "local_date", localDate: "2026-10-02", timezone: "Europe/Belgrade",
        programVersionId: program.activeVersionId, programWorkoutPosition: 1, externalActivityId: null,
        completionState: "completed", workoutName: "Ahilej A", venueLabel: "Ahilej", feeling: null, note: null,
        exercises: [{ exerciseVersionId: null, exerciseLabel: "Smith squat", loadBasis: "external_weight",
          feeling: null, note: null, sets: [{ weightKg: 60, reps: 10, rir: null }] }],
        sourceReference: { channel: "manual", externalSystem: "chatgpt", externalRecordId: "reported-a", occurredAt: null },
        dedupeKey: "reported-a", confidence: 1
      });
      const activity = await importActivity();
      // A newer unrelated import must not hide the exact blocker with historyLimit=1.
      await importActivity("2026-10-03", "Прогулка", 300);
      const before = await call("get_training_context_v2", { localDate: "2026-10-04", historyLimit: 1 });
      expect(before.nextStep).toMatchObject({ state: "needs_classification", externalActivityId: activity.id });
      expect(before.pendingActivityLinkQuestion).toMatchObject({ localDate: "2026-10-02", options: [{ sessionId: session.id, externalActivityId: activity.id }] });
      // Reproduce the wrong-date classification attempt without weakening its guard.
      expect(await call("classify_external_activity", {
        expectedExternalActivityId: activity.id, expectedLocalDate: "2026-10-02",
        expectedActiveProgramId: program.id, expectedActiveVersionId: program.activeVersionId,
        expectedLockVersion: program.lockVersion, expectedCurrentClassificationId: null,
        classification: { kind: "program_workout", workoutPosition: 1 }
      })).toMatchObject({ outcome: "not_pending" });
      const command = { sessionId: session.id, externalActivityId: activity.id, expectedExternalActivityId: null };
      expect(await call("confirm_workout_activity_link", command)).toMatchObject({ outcome: "created" });
      expect(await call("confirm_workout_activity_link", command)).toMatchObject({ outcome: "unchanged" });
      const after = await call("get_training_context_v2", { localDate: "2026-10-04", historyLimit: 1 });
      expect(after.pendingActivityLinkQuestion).toBeUndefined();
      // Rolling frequency is advisory, but the linked event must count exactly once.
      expect(after.nextStep).toMatchObject({ state: "training_options", strength: { workoutPosition: 2, workoutName: "Ahilej B" } });
      expect(after.nextStep.recentProgress).toMatchObject({ strengthCompleted: 1, strengthTarget: 2, targetMeaning: "guidance" });
      const sessions = await call("list_workout_sessions_v2", { localDate: "2026-10-02" });
      expect(sessions.items).toHaveLength(1);
      expect(sessions.items[0]).toMatchObject({ id: session.id, externalActivityId: activity.id, completionState: "completed" });
    } finally { await fastify.close(); }
  });

  it("accepts historical classification against the exact date of the displayed context", async () => {
    const { fastify, call, importActivity } = await fixture();
    try {
      const activity = await importActivity();
      const before = await call("get_training_context_v2", { localDate: "2026-10-04", historyLimit: 1 });
      const program = before.program;
      expect(before.nextStep).toMatchObject({ state: "needs_classification", localDate: "2026-10-04", externalActivityId: activity.id });
      const command = { expectedExternalActivityId: activity.id, expectedLocalDate: before.nextStep.localDate,
        expectedActiveProgramId: program.id, expectedActiveVersionId: program.activeVersionId,
        expectedLockVersion: program.lockVersion, expectedCurrentClassificationId: null,
        classification: { kind: "program_workout", workoutPosition: 1 } };
      const classified = await call("classify_external_activity", command);
      expect(classified).toMatchObject({ outcome: "created" });
      expect(await call("classify_external_activity", { ...command, expectedCurrentClassificationId: classified.classification.id }))
        .toMatchObject({ outcome: "unchanged" });
      expect(await call("classify_external_activity", command)).toMatchObject({ outcome: "stale" });
      const after = await call("get_training_context_v2", { localDate: "2026-10-04", historyLimit: 1 });
      expect(after.nextStep).toMatchObject({ state: "training_options", strength: { workoutPosition: 2 } });
    } finally { await fastify.close(); }
  });
});


describe("MCP HRV screenshot and resleep capture", () => {
  it("preserves account nightly values, manual nightly values and labelled context without inventing full sleep", async () => {
    const { fastify, call, personId, recoveryConnectionId, consentId } = await fixture();
    try {
      const localDate = "2026-10-05", timezone = "Europe/Belgrade";
      const repository = new RecoveryRepository(database);
      await database.pool.query("insert into recovery_consent_kinds (consent_id, kind) values ($1, 'metric'), ($1, 'sleep')", [consentId]);
      const base = { localDate, timezone, observedFrom: null, observedUntil: null,
        temporalPrecision: "local_date" as const, quality: "reliable" as const,
        connectionId: recoveryConnectionId, consentId,
        sourceReference: { channel: "account" as const, externalSystem: "intervals_icu_wellness",
          externalRecordId: "synthetic-night", occurredAt: null } };
      await repository.createObservation(personId, { ...base, kind: "metric", dedupeKey: "account-hrv",
        detail: { type: "metric", metric: "hrv_rmssd", value: 41, unit: "ms" } });
      await repository.createObservation(personId, { ...base, kind: "sleep", dedupeKey: "account-sleep",
        detail: { type: "sleep", totalSleepMinutes: 285, sleepQuality: null } });
      const nightly = { localDate, timezone, kind: "metric", temporalPrecision: "local_date", quality: "reliable",
        sourceReference: { channel: "manual", externalSystem: "wearable_screenshot_report",
          externalRecordId: "synthetic:nightly-screenshot", occurredAt: null }, dedupeKey: "photo-nightly",
        detail: { type: "metric", metric: "hrv_rmssd", value: 51, unit: "ms" } };
      const saved = await call("record_recovery_observation", nightly);
      expect((await call("record_recovery_observation", nightly)).id).toBe(saved.id);
      const note = { localDate, timezone, dedupeKey: "photo-context", contextKind: "general",
        text: "Garmin: HRV за 7 дней 53 мс, baseline 44–66 мс, balanced. Досып после пробуждения; полная длительность сна неизвестна.",
        confidence: 1,
        sourceReference: { channel: "manual", externalSystem: "wearable_screenshot_report",
          externalRecordId: "synthetic:context-screenshot", occurredAt: null } };
      const rejected = await fastify.inject({ method: "POST", url: "/mcp",
        headers: { accept: "application/json, text/event-stream", authorization: "Bearer test" },
        payload: { jsonrpc: "2.0", id: "invalid-eligibility", method: "tools/call",
          params: { name: "record_daily_context_note", arguments: { ...note, baselineEligibility: "exclude" } } }
      });
      expect(rejected.json().result).toMatchObject({ isError: true,
        structuredContent: { outcome: "not_saved", reason: "invalid_baseline_eligibility" } });
      expect((await call("list_daily_context_notes", { localDate })).items).toHaveLength(0);
      const savedNote = await call("record_daily_context_note", note);
      expect((await call("record_daily_context_note", note)).id).toBe(savedNote.id);
      const facts = (await call("list_recovery_observations", { localDate })).items;
      expect(facts).toHaveLength(3);
      expect(facts.filter((fact: { detail: { type: string } }) => fact.detail.type === "metric")
        .map((fact: { detail: { value: number }; sourceReference: { channel: string } }) =>
          [fact.detail.value, fact.sourceReference.channel])).toEqual(expect.arrayContaining([[41, "account"], [51, "manual"]]));
      expect(facts.find((fact: { detail: { type: string } }) => fact.detail.type === "sleep").detail.totalSleepMinutes).toBe(285);
      expect(saved.connectionId).toBeNull();
      expect(saved.consentId).toBeNull();
      expect(saved.localDate).toBe(localDate);
      const notes = (await call("list_daily_context_notes", { localDate })).items;
      expect(notes).toHaveLength(1);
      expect(notes[0].text).toBe(note.text);
      expect(notes[0].sourceReference.channel).toBe("manual");
    } finally { await fastify.close(); }
  });
});
