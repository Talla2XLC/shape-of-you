import { randomBytes, randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@shape-of-you/config";
import { buildApp, getFastifyInstance } from "../src/app.js";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { IntegrationRepository } from "../src/storage/integration-repository.js";
import { IntegrationCutoverRepository } from "../src/storage/integration-cutover-repository.js";
import { ConnectionCredentialCipher } from "../src/integrations/credential-cipher.js";
import { GarminPersonalProvider } from "../src/integrations/garmin-personal/provider.js";

let database: DatabaseContext;
let databaseUrl: string;
let container: StartedPostgreSqlContainer | undefined;
const key = "synthetic-http-cutover-key";
const encryptionKey = randomBytes(32);
const cipher = new ConnectionCredentialCipher("test", new Map([["test", encryptionKey]]));
const root = "/v1/integrations/garmin-personal/cutover";

beforeAll(async () => {
  const native = process.env.TASK0181_TEST_DATABASE_URL;
  if (native) {
    const parsed = new URL(native);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55481" || !parsed.pathname.startsWith("/soy_task0181_")) {
      throw new Error("Only isolated TASK-0181 PostgreSQL is allowed");
    }
    databaseUrl = native;
  } else {
    container = await new PostgreSqlContainer("postgres:17-alpine").withDatabase("soy_task0181_http").start();
    databaseUrl = container.getConnectionUri();
  }
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = randomUUID();
  await runMigrations(databaseUrl);
  await runMigrations(databaseUrl);
  database = createDatabase(loadConfig({ NODE_ENV: "test", PERSON_CONTEXT_MODE: "synthetic",
    SYNTHETIC_PERSON_ID: process.env.SYNTHETIC_PERSON_ID, DATABASE_URL: databaseUrl }));
});
afterAll(async () => { await database?.pool.end(); await container?.stop(); });

async function fixture() {
  const personId = randomUUID(), sourceId = randomUUID();
  await database.pool.query("insert into persons(id,kind,timezone) values($1,'synthetic','Europe/Moscow')", [personId]);
  await new IntegrationRepository(database).activate({ id: sourceId, personId,
    recoveryConnectionId: randomUUID(), consentId: randomUUID(), externalUserId: "synthetic-athlete",
    credential: cipher.encrypt("synthetic-source-token", `intervals_icu:${personId}:${sourceId}`), authorizationStartedAt: new Date() });
  const provider = new GarminPersonalProvider();
  const inspect = vi.spyOn(provider, "inspectCutoverCandidate").mockResolvedValue({ externalUserId: null, activityPresent: false, originalFit: null });
  vi.spyOn(provider, "verifyKey").mockResolvedValue(undefined);
  const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", PERSON_CONTEXT_MODE: "synthetic",
    SYNTHETIC_PERSON_ID: personId, DATABASE_URL: databaseUrl, INTEGRATION_ENCRYPTION_ACTIVE_KEY_ID: "test",
    INTEGRATION_ENCRYPTION_KEY_RING: `test:${encryptionKey.toString("base64")}` });
  const app = await buildApp({ config, database, garminPersonalProvider: provider, recoveryErasureWorkerEnabled: false });
  const http = getFastifyInstance(app);
  const previewResponse = await http.inject({ method: "POST", url: `${root}/preview`, payload: {} });
  expect(previewResponse.statusCode).toBe(200);
  const preview = previewResponse.json();
  const input = { startsOn: preview.startsOn, expectedRevision: preview.expectedRevision, apiKey: key, consent: true,
    acceptedCoverageGaps: preview.gaps.map((gap: { capability: string }) => gap.capability), dedupeKey: randomUUID() };
  return { app, http, personId, sourceId, inspect, input, preview, store: new IntegrationCutoverRepository(database) };
}

describe("Garmin cutover HTTP boundary", () => {
  it("schedules one encrypted pending key, replays intent and cancels with version fencing", async () => {
    const f = await fixture();
    try {
      const response = await f.http.inject({ method: "POST", url: `${root}/schedule`, payload: f.input });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).not.toContain(key);
      expect(response.body).not.toContain("synthetic-athlete");
      const scheduled = response.json().cutover;
      expect(scheduled).toMatchObject({ state: "scheduled", timezone: "Europe/Moscow" });
      const pending = (await f.store.pendingTarget(f.personId))!;
      expect(cipher.decrypt(pending.credential, `garmin_personal:${f.personId}:${pending.id}`)).toBe(key);
      expect((await f.http.inject({ method: "GET", url: "/v1/integrations/garmin-personal" })).json().lifecycle).toBe("connecting");
      expect((await f.http.inject({ method: "POST", url: `${root}/schedule`, payload: f.input })).json()).toEqual(response.json());
      expect(f.inspect).toHaveBeenCalledTimes(1);
      const cancel = { reason: "Synthetic cancellation", expectedVersion: scheduled.version };
      expect((await f.http.inject({ method: "POST", url: `${root}/cancel`, payload: { ...cancel, expectedVersion: 99 } })).statusCode).toBe(409);
      const cancelled = await f.http.inject({ method: "POST", url: `${root}/cancel`, payload: cancel });
      expect(cancelled.statusCode).toBe(200);
      expect(cancelled.json().cutover.state).toBe("cancelled");
      expect(await f.store.pendingTarget(f.personId)).toBeNull();
    } finally { await f.app.close(); }
  });

  it("returns a safe refreshed preview and rejects caller-selected Person IDs", async () => {
    const f = await fixture();
    try {
      const changed = await f.http.inject({ method: "POST", url: `${root}/schedule`, payload: { ...f.input, expectedRevision: "stale" } });
      expect(changed.statusCode).toBe(409);
      expect(changed.json()).toMatchObject({ error: "coverage_changed", details: { preview: { startsOn: f.preview.startsOn } } });
      expect(changed.body).not.toContain(key);
      expect(f.inspect).not.toHaveBeenCalled();
      const invalid = await f.http.inject({ method: "POST", url: `${root}/schedule`, payload: { ...f.input, personId: randomUUID() } });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.body).not.toContain(key);
      expect(await f.store.find(f.personId)).toBeNull();
    } finally { await f.app.close(); }
  });

  it("retries a failed transition without submitting the key again", async () => {
    const f = await fixture();
    try {
      const scheduled = (await f.http.inject({ method: "POST", url: `${root}/schedule`, payload: f.input })).json().cutover;
      const failed = await f.store.failBeforeActivation(scheduled.id, scheduled.version, "provider_timeout");
      const preview = (await f.http.inject({ method: "POST", url: `${root}/preview`, payload: {} })).json();
      const retryInput = { startsOn: f.input.startsOn, acceptedCoverageGaps: f.input.acceptedCoverageGaps };
      const response = await f.http.inject({ method: "POST", url: `${root}/retry`, payload: { ...retryInput,
        expectedRevision: preview.expectedRevision, expectedVersion: failed.version, dedupeKey: randomUUID() } });
      expect(response.statusCode).toBe(200);
      expect(response.json().cutover.state).toBe("scheduled");
      expect(f.inspect).toHaveBeenNthCalledWith(2, key);
      expect(response.body).not.toContain(key);
    } finally { await f.app.close(); }
  });
});
