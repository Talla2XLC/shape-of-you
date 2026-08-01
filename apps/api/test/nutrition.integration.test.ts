import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer
} from "@testcontainers/postgresql";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "@shape-of-you/config";

import { buildApp, getFastifyInstance } from "../src/app.js";
import {
  createDatabase,
  type DatabaseContext
} from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { NutritionRepository } from "../src/storage/nutrition-repository.js";

let container: StartedPostgreSqlContainer;
let database: DatabaseContext;
let app: NestFastifyApplication;
const personA = "00000000-0000-4000-8000-000000000001";
const personB = "00000000-0000-4000-8000-000000000002";

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_nutrition_test")
    .withUsername("shape_of_you")
    .withPassword("shape_of_you")
    .start();
  const databaseUrl = container.getConnectionUri();
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = personA;
  await runMigrations(databaseUrl);
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
  database = createDatabase(config);
  await database.pool.query(
    `insert into persons (id, kind, status)
     values ($1, 'real', 'active')`,
    [personB]
  );
  app = await buildApp({ config, database });
});

afterAll(async () => {
  await app?.close();
  await database?.pool.end();
  await container?.stop();
});

describe("Nutrition PostgreSQL vertical", () => {
  it("applies the catalog and Meal migration to a clean database", async () => {
    const result = await database.pool.query<{ name: string | null }>(
      `select to_regclass('public.nutrition_foods')::text as name
       union all
       select to_regclass('public.meals')::text`
    );

    expect(result.rows.map((row) => row.name)).toEqual([
      "nutrition_foods",
      "meals"
    ]);
  });

  it("reuses shared definitions and isolates private definitions", async () => {
    const fastify = getFastifyInstance(app);
    const sharedResponse = await fastify.inject({
      method: "POST",
      url: "/v1/nutrition/catalog/ingredients",
      payload: {
        visibility: "shared",
        name: "Овсяные хлопья",
        category: "grain",
        referenceQuantity: 100,
        referenceUnit: "g",
        nutrients: {
          caloriesKcal: 370,
          proteinG: 13,
          fatG: 7,
          carbsG: 62
        }
      }
    });
    const privateResponse = await fastify.inject({
      method: "POST",
      url: "/v1/nutrition/catalog/ingredients",
      payload: {
        visibility: "private",
        name: "Домашняя смесь",
        category: null,
        referenceQuantity: 100,
        referenceUnit: "g",
        nutrients: {
          caloriesKcal: 250,
          proteinG: 10,
          fatG: 8,
          carbsG: 35
        }
      }
    });
    const repository = new NutritionRepository(database);

    expect(sharedResponse.statusCode, sharedResponse.body).toBe(201);
    expect(privateResponse.statusCode, privateResponse.body).toBe(201);
    expect(
      await repository.findIngredient(personB, sharedResponse.json().id)
    ).toMatchObject({
      id: sharedResponse.json().id,
      visibility: "shared",
      ownerPersonId: null
    });
    expect(
      await repository.findIngredient(personB, privateResponse.json().id)
    ).toBeNull();
    const invalidSharedFood = await fastify.inject({
      method: "POST",
      url: "/v1/nutrition/catalog/foods",
      payload: {
        visibility: "shared",
        name: "Недопустимая общая ссылка",
        referenceQuantity: 100,
        referenceUnit: "g",
        nutrients: {
          caloriesKcal: 250,
          proteinG: 10,
          fatG: 8,
          carbsG: 35
        },
        composition: [
          {
            ingredientVersionId:
              privateResponse.json().currentVersion.id,
            quantity: 100,
            unit: "g",
            required: true
          }
        ]
      }
    });
    expect(invalidSharedFood.statusCode, invalidSharedFood.body).toBe(404);
    const sharedCount = await database.pool.query<{ count: string }>(
      `select count(*)::text as count
         from nutrition_ingredients
        where id = $1`,
      [sharedResponse.json().id]
    );
    expect(sharedCount.rows[0]?.count).toBe("1");
  });

  it("keeps Meal snapshots stable across Food versions and corrections", async () => {
    const fastify = getFastifyInstance(app);
    const ingredient = await fastify.inject({
      method: "POST",
      url: "/v1/nutrition/catalog/ingredients",
      payload: {
        visibility: "shared",
        name: "Творог",
        category: "dairy",
        referenceQuantity: 100,
        referenceUnit: "g",
        nutrients: {
          caloriesKcal: 120,
          proteinG: 18,
          fatG: 5,
          carbsG: 3
        }
      }
    });
    const ingredientVersionId =
      ingredient.json().currentVersion.id as string;
    const food = await fastify.inject({
      method: "POST",
      url: "/v1/nutrition/catalog/foods",
      payload: {
        visibility: "shared",
        name: "Творог 5%",
        type: "product",
        category: "dairy",
        referenceQuantity: 100,
        referenceUnit: "g",
        nutrients: {
          caloriesKcal: 120,
          proteinG: 18,
          fatG: 5,
          carbsG: 3
        },
        brandVersionId: null,
        composition: [
          {
            ingredientVersionId,
            quantity: 100,
            unit: "g",
            preparation: null,
            required: true,
            note: null,
            confidence: 1
          }
        ]
      }
    });
    expect(food.statusCode, food.body).toBe(201);
    const foodId = food.json().id as string;
    const originalFoodVersionId =
      food.json().currentVersion.id as string;
    const mealPayload = {
      occurredAt: "2026-07-31T06:00:00.000Z",
      timezone: "Europe/Moscow",
      kind: "breakfast",
      description: "Завтрак",
      note: null,
      photoMediaId: null,
      items: [
        {
          foodVersionId: originalFoodVersionId,
          label: "Творог 5%",
          quantity: 200,
          unit: "g",
          nutrients: {
            caloriesKcal: 240,
            proteinG: 36,
            fatG: 10,
            carbsG: 6
          }
        }
      ],
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: "2026-07-31T06:00:00.000Z"
      },
      dedupeKey: "nutrition:meal:breakfast",
      confidence: 1
    } as const;
    const meal = await fastify.inject({
      method: "POST",
      url: "/v1/nutrition/meals",
      payload: mealPayload
    });
    const duplicate = await fastify.inject({
      method: "POST",
      url: "/v1/nutrition/meals",
      payload: mealPayload
    });
    expect(meal.statusCode, meal.body).toBe(201);
    expect(duplicate.statusCode, duplicate.body).toBe(200);
    expect(duplicate.json().id).toBe(meal.json().id);

    const newFoodVersion = await fastify.inject({
      method: "POST",
      url: `/v1/nutrition/catalog/foods/${foodId}/versions`,
      payload: {
        expectedLockVersion: 1,
        name: "Творог 5%, уточнённый",
        type: "product",
        category: "dairy",
        referenceQuantity: 100,
        referenceUnit: "g",
        nutrients: {
          caloriesKcal: 125,
          proteinG: 18,
          fatG: 5,
          carbsG: 4
        },
        brandVersionId: null,
        composition: [
          {
            ingredientVersionId,
            quantity: 100,
            unit: "g",
            preparation: null,
            required: true,
            note: null,
            confidence: 1
          }
        ]
      }
    });
    const staleUpdate = await fastify.inject({
      method: "POST",
      url: `/v1/nutrition/catalog/foods/${foodId}/versions`,
      payload: {
        expectedLockVersion: 1,
        name: "Конфликт",
        referenceQuantity: 100,
        referenceUnit: "g",
        nutrients: {
          caloriesKcal: 1,
          proteinG: 1,
          fatG: 1,
          carbsG: 1
        },
        composition: []
      }
    });
    expect(newFoodVersion.statusCode, newFoodVersion.body).toBe(201);
    expect(staleUpdate.statusCode, staleUpdate.body).toBe(409);

    const originalMeal = await fastify.inject({
      method: "GET",
      url: `/v1/nutrition/meals/${meal.json().id as string}`
    });
    expect(originalMeal.json().items[0]).toMatchObject({
      foodVersionId: originalFoodVersionId,
      nutrients: {
        caloriesKcal: 240,
        proteinG: 36,
        fatG: 10,
        carbsG: 6
      }
    });

    const correction = await fastify.inject({
      method: "POST",
      url: `/v1/nutrition/meals/${meal.json().id as string}/corrections`,
      payload: {
        ...mealPayload,
        items: [
          {
            ...mealPayload.items[0],
            quantity: 150,
            nutrients: {
              caloriesKcal: 180,
              proteinG: 27,
              fatG: 7.5,
              carbsG: 4.5
            }
          }
        ],
        dedupeKey: "nutrition:meal:breakfast:correction:1",
        reason: "Уточнена порция"
      }
    });
    expect(correction.statusCode, correction.body).toBe(201);
    expect(correction.json().supersedesId).toBe(meal.json().id);

    const history = await fastify.inject({
      method: "GET",
      url: `/v1/nutrition/meals/${meal.json().id as string}/history`
    });
    const totals = await fastify.inject({
      method: "GET",
      url: "/v1/nutrition/daily-totals?localDate=2026-07-31"
    });
    const list = await fastify.inject({
      method: "GET",
      url: "/v1/nutrition/meals?localDate=2026-07-31"
    });

    expect(history.statusCode, history.body).toBe(200);
    expect(history.json().items).toHaveLength(2);
    expect(totals.statusCode, totals.body).toBe(200);
    expect(totals.json()).toMatchObject({
      mealCount: 1,
      totals: {
        caloriesKcal: 180,
        proteinG: 27,
        fatG: 7.5,
        carbsG: 4.5
      }
    });
    expect(list.json().items.map((item: { id: string }) => item.id)).toEqual([
      correction.json().id
    ]);
  });

  it("stages external records idempotently without name-based merging", async () => {
    const firstSource = await database.pool.query<{ id: string }>(
      `insert into nutrition_catalog_sources (key, name)
       values ('provider-a', 'Provider A') returning id`
    );
    const secondSource = await database.pool.query<{ id: string }>(
      `insert into nutrition_catalog_sources (key, name)
       values ('provider-b', 'Provider B') returning id`
    );
    const insertRecord = async (
      sourceId: string,
      externalRecordId: string,
      rawName: string
    ) =>
      database.pool.query(
        `insert into nutrition_catalog_source_records (
           source_id, external_record_id, fetched_at, checksum,
           parser_version, raw_snapshot
         ) values ($1, $2, now(), $3, 'fixture-v1', $4::jsonb)`,
        [
          sourceId,
          externalRecordId,
          `${sourceId}:${externalRecordId}`,
          JSON.stringify({ name: rawName })
        ]
      );

    await insertRecord(firstSource.rows[0]!.id, "same-id", "Кефир");
    await expect(
      insertRecord(firstSource.rows[0]!.id, "same-id", "Кефир")
    ).rejects.toMatchObject({ code: "23505" });
    await insertRecord(secondSource.rows[0]!.id, "same-id", "Кефир");

    const state = await database.pool.query<{
      records: string;
      foods: string;
    }>(
      `select
         (select count(*)::text
            from nutrition_catalog_source_records
           where external_record_id = 'same-id') as records,
         (select count(*)::text
            from nutrition_food_versions
           where name = 'Кефир') as foods`
    );
    expect(state.rows[0]).toEqual({ records: "2", foods: "0" });
  });
});
