import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "@shape-of-you/config";

import { buildApp, getFastifyInstance } from "../src/app.js";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { DailyAssessmentRepository } from "../src/storage/daily-assessment-repository.js";
import { RecoveryRepository } from "../src/storage/recovery-repository.js";
import { readRecoveryBaselineDays } from "../src/recovery/personal-baseline-history.js";
import { loadRetrospectiveEvidence } from "../src/commands/run-daily-assessment-retrospective.js";

const personId = "00000000-0000-4000-8000-000000000001";
const otherPersonId = "00000000-0000-4000-8000-000000000002";
let app: NestFastifyApplication;
let container: StartedPostgreSqlContainer;
let database: DatabaseContext;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_daily_assessment_test")
    .withUsername("shape_of_you")
    .withPassword("shape_of_you")
    .start();
  const databaseUrl = container.getConnectionUri();
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = personId;
  await runMigrations(databaseUrl);
  const config: AppConfig = {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 3_000,
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: "silent",
    PERSON_CONTEXT_MODE: "synthetic",
    SYNTHETIC_PERSON_ID: personId,
    SHUTDOWN_TIMEOUT_MS: 1_000
  };
  database = createDatabase(config);
  await database.pool.query(
    "insert into persons (id, kind, status) values ($1, 'real', 'active')",
    [otherPersonId]
  );
  app = await buildApp({ config, database });
});

afterAll(async () => {
  await app?.close();
  await database?.pool.end();
  await container?.stop();
});

