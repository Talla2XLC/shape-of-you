import { randomBytes, randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@shape-of-you/config";
import type { GarminPersonalConnection } from "@shape-of-you/contracts";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { SyntheticPersonContext } from "../src/application/person-context.js";
import { IntegrationRepository } from "../src/storage/integration-repository.js";
import { RecoveryRepository } from "../src/storage/recovery-repository.js";
import { ConnectedProviderRepository } from "../src/storage/connected-provider-repository.js";
import { TrainingRepository } from "../src/storage/training-repository.js";
import { ConnectionCredentialCipher } from "../src/integrations/credential-cipher.js";
import { GarminPersonalProvider } from "../src/integrations/garmin-personal/provider.js";
import { GarminPersonalService } from "../src/integrations/garmin-personal.service.js";
import { buildApp, getFastifyInstance } from "../src/app.js";
import { CurrentRecoveryContextService } from "../src/coaching/current-recovery-context.service.js";
import { readRecoveryBaselineDays } from "../src/recovery/personal-baseline-history.js";
import { DailyAssessmentService } from "../src/coaching/daily-assessment.service.js";

import { trackPoolShutdown } from "./support/pool-shutdown.js";

let closePool: (() => Promise<void>) | undefined;
let database: DatabaseContext;
let container: StartedPostgreSqlContainer | undefined;
let databaseUrl: string;
const key = "synthetic-garmin-personal-key";
const cipher = new ConnectionCredentialCipher("test", new Map([["test", randomBytes(32)]]));
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = randomUUID();
  const native = process.env.TASK0179_TEST_DATABASE_URL;
  if (native) {
    const parsed = new URL(native);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55479" || !parsed.pathname.startsWith("/soy_task0179_")) {
      throw new Error("Only the isolated TASK-0179 test database may be used");
    }
    databaseUrl = native;
  } else {
    container = await new PostgreSqlContainer("postgres:17-alpine").withDatabase("soy_task0179_test").start();
    databaseUrl = container.getConnectionUri();
  }
  await runMigrations(databaseUrl);
  await runMigrations(databaseUrl);
  database = createDatabase(loadConfig({ NODE_ENV: "test", PERSON_CONTEXT_MODE: "synthetic",
    SYNTHETIC_PERSON_ID: process.env.SYNTHETIC_PERSON_ID, DATABASE_URL: databaseUrl }));
  closePool = trackPoolShutdown(database.pool);
});

beforeEach(async () => { await database.pool.query("update integration_connections set next_attempt_at=now()+interval '1 day'"); });

afterAll(async () => { await closePool?.(); await container?.stop(); });

async function person(): Promise<string> {
  const id = randomUUID();
  await database.pool.query("insert into persons (id, kind, timezone) values ($1, 'synthetic', 'UTC')", [id]);
  return id;
}

function transport(account: number | null = null, invalid = false, latest?: () => number | null): GarminPersonalProvider {
  const token = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
  return new GarminPersonalProvider({ fetch: vi.fn(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/token")) return new Response(invalid ? "not-accepted" : token, { status: invalid ? 401 : 200 });
    if (url.pathname.endsWith("/settings")) return Response.json({ timeZone: "UTC" });
    if (url.pathname.endsWith("/dailysummaries")) return Response.json({ data: account === null ? [] : [{
      calendarDate: today, userProfilePk: account, bodyBattery: { minValue: 20, maxValue: 85, ...(latest ? { latestValue: latest() } : {}) },
      movement: { steps: { value: 1234 } }, wellnessChronology: { endTimestampGmt: `${today}T12:00:00` }
    }].filter((row) => row.calendarDate >= url.searchParams.get("startDate")! && row.calendarDate <= url.searchParams.get("endDate")!) });
    if (url.pathname.endsWith("/dailyHeartRate") && account !== null && url.searchParams.get("date") === today) {
      return Response.json({ userProfilePK: account, calendarDate: today, restingHeartRate: 51 });
    }
    if (url.pathname.endsWith("/dailySleep") && latest && account !== null && url.searchParams.get("date") === today) {
      return Response.json({ userProfilePK: account, calendarDate: today, sleepTimeSeconds: 28_800,
        avgHeartRate: 54.5, averageSpO2Value: 97.2, averageRespirationValue: 14.3 });
    }
    if (url.pathname.endsWith("/activities")) return Response.json([]);
    return new Response(null, { status: 204 });
  }) as typeof fetch });
}

