import { randomUUID } from "node:crypto";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SyntheticPersonContext } from "../src/application/person-context.js";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { NutritionService } from "../src/nutrition/nutrition.service.js";
import { NutritionRepository } from "../src/storage/nutrition-repository.js";
import { decimalMenuMeal, mcpMealServer } from "./fixtures/mcp-meal-server.js";

let container: StartedPostgreSqlContainer;
let database: DatabaseContext;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = randomUUID();
  const databaseUrl = container.getConnectionUri();
  await runMigrations(databaseUrl);
  database = createDatabase({ NODE_ENV: "test", HOST: "127.0.0.1", PORT: 3000, DATABASE_URL: databaseUrl,
    LOG_LEVEL: "silent", PERSON_CONTEXT_MODE: "synthetic", SYNTHETIC_PERSON_ID: process.env.SYNTHETIC_PERSON_ID,
    SHUTDOWN_TIMEOUT_MS: 1000 });
});
afterAll(async () => { await database?.pool.end(); await container?.stop(); });
async function fixture() {
  const personId = randomUUID();
  await database.pool.query("insert into persons (id,kind,status,timezone) values ($1,'real','active','Europe/Belgrade')", [personId]);
  const nutrition = new NutritionService(new NutritionRepository(database), new SyntheticPersonContext(personId));
  return { ...mcpMealServer(nutrition, personId), personId };
}

describe("Decimal Meal capture across client schema, MCP and PostgreSQL", () => {
  it("persists fractional evidence unchanged and replays the same command without a duplicate", async () => {
    const { server, call, list, personId } = await fixture();
    try {
      const { tools } = await list();
      const ajv = new Ajv({ strict: false });
      (addFormats as unknown as (instance: Ajv) => Ajv)(ajv);
      const validate = ajv.compile(tools.find((tool: { name: string }) => tool.name === "record_meal").inputSchema);
      const input = decimalMenuMeal("synthetic-decimal-meal");
      expect(validate(input), JSON.stringify(validate.errors)).toBe(true);
      const first = await call("record_meal", input);
      expect(first.isError).not.toBe(true);
      expect(first.structuredContent.items[0]).toMatchObject({ amountConfidence: 0.7, nutrients: { proteinG: 5.1 } });
      const second = await call("record_meal", input);
      expect(second.structuredContent.id).toBe(first.structuredContent.id);
      const read = await call("list_meals", { localDate: "2026-10-07" });
      expect(read.structuredContent.items).toHaveLength(1);
      expect(read.structuredContent.items[0].totals.proteinG).toBe(5.1);
      const rows = await database.pool.query("select count(*)::int as count from meals where person_id=$1", [personId]);
      expect(rows.rows[0].count).toBe(1);
    } finally { await server.close(); }
  });

  it("accepts a supplied menu snapshot without requiring a photo estimate", async () => {
    const { server, call } = await fixture();
    try {
      const result = await call("record_meal", { ...decimalMenuMeal("synthetic-menu"), items: [{
        label: "Synthetic restaurant menu", quantity: 1, unit: "serving",
        nutrients: { caloriesKcal: 635, proteinG: 65, fatG: 11, carbsG: 69 }
      }] });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent.items[0]).toMatchObject({ amountKind: "quantified", estimateMethod: null, amountConfidence: null });
      expect(result.structuredContent.totals).toEqual({ caloriesKcal: 635, proteinG: 65, fatG: 11, carbsG: 69 });
    } finally { await server.close(); }
  });

  it("rejects excess precision inside the API even when client schema accepts it", async () => {
    const { server, call, list, personId } = await fixture();
    try {
      const { tools } = await list();
      const ajv = new Ajv({ strict: false });
      (addFormats as unknown as (instance: Ajv) => Ajv)(ajv);
      const validate = ajv.compile(tools.find((tool: { name: string }) => tool.name === "record_meal").inputSchema);
      const input = decimalMenuMeal("synthetic-invalid-precision");
      input.items[0]!.nutrients.proteinG = 5.1001;
      expect(validate(input)).toBe(true);
      expect((await call("record_meal", input)).isError).toBe(true);
      const rows = await database.pool.query("select count(*)::int as count from meals where person_id=$1", [personId]);
      expect(rows.rows[0].count).toBe(0);
    } finally { await server.close(); }
  });
});
