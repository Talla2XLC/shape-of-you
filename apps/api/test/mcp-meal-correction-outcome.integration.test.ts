import { randomUUID } from "node:crypto";
import type { Meal } from "@shape-of-you/contracts";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { NutritionRepository } from "../src/storage/nutrition-repository.js";
import { NutritionService } from "../src/nutrition/nutrition.service.js";
import { WeightMeasurementRepository } from "../src/storage/weight-measurement-repository.js";
import { WeightMeasurementService } from "../src/weight-measurements/weight-measurement.service.js";
import { mcpMealServer, decimalMenuMeal } from "./fixtures/mcp-meal-server.js";

let container: StartedPostgreSqlContainer | undefined;
let database: DatabaseContext;
beforeAll(async () => {
  let url = process.env.SOY_MEAL_TEST_DATABASE_URL;
  if (url) {
    const parsed = new URL(url);
    if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/shape_of_you_task0177_test" || !parsed.port || parsed.port === "5432") {
      throw new Error("Expected dedicated isolated loopback test database");
    }
  } else {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    url = container.getConnectionUri();
  }
  vi.stubEnv("PERSON_CONTEXT_MODE", "synthetic");
  vi.stubEnv("SYNTHETIC_PERSON_ID", randomUUID());
  await runMigrations(url);
  database = createDatabase({ NODE_ENV: "test", HOST: "127.0.0.1", PORT: 3000,
    DATABASE_URL: url, LOG_LEVEL: "silent", PERSON_CONTEXT_MODE: "synthetic",
    SYNTHETIC_PERSON_ID: randomUUID(), SHUTDOWN_TIMEOUT_MS: 1000 });
});
afterAll(async () => { await database?.pool.end(); await container?.stop(); vi.unstubAllEnvs(); });

async function fixture() {
  const personId = randomUUID();
  await database.pool.query("insert into persons (id,kind,status,timezone) values ($1,'real','active','Europe/Belgrade')", [personId]);
  const repository = new NutritionRepository(database);
  const endpoint = mcpMealServer({
    listMeals: (query) => service.listMeals(query),
    createMeal: (input) => service.createMeal(input),
    correctMeal: (id, input) => service.correctMeal(id, input)
  }, personId, { weights: {
    list: (query) => weights.list(query), create: (input) => weights.create(input),
    correct: (id, input) => weights.correct(id, input)
  } });
  const service = new NutritionService(repository, endpoint.context);
  const weights = new WeightMeasurementService(new WeightMeasurementRepository(database), endpoint.context);
  const original = decimalMenuMeal(randomUUID());
  original.items.push({ ...original.items[0]!, label: "Unchanged synthetic side" });
  const meal = (await endpoint.call("record_meal", original)).structuredContent;
  const correction = { ...original, id: meal.id, dedupeKey: randomUUID(), reason: "Synthetic amount clarification",
    items: original.items.map((item, index) => index === 0 ? { ...item, quantity: 2,
      nutrients: { caloriesKcal: 1270, proteinG: 10.2, fatG: 22, carbsG: 138 } } : item) };
  const count = async () => (await database.pool.query("select count(*)::int as count from meals where person_id=$1", [personId])).rows[0].count;
  return { ...endpoint, service, weights, personId, meal, correction, count };
}