function setup(personId: string, provider = transport()) {
  const store = new IntegrationRepository<GarminPersonalConnection>(database, "garmin_personal");
  const recovery = new RecoveryRepository(database);
  const training = new TrainingRepository(database);
  const context = new SyntheticPersonContext(personId);
  const service = new GarminPersonalService(context, recovery, training, { store, provider, cipher }, null, new ConnectedProviderRepository(database));
  return { store, recovery, training, service, context, provider };
}

async function activateIntervals(personId: string) {
  const store = new IntegrationRepository(database);
  const id = randomUUID();
  await store.activate({ id, recoveryConnectionId: randomUUID(), personId, consentId: randomUUID(),
    externalUserId: "synthetic-athlete", credential: cipher.encrypt("synthetic-intervals-token", `intervals_icu:${personId}:${id}`),
    authorizationStartedAt: new Date() });
  return store;
}

describe("direct Garmin linking and typed import", () => {
  it("coalesces manual syncs, preserves history and leases, and reports actual worker state", async () => {
    const id = await person();
    const current = setup(id);
    await current.service.connect({ apiKey: key, consent: true });
    await database.pool.query(`update integration_connections set next_attempt_at=now()+interval '5 minutes',
      historical_import_status='completed', historical_cursor_before=historical_scope_from_date,
      historical_requested_at=now(), historical_completed_at=now() where person_id=$1`, [id]);
    const reconcile = vi.spyOn(current.provider, "reconcile");
    const results = await Promise.all(Array.from({ length: 5 }, () => current.service.requestSync()));
    expect(results.every(result => result.sync.state === "queued")).toBe(true);
    expect(reconcile).not.toHaveBeenCalled();
    const claims = await Promise.all([current.store.claimDue("one", 60_000), current.store.claimDue("two", 60_000)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claim = claims.find(Boolean)!;
    expect((await current.service.status()).sync.state).toBe("running");
    const before = (await database.pool.query("select lease_owner,lease_until,historical_import_status,historical_cursor_before from integration_connections where person_id=$1", [id])).rows[0];
    expect((await current.service.requestSync()).sync.state).toBe("running");
    expect((await database.pool.query("select lease_owner,lease_until,historical_import_status,historical_cursor_before from integration_connections where person_id=$1", [id])).rows[0]).toEqual(before);
    await current.store.markSyncSucceeded(claim.id, claim.consentId, false);
    await current.store.releaseClaim(claim.id, claim.consentId);
    const scheduled = await current.service.requestSync();
    expect(scheduled.sync.state).toBe("scheduled");
    expect(Date.parse(scheduled.sync.nextAttemptAt!) - Date.parse(scheduled.lastAttemptAt!)).toBe(60_000);
    const repeated = await current.service.requestSync();
    expect(repeated.sync.nextAttemptAt).toBe(scheduled.sync.nextAttemptAt);
    await database.pool.query("update integration_connections set last_attempt_at=now()-interval '2 minutes' where person_id=$1", [id]);
    expect((await current.service.requestSync()).sync.state).toBe("queued");
    expect(await current.service.processNext("manual-worker", 60_000)).toBe(true);
    expect(reconcile).toHaveBeenCalled();
    expect((await current.service.status()).sync.state).toBe("scheduled");
  });

  it("preserves provider backoff and rejects disconnected, revoked and erasing syncs", async () => {
    const id = await person();
    const { service, store } = setup(id);
    await service.connect({ apiKey: key, consent: true });
    const active = (await store.findActive(id))!;
    await store.markSyncFailed(active.id, active.consentId, "provider_rate_limited");
    const before = await service.status();
    expect((await service.requestSync()).sync).toEqual(before.sync);
    await database.pool.query("update recovery_connections set status='disconnected', disconnected_at=now(), erasure_requested_at=now() where id=$1", [active.recoveryConnectionId]);
    expect((await service.status()).sync.state).toBe("blocked");
    await expect(service.requestSync()).rejects.toThrow("not available");
    await database.pool.query("update recovery_connections set status='active', disconnected_at=null, erasure_requested_at=null where id=$1", [active.recoveryConnectionId]);
    await database.pool.query("update recovery_consents set status='revoked', revoked_at=now(), revocation_reason='synthetic revoked consent' where id=$1", [active.consentId]);
    await expect(service.requestSync()).rejects.toThrow("not available");
    await service.disconnect("test disconnect");
    expect((await service.status()).sync).toEqual({ state: "blocked", nextAttemptAt: null });
    await expect(service.requestSync()).rejects.toThrow("not available");
    expect((await setup(await person()).service.status()).sync.state).toBe("blocked");
  });

  it("isolates manual scheduling by Person and preserves authorization backoff", async () => {
    const first = await person(), second = await person();
    const one = setup(first), two = setup(second);
    await one.service.connect({ apiKey: key, consent: true });
    await two.service.connect({ apiKey: key, consent: true });
    await database.pool.query("update integration_connections set next_attempt_at=now()+interval '5 minutes' where person_id=any($1)", [[first, second]]);
    const otherBefore = (await two.service.status()).sync;
    await one.service.requestSync();
    expect((await two.service.status()).sync).toEqual(otherBefore);
    const active = (await one.store.findActive(first))!;
    await one.store.markSyncFailed(active.id, active.consentId, "authorization_required");
    expect((await one.service.status()).sync.state).toBe("blocked");
    await expect(one.service.requestSync()).rejects.toThrow("not available");
    await one.service.connect({ apiKey: "rotated-synthetic-key", consent: true });
    expect((await one.service.requestSync()).sync.state).toBe("queued");
    expect(await one.store.assertReadAllowed(active.id, active.consentId)).toBe(false);
  });

  it("connects an empty account without external identity and keeps the key encrypted", async () => {
    const id = await person();
    const { service, store } = setup(id);
    await expect(service.check(key)).resolves.toEqual({ verified: true });
    expect(await store.status(id)).toBeNull();
    const result = await service.connect({ apiKey: key, consent: true });
    expect(result).toMatchObject({ provider: "garmin_personal", lifecycle: "active", lastDataAt: null });
    const row = (await database.pool.query("select * from integration_connections where person_id=$1", [id])).rows[0];
    expect(row.external_user_id).toBeNull();
    expect(row.credential_ciphertext).not.toContain(key);
    expect(JSON.stringify(result)).not.toContain(key);
    expect(await service.processNext("empty-account-check", 60_000)).toBe(true);
    expect((await service.status()).lastSuccessfulSyncAt).not.toBeNull();
    expect((await database.pool.query("select count(*) from recovery_observations where person_id=$1", [id])).rows[0].count).toBe("0");
  });

  it("starts historical import only on request and advances a bounded empty window", async () => {
    const id = await person();
    const current = setup(id);
    const linked = await current.service.connect({ apiKey: key, consent: true });
    expect(linked.historicalImport.status).toBe("not_requested");
    expect((await current.service.startHistoricalImport()).historicalImport.status).toBe("running");
    await current.service.processNext("history-check", 60_000);
    const state = await current.service.status();
    expect(state.historicalImport.status).toBe("running");
    expect(state.historicalImport.processedThroughDate).not.toBeNull();
    expect(state.historicalImport.processedThroughDate! < today).toBe(true);
    expect(state.historicalImport.completedAt).toBeNull();
  });

  it("bounds key checking attempts without activating imports", async () => {
    const id = await person();
    const current = setup(id);
    for (let count = 0; count < 5; count++) await current.service.check(key);
    await expect(current.service.check(key)).rejects.toMatchObject({ status: 429 });
    expect(await current.store.status(id)).toBeNull();
  });

  it("binds a data account once, confirms typed delivery and replays without duplicate observations", async () => {
    const id = await person();
    const { service, store } = setup(id, transport(123));
    await service.connect({ apiKey: key, consent: true });
    await service.processNext("typed-check", 60_000);
    const first = await database.pool.query("select count(*) from recovery_observations where person_id=$1", [id]);
    expect(first.rows[0].count).toBe("4");
    expect((await database.pool.query("select external_user_id from integration_connections where person_id=$1", [id])).rows[0].external_user_id).toBe("123");
    const delivery = await store.connectedRecoveryDelivery(id, today);
    expect(delivery?.metricDelivery.find((item) => item.metric === "resting_heart_rate")?.state).toBe("confirmed_present");
    expect(delivery?.metricDelivery.find((item) => item.metric === "hrv_rmssd")?.state).toBe("confirmed_absent");
    await database.pool.query("update integration_connections set next_attempt_at=now() where person_id=$1", [id]);
    await service.processNext("typed-repeat", 60_000);
    expect((await database.pool.query("select count(*) from recovery_observations where person_id=$1", [id])).rows[0].count).toBe("4");
    const row = await store.findActive(id);
    await expect(store.bindExternalIdentity(row!.id, row!.consentId, "456")).rejects.toThrow("cannot be merged");
  });

  it("keeps latest daily battery separate, confirms delivery, corrects and withdraws it without duplicates", async () => {
    const id = await person();
    let latest: number | null = 60;
    const { service, store, recovery } = setup(id, transport(123, false, () => latest));
    await service.connect({ apiKey: key, consent: true });
    const sync = async () => {
      await database.pool.query("update integration_connections set next_attempt_at=now()-interval '1 second', lease_until=null where person_id=$1", [id]);
      expect(await service.processNext("latest-battery", 60_000)).toBe(true);
      expect((await service.status()).failureCode).toBeNull();
    };
    await sync();
    const first = await recovery.listObservationsForLocalDate(id, today);
    expect(first).toHaveLength(9);
    const direct = first.find((item) => item.detail.type === "metric" && item.detail.metric === "body_battery")!;
    expect(direct).toMatchObject({ temporalPrecision: "local_date", localDate: today, observedFrom: null, observedUntil: null,
      detail: { metric: "body_battery", value: 60, unit: "score" },
      sourceReference: { externalSystem: "garmin_personal_wellness", occurredAt: null } });
    const delivery = await store.connectedRecoveryDelivery(id, today);
    for (const metric of ["body_battery", "night_heart_rate", "oxygen_saturation", "respiration_rate"]) {
      expect(delivery?.metricDelivery.find((item) => item.metric === metric)).toMatchObject({ state: "confirmed_present" });
    }
    await sync();
    expect(await recovery.listObservationsForLocalDate(id, today)).toHaveLength(9);
    latest = 20;
    await sync();
    const corrected = await recovery.listObservationsForLocalDate(id, today);
    expect(corrected).toHaveLength(9);
    expect(corrected.find((item) => item.detail.type === "metric" && item.detail.metric === "body_battery"))
      .toMatchObject({ supersedesId: direct.id, detail: { value: 20 } });
    expect(corrected.find((item) => item.detail.type === "metric" && item.detail.metric === "body_battery_max"))
      .toMatchObject({ detail: { value: 85 } });
    const baseline = await readRecoveryBaselineDays(database.pool, id, today, today);
    expect(baseline[0]).toMatchObject({ bodyBattery: null, bodyBatteryMin: 20, bodyBatteryMax: 85 });
    const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", PERSON_CONTEXT_MODE: "synthetic",
      SYNTHETIC_PERSON_ID: id, DATABASE_URL: databaseUrl });
    const app = await buildApp({ config, database, recoveryErasureWorkerEnabled: false });
    try {
      const focused = new CurrentRecoveryContextService(new SyntheticPersonContext(id),
        { getPreferences: async () => ({ timezone: "UTC" }) } as never, null,
        { listObservations: async () => ({ items: await recovery.listObservationsForLocalDate(id, today) }) } as never, store);
      const context = await focused.read();
      expect(context).toMatchObject({ state: "available", metricDelivery: expect.arrayContaining([
        { metric: "body_battery", state: "confirmed_present", periodState: null, asOf: null }
      ]), observations: { items: expect.arrayContaining([
        expect.objectContaining({ temporalPrecision: "local_date", localDate: today, observedFrom: null, observedUntil: null,
          detail: { type: "metric", metric: "body_battery", value: 20, unit: "score" } })
      ]) } });
      const legacy = await app.get(DailyAssessmentService).read();
      expect(legacy).toMatchObject({ state: "available", usedFacts: { summary: { bodyBattery: null, bodyBatteryMax: 85 } } });
      if (legacy.state === "available") expect(legacy.limitations).toContain("body_battery_daily_range_not_current");
    } finally { await app.close(); }
    await service.connect({ apiKey: "synthetic-renewal", consent: true });
    expect((await store.connectedRecoveryDelivery(id, today))?.metricDelivery.find((item) => item.metric === "body_battery")?.state)
      .toBe("retained_unconfirmed");
    await sync();
    expect((await store.connectedRecoveryDelivery(id, today))?.metricDelivery.find((item) => item.metric === "body_battery")?.state)
      .toBe("confirmed_present");
    latest = null;
    await sync();
    expect(await recovery.listObservationsForLocalDate(id, today)).toHaveLength(8);
    expect((await store.connectedRecoveryDelivery(id, today))?.metricDelivery.find((item) => item.metric === "body_battery")?.state)
      .toBe("confirmed_absent");
    await sync();
    expect(await recovery.listObservationsForLocalDate(id, today)).toHaveLength(8);
  });

  it("rejects account changes on rotation without importing or deleting retained facts", async () => {
    const id = await person();
    const first = setup(id, transport(123));
    await first.service.connect({ apiKey: key, consent: true });
    await first.service.processNext("account-one", 60_000);
    const second = setup(id, transport(456));
    await second.service.connect({ apiKey: "replacement-synthetic-key", consent: true });
    await second.service.processNext("account-two", 60_000);
    expect((await second.service.status()).failureCode).toBe("authorization_required");
    expect((await database.pool.query("select count(*) from recovery_observations where person_id=$1", [id])).rows[0].count).toBe("4");
    expect((await database.pool.query("select external_user_id from integration_connections where person_id=$1", [id])).rows[0].external_user_id).toBe("123");
  });

  it("clears direct credentials atomically, fences old claims and permits erasure without a key", async () => {
    const id = await person();
    const { service, store } = setup(id);
    await service.connect({ apiKey: key, consent: true });
    const old = (await store.findActive(id))!;
    await service.disconnect("test disconnect");
    const row = (await database.pool.query("select * from integration_connections where person_id=$1", [id])).rows[0];
    expect(row).toMatchObject({ import_enabled: false, credential_ciphertext: null, remote_disconnect_pending: false });
    expect(await store.bindExternalIdentity(old.id, old.consentId, "123")).toBe(false);
    await expect(service.prepareErasure(id, old.recoveryConnectionId)).resolves.toBeUndefined();
    expect(await store.findActive(id)).toBeNull();
  });

  it("fences account binding and metadata from the previous key generation", async () => {
    const id = await person();
    const current = setup(id);
    await current.service.connect({ apiKey: key, consent: true });
    const old = (await current.store.findActive(id))!;
    const invalidate = vi.spyOn(current.provider, "invalidateScope");
    await current.service.connect({ apiKey: "new-synthetic-key", consent: true });
    const fresh = (await current.store.findActive(id))!;
    expect(fresh.consentId).not.toBe(old.consentId);
    expect(invalidate).toHaveBeenCalledWith(`${old.id}:${old.consentId}`);
    expect(await current.store.bindExternalIdentity(old.id, old.consentId, "123")).toBe(false);
    await current.store.markSyncFailed(old.id, old.consentId, "provider_unavailable");
    expect((await current.service.status()).failureCode).toBeNull();
    expect(await current.store.bindExternalIdentity(fresh.id, fresh.consentId, "456")).toBe(true);
  });

  it("allows only one concurrent provider and rejects both directions with retained data", async () => {
    const id = await person();
    const direct = setup(id, transport(123));
    const results = await Promise.allSettled([direct.service.connect({ apiKey: key, consent: true }), activateIntervals(id)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const id2 = await person();
    const retained = setup(id2, transport(123));
    await retained.service.connect({ apiKey: key, consent: true });
    await retained.service.processNext("retained", 60_000);
    await retained.service.disconnect("stop but retain");
    await expect(activateIntervals(id2)).rejects.toThrow("retained imported data");
    const id3 = await person();
    const legacy = await activateIntervals(id3);
    await expect(setup(id3).service.connect({ apiKey: key, consent: true })).rejects.toThrow("retained imported data");
    expect((await legacy.status(id3))?.lifecycle).toBe("active");
    const legacyConnection = (await legacy.findActive(id3))!;
    await new RecoveryRepository(database).createObservation(id3, {
      kind: "metric", observedFrom: null, observedUntil: null, temporalPrecision: "local_date",
      localDate: today, timezone: "UTC", quality: "reliable", connectionId: legacyConnection.recoveryConnectionId,
      consentId: legacyConnection.consentId, dedupeKey: "synthetic-legacy-retained",
      sourceReference: { channel: "account", externalSystem: "intervals_icu_wellness", externalRecordId: "retained", occurredAt: null },
      detail: { type: "metric", metric: "resting_heart_rate", value: 55, unit: "bpm" }
    });
    await legacy.beginDisconnect(id3, "retained Intervals history");
    await expect(setup(id3).service.connect({ apiKey: key, consent: true })).rejects.toThrow("retained imported data");
  });

  it("never claims another provider and fences delayed disconnect completion after renewal", async () => {
    const id = await person();
    const intervals = await activateIntervals(id);
    const old = (await intervals.findActive(id))!;
    await intervals.beginDisconnect(id, "disconnect old consent");
    const freshConsent = randomUUID();
    await intervals.activate({ id: old.id, recoveryConnectionId: old.recoveryConnectionId, consentId: freshConsent,
      personId: id, externalUserId: "synthetic-athlete", credential: old.credential, authorizationStartedAt: new Date(Date.now() + 1) });
    await intervals.completeRemoteDisconnect(old.id, old.consentId);
    expect((await intervals.findActive(id))?.consentId).toBe(freshConsent);
    const directStore = setup(id).store;
    const claimed = await directStore.claimDue("scoped-claim", 60_000);
    if (claimed) {
      const row = (await database.pool.query("select provider_key from integration_connections where id=$1", [claimed.id])).rows[0];
      expect(row.provider_key).toBe("garmin_personal");
      await directStore.releaseClaim(claimed.id, claimed.consentId);
    }
    expect(await directStore.findForErasure(id, old.recoveryConnectionId)).toBeNull();
  });

  it("serves real HTTP key checks and empty linking with Garmin-only configuration", async () => {
    const id = await person();
    const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", PERSON_CONTEXT_MODE: "synthetic",
      SYNTHETIC_PERSON_ID: id, DATABASE_URL: databaseUrl,
      INTEGRATION_ENCRYPTION_ACTIVE_KEY_ID: "test", INTEGRATION_ENCRYPTION_KEY_RING: `test:${randomBytes(32).toString("base64")}` });
    const app = await buildApp({ config, database, garminPersonalProvider: transport(), recoveryErasureWorkerEnabled: false });
    try {
      const http = getFastifyInstance(app);
      const checked = await http.inject({ method: "POST", url: "/v1/integrations/garmin-personal/check", payload: { apiKey: key } });
      expect(checked.statusCode).toBe(200);
      expect(checked.json()).toEqual({ verified: true });
      expect((await http.inject({ method: "GET", url: "/v1/integrations/garmin-personal" })).json().lifecycle).toBe("disconnected");
      const connected = await http.inject({ method: "POST", url: "/v1/integrations/garmin-personal/connect", payload: { apiKey: key, consent: true } });
      expect(connected.statusCode).toBe(200);
      expect(connected.json()).toMatchObject({ provider: "garmin_personal", lifecycle: "active", lastDataAt: null });
      expect(connected.headers["cache-control"]).toBe("no-store");
      expect(connected.body).not.toContain(key);
      const sync = await http.inject({ method: "POST", url: "/v1/integrations/garmin-personal/sync" });
      expect(sync.statusCode).toBe(202);
      expect(sync.json().sync.state).toBe("queued");
      expect(sync.headers["cache-control"]).toBe("no-store");
      expect(sync.body).not.toContain(key);
      expect((await http.inject({ method: "POST", url: "/v1/integrations/garmin-personal/sync", payload: { personId: randomUUID(), apiKey: key } })).statusCode).toBe(400);
      const unknown = await http.inject({ method: "POST", url: "/v1/integrations/garmin-personal/connect", payload: { apiKey: key, consent: true, personId: randomUUID() } });
      expect(unknown.statusCode).toBe(400);
      expect(unknown.body).not.toContain(key);
    } finally { await app.close(); }
  });

  it("returns safe key rejection over real HTTP without creating a connection", async () => {
    const id = await person();
    const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", PERSON_CONTEXT_MODE: "synthetic",
      SYNTHETIC_PERSON_ID: id, DATABASE_URL: databaseUrl,
      INTEGRATION_ENCRYPTION_ACTIVE_KEY_ID: "test", INTEGRATION_ENCRYPTION_KEY_RING: `test:${randomBytes(32).toString("base64")}` });
    const app = await buildApp({ config, database, garminPersonalProvider: transport(null, true), recoveryErasureWorkerEnabled: false });
    try {
      const rejected = await getFastifyInstance(app).inject({ method: "POST", url: "/v1/integrations/garmin-personal/connect", payload: { apiKey: key, consent: true } });
      expect(rejected.statusCode).toBe(422);
      expect(rejected.body).not.toContain(key);
      expect(await setup(id).store.status(id)).toBeNull();
    } finally { await app.close(); }
  });

  it("enforces Person isolation and the Intervals required-identity constraint", async () => {
    const id = await person();
    await setup(id).service.connect({ apiKey: key, consent: true });
    const other = await person();
    expect((await setup(other).service.status()).lifecycle).toBe("disconnected");
    await setup(other).service.disconnect("cannot affect another Person");
    expect((await setup(id).service.status()).lifecycle).toBe("active");
    const connection = randomUUID();
    await expect(new IntegrationRepository(database).activate({ id: connection, recoveryConnectionId: randomUUID(),
      personId: other, consentId: randomUUID(), externalUserId: null, credential: cipher.encrypt(key, "test"), authorizationStartedAt: new Date() })).rejects.toThrow("identity is required");
  });

  it("chooses active Intervals delivery after an empty direct connection was disconnected", async () => {
    const id = await person();
    const direct = setup(id);
    await direct.service.connect({ apiKey: key, consent: true });
    await direct.service.disconnect("switch empty connection");
    const intervals = await activateIntervals(id);
    const read = vi.spyOn(intervals, "connectedRecoveryDelivery");
    const context = new CurrentRecoveryContextService(new SyntheticPersonContext(id), {
      getPreferences: async () => ({ timezone: "UTC" })
    } as never, intervals, { listObservations: async () => ({ items: [] }) } as never, direct.store);
    const result = await context.read();
    expect(read).toHaveBeenCalled();
    expect(result).toMatchObject({ state: "available", syncState: "never_checked" });
    expect((await intervals.connectedRecoveryDelivery(id, today))?.importEnabled).toBe(true);
  });
});
