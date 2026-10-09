import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import Fastify, { type FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "@shape-of-you/config";
import { buildApp } from "../src/app.js";
import { RequestPersonContext } from "../src/application/person-context.js";
import { BodyMeasurementSessionService } from "../src/body-measurement-sessions/body-measurement-session.service.js";
import { CurrentRecoveryContextService } from "../src/coaching/current-recovery-context.service.js";
import { DailyAssessmentService } from "../src/coaching/daily-assessment.service.js";
import { DailyDecisionContextService } from "../src/coaching/daily-decision-context.service.js";
import { DailyContextNoteService } from "../src/daily-context-notes/daily-context-note.service.js";
import { DailyProjectionService } from "../src/daily-projections/daily-projection.service.js";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { MCP_READ_SCOPE } from "../src/mcp/oauth.js";
import { registerMcpRoutes } from "../src/mcp/server.js";
import { NutritionService } from "../src/nutrition/nutrition.service.js";
import { RecoveryService } from "../src/recovery/recovery.service.js";
import { TrainingService } from "../src/training/training.service.js";
import { WeightMeasurementService } from "../src/weight-measurements/weight-measurement.service.js";

const personId = "00000000-0000-4000-8000-000000000169";
const token = "synthetic-private-contention-token";
const logs: string[] = [];
const authorize = vi.fn(async () => ({ personId, roles: ["owner"] as const }));
let container: StartedPostgreSqlContainer;
let database: DatabaseContext;
let app: NestFastifyApplication;
let server: FastifyInstance;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = personId;
  await runMigrations(container.getConnectionUri());
  const config: AppConfig = {
    NODE_ENV: "test", HOST: "127.0.0.1", PORT: 3000, DATABASE_URL: container.getConnectionUri(),
    LOG_LEVEL: "silent", PERSON_CONTEXT_MODE: "synthetic", SYNTHETIC_PERSON_ID: personId,
    SHUTDOWN_TIMEOUT_MS: 1000
  };
  // Exercise deployed pool capacity while disabling background workers in the test app.
  database = createDatabase({ ...config, NODE_ENV: "production" });
  await database.pool.query("insert into persons (id, kind, status) values ($1, 'real', 'active')", [personId]);
  const personContext = new RequestPersonContext(personId);
  app = await buildApp({ config, database, personContext });
  await app.get(DailyAssessmentService).updatePreferences({ timezone: "Europe/Belgrade" });
  server = Fastify({ logger: { level: "error", stream: { write: (line: string) => logs.push(line) } } });
  registerMcpRoutes({ fastify: server, issuer: "https://identity.example.test",
    resource: "https://api.example.test/mcp", authorizer: { authorize }, personContext,
    services: {
      weights: app.get(WeightMeasurementService), bodyMeasurements: app.get(BodyMeasurementSessionService),
      nutrition: app.get(NutritionService), training: app.get(TrainingService), recovery: app.get(RecoveryService),
      dailyContextNotes: app.get(DailyContextNoteService), dailyProjection: app.get(DailyProjectionService),
      currentRecoveryContext: app.get(CurrentRecoveryContextService), dailyDecisionContext: app.get(DailyDecisionContextService)
    }
  });
  await server.ready();
});

afterAll(async () => {
  await server?.close();
  await app?.close();
  await database?.pool.end();
  await container?.stop();
});

async function call() {
  const response = await server.inject({ method: "POST", url: "/mcp",
    headers: { accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_daily_decision_context", arguments: {} } }
  });
  expect(response.statusCode).toBe(200);
  return response.json().result;
}

async function occupyPool(): Promise<PoolClient[]> {
  expect(database.pool.options.max).toBe(10);
  const clients: PoolClient[] = [];
  try {
    for (let index = 0; index < 10; index += 1) clients.push(await database.pool.connect());
    return clients;
  } catch (error) {
    for (const client of clients) client.release();
    throw error;
  }
}

async function waitForQueue(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (database.pool.waitingCount > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("MCP did not reach the database pool queue");
}

describe("Daily MCP reads with the deployed database pool capacity", () => {
  it("waits beyond the old one-second budget and reads real owner facts after release", async () => {
    const clients = await occupyPool();
    const logCount = logs.length;
    let settled = false;
    const pending = call().finally(() => { settled = true; });
    try {
      await waitForQueue();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(settled).toBe(false);
      for (const client of clients.splice(0)) client.release();
      const result = await pending;
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ state: "available", timezone: "Europe/Belgrade" });
      expect(logs).toHaveLength(logCount);
      expect(authorize).toHaveBeenCalledWith(`Bearer ${token}`, MCP_READ_SCOPE, false);
    } finally {
      for (const client of clients) client.release();
      await pending;
    }
  });

  it("bounds sustained exhaustion, correlates a private reason and recovers after release", async () => {
    const clients = await occupyPool();
    const logCount = logs.length;
    const started = performance.now();
    try {
      const failed = await call();
      expect(performance.now() - started).toBeGreaterThanOrEqual(4500);
      expect(performance.now() - started).toBeLessThan(10000);
      expect(failed).toMatchObject({ isError: true, structuredContent: {
        outcome: "unknown", reason: "read_failed", diagnosticId: expect.any(String)
      } });
      expect(logs).toHaveLength(logCount + 1);
      const log = JSON.parse(logs.at(-1)!);
      expect(log).toMatchObject({ event: "mcp_context_read_failed", tool: "get_daily_decision_context",
        failureStage: "execute", failureReason: "pool_acquisition_timeout", diagnosticId: failed.structuredContent.diagnosticId });
      expect(log).not.toHaveProperty("databaseCode");
      expect(Object.keys(failed.structuredContent).sort()).toEqual(["diagnosticId", "outcome", "reason"]);
      const output = JSON.stringify(failed) + logs.slice(logCount).join("");
      for (const privateValue of [token, personId, container.getConnectionUri(), "timeout exceeded when trying to connect"])
        expect(output).not.toContain(privateValue);
    } finally { for (const client of clients) client.release(); }
    expect((await call()).structuredContent.state).toBe("available");
    expect(logs).toHaveLength(logCount + 1);
  });
});