describe("API-owned daily assessment", () => {
  it("ignores operational travel notes in retrospective baseline exclusions", async () => {
    const sourceRows = await database.pool.query<{ id: string; evidence_purpose: string }>(
      `insert into source_references
         (person_id, channel, evidence_purpose, contains_sensitive_data)
       values ($1, 'manual', 'operational_verification', false),
              ($1, 'manual', 'person_context', false)
       returning id, evidence_purpose::text`,
      [personId]
    );
    const operationalSource = sourceRows.rows.find(
      (row) => row.evidence_purpose === "operational_verification"
    )!;
    const personSource = sourceRows.rows.find(
      (row) => row.evidence_purpose === "person_context"
    )!;
    await database.pool.query(
      `insert into daily_context_notes
         (person_id, local_date, timezone, text, context_kind,
          baseline_eligibility, source, source_reference_id, dedupe_key)
       values ($1, '2026-09-01', 'UTC', 'synthetic travel', 'travel',
               'exclude', 'manual', $2, 'operational-travel'),
              ($1, '2026-09-02', 'UTC', 'travel', 'travel',
               'exclude', 'manual', $3, 'person-travel')`,
      [personId, operationalSource.id, personSource.id]
    );
    const client = await database.pool.connect();
    try {
      const evidence = await loadRetrospectiveEvidence(
        client, personId, "2026-09-01", "2026-09-02"
      );
      expect(evidence).toHaveLength(2);
      expect(evidence.find((day) => day.localDate === "2026-09-01"))
        .toMatchObject({ baselineExcluded: false });
      expect(evidence.find((day) => day.localDate === "2026-09-02"))
        .toMatchObject({ baselineExcluded: true });
    } finally {
      client.release();
    }
  });

  it("performs no Coaching writes during counterfactual replay", async () => {
    const before = await database.pool.query<{ recommendations: string; details: string }>(
      `select
         (select count(*) from coaching_recommendations)::text as recommendations,
         (select count(*) from coaching_daily_assessment_details)::text as details`
    );
    const client = await database.pool.connect();
    try {
      await loadRetrospectiveEvidence(client, otherPersonId, "2026-08-01", "2026-08-03");
    } finally {
      client.release();
    }
    const after = await database.pool.query<{ recommendations: string; details: string }>(
      `select
         (select count(*) from coaching_recommendations)::text as recommendations,
         (select count(*) from coaching_daily_assessment_details)::text as details`
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("requires Person timezone and versions snapshots when typed evidence changes", async () => {
    const fastify = getFastifyInstance(app);
    const unset = await fastify.inject({ method: "GET", url: "/v1/daily-assessment" });
    expect(unset.statusCode, unset.body).toBe(200);
    expect(unset.json()).toEqual({ state: "timezone_required", timezone: null });

    const preferences = await fastify.inject({
      method: "PUT",
      url: "/v1/daily-assessment/preferences",
      payload: { timezone: "Europe/Moscow" }
    });
    expect(preferences.statusCode, preferences.body).toBe(200);

    const first = await fastify.inject({ method: "GET", url: "/v1/daily-assessment" });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({
      state: "available",
      timezone: "Europe/Moscow",
      status: "insufficient_data",
      recommendedAction: { type: "record_recovery_check_in" },
      policyVersion: "daily-assessment-v1"
    });

    const repeated = await fastify.inject({ method: "GET", url: "/v1/daily-assessment" });
    expect(repeated.json().snapshotId).toBe(first.json().snapshotId);

    const now = new Date();
    const weight = await fastify.inject({
      method: "POST",
      url: "/v1/weight-measurements",
      payload: {
        measuredAt: now.toISOString(),
        timezone: "Europe/Moscow",
        weightKg: 77.2,
        dedupeKey: "daily-assessment:weight:1",
        sourceReference: {
          channel: "manual",
          externalSystem: null,
          externalRecordId: null,
          occurredAt: now.toISOString()
        }
      }
    });
    expect(weight.statusCode, weight.body).toBe(201);

    const changed = await fastify.inject({ method: "GET", url: "/v1/daily-assessment" });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().snapshotId).not.toBe(first.json().snapshotId);
    expect(changed.json().evidenceChecksum).not.toBe(first.json().evidenceChecksum);
    expect(changed.json().missingImportantData).not.toContain("weight");

    const rows = await database.pool.query(
      "select count(*)::int as count from coaching_daily_assessment_details where person_id = $1",
      [personId]
    );
    expect(rows.rows[0].count).toBe(2);

    const dailyRepository = new DailyAssessmentRepository(database);
    await dailyRepository.setTimezone(otherPersonId, "Europe/Moscow");
    const changedBody = changed.json();
    const sameEvidence = {
      localDate: changedBody.localDate,
      timezone: changedBody.timezone,
      status: changedBody.status,
      usedFacts: changedBody.usedFacts,
      missingImportantData: changedBody.missingImportantData,
      reasons: changedBody.reasons,
      recommendedAction: changedBody.recommendedAction,
      alternatives: changedBody.alternatives,
      limitations: changedBody.limitations,
      confidence: changedBody.confidence,
      policyVersion: changedBody.policyVersion,
      evidenceChecksum: changedBody.evidenceChecksum
    };
    const otherPersonSnapshot = await dailyRepository.createOrGet(otherPersonId, sameEvidence);
    expect(otherPersonSnapshot.snapshotId).not.toBe(changed.json().snapshotId);
    expect(otherPersonSnapshot.evidenceChecksum).toBe(changed.json().evidenceChecksum);
  });

  it("erases snapshots that retain evidence from an erased Recovery connection", async () => {
    const fastify = getFastifyInstance(app);
    const recovery = new RecoveryRepository(database);
    const model = await recovery.registerDeviceModel({
      providerKey: "daily-assessment-erasure",
      providerName: "Daily assessment erasure",
      modelKey: "daily-assessment-device",
      version: 1,
      name: "Daily assessment device",
      capabilities: ["metric"]
    });
    const connection = await recovery.createConnection(personId, {
      deviceModelVersionId: model.id,
      label: null,
      dedupeKey: "daily-assessment:erasure:connection"
    });
    const consent = await recovery.grantConsent(personId, connection.id, {
      purpose: "Daily assessment erasure verification",
      allowedKinds: ["metric"],
      retentionMode: "indefinite",
      retainUntil: null
    });
    const now = new Date();
    const observation = (await recovery.createObservation(personId, {
      kind: "metric",
      observedFrom: now.toISOString(),
      observedUntil: now.toISOString(),
      timezone: "Europe/Moscow",
      quality: "reliable",
      connectionId: connection.id,
      consentId: consent.id,
      dedupeKey: "daily-assessment:erasure:hrv",
      sourceReference: {
        channel: "device",
        externalSystem: "daily-assessment-test",
        externalRecordId: "daily-assessment-hrv-1",
        occurredAt: now.toISOString()
      },
      detail: { type: "metric", metric: "hrv_rmssd", value: 48, unit: "ms" }
    })).observation;

    const withRecovery = await fastify.inject({ method: "GET", url: "/v1/daily-assessment" });
    expect(withRecovery.statusCode, withRecovery.body).toBe(200);
    expect(withRecovery.json().usedFacts.recoveryObservationIds).toContain(observation.id);
    const retained = await database.pool.query(
      "select 1 from coaching_daily_assessment_recovery_evidence where recommendation_id = $1 and observation_id = $2",
      [withRecovery.json().snapshotId, observation.id]
    );
    expect(retained.rowCount).toBe(1);

    const request = await recovery.requestErasure(
      personId,
      connection.id,
      "daily-assessment:erasure:request",
      "retention_expired",
      null
    );
    const pendingClient = await database.pool.connect();
    try {
      const pendingEvidence = await loadRetrospectiveEvidence(
        pendingClient,
        personId,
        withRecovery.json().localDate,
        withRecovery.json().localDate
      );
      expect(pendingEvidence.find(
        (day) => day.localDate === withRecovery.json().localDate
      )?.v1Status).toBeUndefined();
    } finally {
      pendingClient.release();
    }
    await database.pool.query(
      "update recovery_erasure_requests set journal_accepted_at = now() where id = $1",
      [request.id]
    );
    const job = await recovery.claimErasure("daily-assessment-worker", 30_000);
    await recovery.completeErasure(job!);

    const erasedSnapshot = await database.pool.query(
      "select 1 from coaching_recommendations where id = $1",
      [withRecovery.json().snapshotId]
    );
    expect(erasedSnapshot.rowCount).toBe(0);
    const afterErasure = await fastify.inject({ method: "GET", url: "/v1/daily-assessment" });
    expect(afterErasure.statusCode, afterErasure.body).toBe(200);
    expect(afterErasure.json().snapshotId).not.toBe(withRecovery.json().snapshotId);
    expect(afterErasure.json().usedFacts.recoveryObservationIds).not.toContain(observation.id);
  });

  it("versions current evidence after a Recovery correction and withdrawal", async () => {
    const fastify = getFastifyInstance(app);
    const recovery = new RecoveryRepository(database);
    const now = new Date();
    const base = {
      kind: "metric" as const,
      observedFrom: now.toISOString(),
      observedUntil: now.toISOString(),
      timezone: "Europe/Moscow",
      quality: "reliable" as const,
      connectionId: null,
      consentId: null,
      sourceReference: {
        channel: "manual" as const,
        externalSystem: null,
        externalRecordId: null,
        occurredAt: now.toISOString()
      }
    };
    const original = (await recovery.createObservation(personId, {
      ...base,
      dedupeKey: "daily-assessment:correction:hrv:a",
      detail: { type: "metric", metric: "hrv_rmssd", value: 48, unit: "ms" }
    })).observation;
    const versionA = await fastify.inject({ method: "GET", url: "/v1/daily-assessment" });
    const ownerClient = await database.pool.connect();
    try {
      expect(await readRecoveryBaselineDays(
        ownerClient, personId, original.localDate, original.localDate
      )).toEqual([expect.objectContaining({ hrvRmssd: 48 })]);
      expect(await readRecoveryBaselineDays(
        ownerClient, otherPersonId, original.localDate, original.localDate
      )).toEqual([]);
    } finally {
      ownerClient.release();
    }

    const corrected = (await recovery.correctObservation(personId, original.id, {
      ...base,
      dedupeKey: "daily-assessment:correction:hrv:b",
      detail: { type: "metric", metric: "hrv_rmssd", value: 52, unit: "ms" },
      reason: "Corrected wearable reading"
    })).observation;
    const versionB = await fastify.inject({ method: "GET", url: "/v1/daily-assessment" });
    expect(versionB.json().snapshotId).not.toBe(versionA.json().snapshotId);
    expect(versionB.json().usedFacts.recoveryObservationIds).toContain(corrected.id);
    expect(versionB.json().usedFacts.recoveryObservationIds).not.toContain(original.id);
    const correctedClient = await database.pool.connect();
    try {
      expect(await readRecoveryBaselineDays(
        correctedClient, personId, corrected.localDate, corrected.localDate
      )).toEqual([expect.objectContaining({ hrvRmssd: 52 })]);
    } finally {
      correctedClient.release();
    }

    await recovery.withdrawObservation(
      personId,
      corrected.id,
      "daily-assessment:correction:hrv:withdrawn",
      "Provider removed the field"
    );
    const withdrawn = await fastify.inject({ method: "GET", url: "/v1/daily-assessment" });
    expect(withdrawn.json().snapshotId).not.toBe(versionB.json().snapshotId);
    expect(withdrawn.json().usedFacts.recoveryObservationIds).not.toContain(corrected.id);
    const withdrawnClient = await database.pool.connect();
    try {
      expect(await readRecoveryBaselineDays(
        withdrawnClient, personId, corrected.localDate, corrected.localDate
      )).toEqual([]);
    } finally {
      withdrawnClient.release();
    }
  });
});