describe("Meal and Weight unknown outcomes through MCP and PostgreSQL", () => {
  it.each([false, true])("verifies Meal creation before exact retry; committed=%s", async (committed) => {
    const f = await fixture();
    try {
      const input = decimalMenuMeal(randomUUID());
      const real = f.service.createMeal.bind(f.service);
      vi.spyOn(f.service, "createMeal").mockImplementationOnce(async (command) => {
        if (committed) await real(command);
        throw new Error("Synthetic Meal acknowledgement failure");
      });
      const uncertain = await f.call("record_meal", input);
      expect(uncertain).toMatchObject({ isError: true, structuredContent: { state: "unknown" } });
      expect(uncertain.content[0].text).toContain("list_meals");
      const current = await f.call("list_meals", { localDate: "2026-10-07" });
      expect(JSON.parse(current.content[1].text)).toEqual(current.structuredContent);
      expect(current.structuredContent.items.filter((meal: Meal) => meal.dedupeKey === input.dedupeKey)).toHaveLength(committed ? 1 : 0);
      if (!committed) {
        const saved = await f.call("record_meal", input);
        expect(saved.isError).not.toBe(true);
        expect(JSON.parse(saved.content[1].text)).toEqual(saved.structuredContent);
      }
      expect(await f.count()).toBe(2);
      const replay = await f.call("record_meal", input);
      expect(replay.isError).not.toBe(true);
      expect(await f.count()).toBe(2);
    } finally { await f.server.close(); }
  });

  it.each([false, true])("verifies Weight creation before exact retry; committed=%s", async (committed) => {
    const f = await fixture();
    try {
      const input = { measuredAt: "2026-11-15T07:00:00.000Z", timezone: "Europe/Belgrade", weightKg: 76.4,
        sourceReference: { channel: "manual", externalSystem: null, externalRecordId: null, occurredAt: null }, dedupeKey: randomUUID() };
      const real = f.weights.create.bind(f.weights);
      vi.spyOn(f.weights, "create").mockImplementationOnce(async (command) => {
        if (committed) await real(command);
        throw new Error("Synthetic Weight acknowledgement failure");
      });
      expect(await f.call("record_weight_measurement", input)).toMatchObject({ isError: true, structuredContent: { state: "unknown" } });
      const current = await f.call("list_weight_measurements", {});
      expect(JSON.parse(current.content[1].text)).toEqual(current.structuredContent);
      expect(current.structuredContent.items).toHaveLength(committed ? 1 : 0);
      if (!committed) expect((await f.call("record_weight_measurement", input)).isError).not.toBe(true);
      const replay = await f.call("record_weight_measurement", input);
      expect(replay.isError).not.toBe(true);
      expect(JSON.parse(replay.content[1].text)).toEqual(replay.structuredContent);
      expect((await f.call("list_weight_measurements", {})).structuredContent.items).toHaveLength(1);
    } finally { await f.server.close(); }
  });

  it("verifies committed replacement after acknowledgement loss and keeps exact replay idempotent", async () => {
    const f = await fixture();
    try {
      const real = f.service.correctMeal.bind(f.service);
      vi.spyOn(f.service, "correctMeal").mockImplementationOnce(async (id, input) => {
        await real(id, input);
        throw new Error("Synthetic acknowledgement loss after commit");
      });
      const lost = await f.call("correct_meal", f.correction);
      expect(lost).toMatchObject({ isError: true, structuredContent: { state: "unknown", recovery: "read_current_meal_verify_before_retry" } });
      expect(lost.content[0].text).toContain("before retrying");
      const read = await f.call("list_meals", { localDate: "2026-10-07" });
      const current = read.structuredContent.items[0];
      expect(current.supersedesId).toBe(f.meal.id);
      expect(current.items[0].quantity).toBe(2);
      expect(current.items[1]).toEqual(f.meal.items[1]);
      expect(read.content[0].text).toContain("without another correction");
      expect(await f.count()).toBe(2);
      const replay = await f.call("correct_meal", f.correction);
      expect(replay.isError).not.toBe(true);
      expect(replay.structuredContent.id).toBe(current.id);
      expect(await f.count()).toBe(2);
      expect(replay.content[0].text).toContain("sufficient typed verification");
      const jsonOnly = JSON.parse(replay.content[1].text);
      expect(jsonOnly).toEqual(replay.structuredContent);
      expect(jsonOnly.id).toBe(current.id);
      expect(jsonOnly.items[1]).toEqual(f.meal.items[1]);
      const tools = await f.list();
      const schema = tools.tools.find((tool: { name: string }) => tool.name === "correct_meal").outputSchema;
      expect(schema.required).toEqual(expect.arrayContaining(["id", "items", "totals"]));
      expect(lost.content).toHaveLength(2);
      expect(JSON.parse(lost.content[1].text)).toEqual(lost.structuredContent);
      expect(lost.content[0].text).not.toContain('"supersedesId"');
    } finally { await f.server.close(); }
  });

  it("rejects an empty success payload instead of claiming that a correction was saved", async () => {
    const f = await fixture();
    try {
      vi.spyOn(f.service, "correctMeal").mockResolvedValueOnce({ created: true, meal: {} as Meal });
      const result = await f.call("correct_meal", f.correction);
      expect(result).toMatchObject({ isError: true, structuredContent: { state: "unknown" } });
      expect(result.content).toHaveLength(2);
      expect(JSON.parse(result.content[1].text)).toEqual(result.structuredContent);
      expect(result.content[0].text).not.toContain("The Meal correction has been committed");
      expect(await f.count()).toBe(1);
    } finally { await f.server.close(); }
  });

  it("keeps unknown when verification fails, retries unchanged target, and preserves concurrent changes", async () => {
    const f = await fixture();
    try {
      vi.spyOn(f.service, "correctMeal").mockRejectedValueOnce(new Error("Synthetic failure before commit"));
      expect((await f.call("correct_meal", f.correction)).structuredContent.state).toBe("unknown");
      vi.spyOn(f.service, "listMeals").mockRejectedValueOnce(new Error("Synthetic verification read failure"));
      expect((await f.call("list_meals", { localDate: "2026-10-07" })).isError).toBe(true);
      expect(await f.count()).toBe(1);
      expect((await f.call("list_meals", { localDate: "2026-10-07" })).structuredContent.items[0].id).toBe(f.meal.id);
      const saved = await f.call("correct_meal", f.correction);
      expect(saved.isError).not.toBe(true);
      expect(await f.count()).toBe(2);
      const concurrent = { ...f.correction, id: saved.structuredContent.id, dedupeKey: randomUUID(), description: "Concurrent description" };
      const newer = await f.call("correct_meal", concurrent);
      expect(newer.isError).not.toBe(true);
      const stale = await f.call("correct_meal", { ...f.correction, dedupeKey: randomUUID() });
      expect(stale).toMatchObject({ isError: true, structuredContent: { state: "not_saved", reason: "stale_or_missing_target" } });
      const read = await f.call("list_meals", { localDate: "2026-10-07" });
      expect(read.structuredContent.items[0].description).toBe("Concurrent description");
      expect(read.structuredContent.items[0].items[1]).toEqual(f.meal.items[1]);
      expect(await f.count()).toBe(3);
      const other = await fixture();
      try {
        expect((await other.call("correct_meal", { ...f.correction, id: newer.structuredContent.id, dedupeKey: randomUUID() })).isError).toBe(true);
        expect(await f.count()).toBe(3);
      } finally { await other.server.close(); }
    } finally { await f.server.close(); }
  });
});
