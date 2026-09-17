import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "@shape-of-you/config";

import { buildApp, getFastifyInstance } from "../src/app.js";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { evaluateDailyAssessment } from "../src/domain/daily-assessment.js";
import { DailyAssessmentEvidenceChangedError } from "../src/domain/errors.js";
import { derivePersonLocalDate } from "../src/coaching/daily-assessment.service.js";
import { DailyAssessmentRepository } from "../src/storage/daily-assessment-repository.js";
import { DailyContextNoteRepository } from "../src/storage/daily-context-note-repository.js";
import { RecoveryRepository } from "../src/storage/recovery-repository.js";
import { readRecoveryBaselineDays } from "../src/recovery/personal-baseline-history.js";
import { loadRetrospectiveEvidence } from "../src/commands/run-daily-assessment-retrospective.js";

const personId = "00000000-0000-4000-8000-000000000001";
const otherPersonId = "00000000-0000-4000-8000-000000000002";
let app: NestFastifyApplication;
let container: StartedPostgreSqlContainer;
let database: DatabaseContext;

async function waitForAdvisoryWaiters(minimum: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await database.pool.query<{ count: number }>(
      `select count(*)::int as count
         from pg_stat_activity
        where datname = current_database()
          and wait_event = 'advisory'`
    );
    if ((result.rows[0]?.count ?? 0) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected at least ${minimum} advisory-lock waiter(s)`);
}

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
    const currentNotes = await new DailyContextNoteRepository(database)
      .listForLocalDateRange(personId, "2026-09-01", "2026-09-02");
    expect(currentNotes.items).toHaveLength(1);
    expect(currentNotes.items[0]).toMatchObject({ text: "travel", localDate: "2026-09-02" });
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
      policyVersion: "daily-assessment-v2",
      personalBaseline: {
        policyKey: "balanced",
        policyVersion: "personal-baseline-v1",
        status: "unavailable"
      }
    });
    expect(first.json()).not.toHaveProperty("personalBaselineCalculation");

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

    const rows = await database.pool.query<{
      count: number;
      all_v2: boolean;
      all_reproducible: boolean;
    }>(
      `select count(*)::int as count,
              bool_and(policy_version = 'daily-assessment-v2') as all_v2,
              bool_and(personal_baseline is not null
                       and personal_baseline_calculation is not null) as all_reproducible
         from coaching_daily_assessment_details
        where person_id = $1`,
      [personId]
    );
    expect(rows.rows[0]).toEqual({ count: 2, all_v2: true, all_reproducible: true });

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
      policyVersion: "daily-assessment-v1" as const,
      evidenceChecksum: changedBody.evidenceChecksum
    };
    const otherPersonSnapshot = await dailyRepository.createOrGet(otherPersonId, sameEvidence);
    expect(otherPersonSnapshot.snapshotId).not.toBe(changed.json().snapshotId);
    expect(otherPersonSnapshot.evidenceChecksum).toBe(changed.json().evidenceChecksum);

    await database.pool.query(`
      create function test_hold_daily_snapshot() returns trigger language plpgsql as $$
      begin
        perform pg_advisory_xact_lock(hashtext('daily-assessment-final-fence-test'));
        return new;
      end
      $$
    `);
    await database.pool.query(`
      create trigger test_hold_daily_snapshot
      before insert on coaching_recommendations
      for each row execute function test_hold_daily_snapshot()
    `);
    const sentinel = await database.pool.connect();
    try {
      await sentinel.query("begin");
      await sentinel.query(
        "select pg_advisory_xact_lock(hashtext('daily-assessment-final-fence-test'))"
      );
      const concurrentPreferences = await dailyRepository.getPreferences(otherPersonId);
      const concurrentFrom = "2026-06-01";
      const concurrentTo = "2026-09-17";
      const concurrentRevision = await dailyRepository.getEvidenceRevision(
        otherPersonId,
        concurrentFrom,
        concurrentTo
      );
      const snapshotPromise = dailyRepository.createOrGet(otherPersonId, {
        ...sameEvidence,
        evidenceChecksum: "6".repeat(64)
      }, {
        expectedRevision: concurrentRevision,
        expectedTimezone: concurrentPreferences.timezone!,
        expectedPreferencesUpdatedAt: concurrentPreferences.updatedAt,
        from: concurrentFrom,
        to: concurrentTo
      });
      await waitForAdvisoryWaiters(1);
      const timezoneWrite = dailyRepository.setTimezone(otherPersonId, "UTC");
      await waitForAdvisoryWaiters(2);
      await sentinel.query("commit");
      const [concurrentSnapshot, changedPreferences] = await Promise.all([
        snapshotPromise,
        timezoneWrite
      ]);
      expect(concurrentSnapshot.timezone).toBe("Europe/Moscow");
      expect(changedPreferences.timezone).toBe("UTC");
    } finally {
      await sentinel.query("rollback").catch(() => undefined);
      sentinel.release();
      await database.pool.query(
        "drop trigger if exists test_hold_daily_snapshot on coaching_recommendations"
      );
      await database.pool.query("drop function if exists test_hold_daily_snapshot()")
    }

    await dailyRepository.setTimezone(otherPersonId, "Europe/Moscow");
    const guardedPreferences = await dailyRepository.getPreferences(otherPersonId);
    const guardFrom = "2026-06-01";
    const guardTo = "2026-09-17";
    const guardedRevision = await dailyRepository.getEvidenceRevision(
      otherPersonId,
      guardFrom,
      guardTo
    );
    await dailyRepository.setTimezone(otherPersonId, "UTC");
    await expect(dailyRepository.createOrGet(otherPersonId, {
      ...sameEvidence,
      evidenceChecksum: "7".repeat(64)
    }, {
      expectedRevision: guardedRevision,
      expectedTimezone: guardedPreferences.timezone!,
      expectedPreferencesUpdatedAt: guardedPreferences.updatedAt,
      from: guardFrom,
      to: guardTo
    })).rejects.toBeInstanceOf(DailyAssessmentEvidenceChangedError);
    const staleTimezoneSnapshot = await database.pool.query(
      "select 1 from coaching_recommendations where person_id = $1 and evidence_checksum = $2",
      [otherPersonId, "7".repeat(64)]
    );
    expect(staleTimezoneSnapshot.rowCount).toBe(0);
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
    const policyVersionId = await recovery.registerPolicyVersion({
      policyKey: "daily-assessment-erasure-policy",
      policyName: "Daily assessment erasure policy",
      version: 1,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveUntil: null,
      analysisWindowDays: 7,
      minimumObservations: 1,
      sufficientObservations: 1,
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
    const recoveryAssessment = (await recovery.createAssessment(personId, {
      policyVersionId,
      asOf: now.toISOString(),
      timezone: "Europe/Moscow",
      dedupeKey: "daily-assessment:erasure:assessment"
    })).assessment;

    const withRecovery = await fastify.inject({ method: "GET", url: "/v1/daily-assessment" });
    expect(withRecovery.statusCode, withRecovery.body).toBe(200);
    expect(withRecovery.json().usedFacts.recoveryObservationIds).toContain(observation.id);
    expect(withRecovery.json().usedFacts.recoveryAssessmentIds).toContain(recoveryAssessment.id);
    const retained = await database.pool.query(
      "select 1 from coaching_daily_assessment_recovery_evidence where recommendation_id = $1 and observation_id = $2",
      [withRecovery.json().snapshotId, observation.id]
    );
    expect(retained.rowCount).toBe(1);
    const retainedAssessment = await database.pool.query(
      "select 1 from coaching_daily_assessment_assessment_evidence where recommendation_id = $1 and assessment_id = $2",
      [withRecovery.json().snapshotId, recoveryAssessment.id]
    );
    expect(retainedAssessment.rowCount).toBe(1);

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

  it("activates the personal overlay after fourteen eligible live days", async () => {
    const fastify = getFastifyInstance(app);
    const targetLocalDate = derivePersonLocalDate("Europe/Moscow");
    const source = await database.pool.query<{ id: string }>(
      `insert into source_references
         (person_id, channel, evidence_purpose, contains_sensitive_data)
       values ($1, 'manual', 'person_context', false)
       returning id`,
      [personId]
    );
    await database.pool.query(
      `with days as (
         select day::date as local_date
           from generate_series($2::date - 14, $2::date, interval '1 day') day
       ), metric_rows as (
         select local_date, metric,
                case
                  when local_date = $2::date and metric = 'hrv_rmssd' then 35
                  when local_date = $2::date and metric = 'resting_heart_rate' then 65
                  when metric = 'hrv_rmssd' then 58 + (extract(day from local_date)::int % 3) * 2
                  else 48 + (extract(day from local_date)::int % 3) * 2
                end::numeric as value,
                case when metric = 'hrv_rmssd' then 'ms' else 'bpm' end as unit
           from days
           cross join (values ('hrv_rmssd'), ('resting_heart_rate')) metrics(metric)
       ), inserted as (
         insert into recovery_observations
           (person_id, kind, observed_from, observed_until, local_date, timezone,
            quality, source, source_reference_id, dedupe_key)
         select $1, 'metric', local_date::timestamp + interval '6 hours',
                local_date::timestamp + interval '6 hours', local_date,
                'Europe/Moscow', 'reliable', 'manual', $3,
                'daily-v2-live:' || local_date::text || ':' || metric
           from metric_rows
         returning id, local_date, dedupe_key
       )
       insert into recovery_metric_details (observation_id, metric, value, unit)
       select inserted.id,
              case when inserted.dedupe_key like '%:hrv_rmssd'
                   then 'hrv_rmssd'::recovery_metric
                   else 'resting_heart_rate'::recovery_metric end,
              metric_rows.value,
              metric_rows.unit::recovery_metric_unit
         from inserted
         join metric_rows
           on metric_rows.local_date = inserted.local_date
          and inserted.dedupe_key like '%:' || metric_rows.metric`,
      [personId, targetLocalDate, source.rows[0]!.id]
    );

    const response = await fastify.inject({ method: "GET", url: "/v1/daily-assessment" });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(evaluateDailyAssessment(body.usedFacts).status).toBe("caution");
    expect(body).toMatchObject({
      policyVersion: "daily-assessment-v2",
      status: "recovery_priority",
      personalBaseline: {
        policyKey: "balanced",
        policyVersion: "personal-baseline-v1",
        status: "partial"
      }
    });
    expect(body.personalBaseline.summary).toContain("HRV ниже твоего обычного уровня");
    expect(body.personalBaseline.summary).toContain("пульс покоя выше обычного");
    expect(body.usedFacts.dailyContextNoteIds).toEqual(expect.any(Array));
  });
});
