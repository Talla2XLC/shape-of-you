import { TrainingRepository } from "../src/storage/training-repository.js";
import { TrainingService } from "../src/training/training.service.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@shape-of-you/config";
import type { GarminPersonalConnection } from "@shape-of-you/contracts";
import { buildApp, getFastifyInstance } from "../src/app.js";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { ConnectedProviderRepository } from "../src/storage/connected-provider-repository.js";
import { IntegrationRepository } from "../src/storage/integration-repository.js";
import { ConnectionCredentialCipher } from "../src/integrations/credential-cipher.js";

let db: DatabaseContext;
let container: StartedPostgreSqlContainer | undefined;
let url: string;
beforeAll(async () => {
  url = process.env.TASK0182_TEST_DATABASE_URL ?? "";
  if (url) {
    const parsed = new URL(url);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55485" || !parsed.pathname.startsWith("/soy_task0182_")) throw Error("Only isolated TASK0182 PostgreSQL is allowed");
  } else { container = await new PostgreSqlContainer("postgres:17-alpine").start(); url = container.getConnectionUri(); }
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = randomUUID();
  await runMigrations(url);
  db = createDatabase(loadConfig({ NODE_ENV: "test", PERSON_CONTEXT_MODE: "synthetic", SYNTHETIC_PERSON_ID: randomUUID(), DATABASE_URL: url }));
});
afterAll(async () => { await db?.pool.end(); await container?.stop(); });

describe("connected provider public reads", () => {
  it("delivers nonempty typed facts through HTTP and daily consumers without summing imported intake or leaking another Person", async () => {
    const personId = randomUUID(), other = randomUUID(), id = randomUUID(), consentId = randomUUID();
    await db.pool.query("insert into persons(id,kind,timezone) values($1,'synthetic','Europe/Belgrade'),($2,'synthetic','Europe/Belgrade')", [personId, other]);
    const key = randomBytes(32);
    const cipher = new ConnectionCredentialCipher("synthetic", new Map([["synthetic", key]]));
    await new IntegrationRepository<GarminPersonalConnection>(db, "garmin_personal").activate({ id, personId, consentId, recoveryConnectionId: randomUUID(), externalUserId: "synthetic", credential: cipher.encrypt("synthetic", `garmin_personal:${personId}:${id}`), authorizationStartedAt: new Date() });
    const connection = { id, personId, consentId, providerKey: "garmin_personal" };
    const repo = new ConnectedProviderRepository(db);
    const localDate = "2026-11-21";
    const day = { identity: localDate, localDate, timezone: "Europe/Belgrade", fitness: { energyMovement: { restingExpenditureKcal: 1600, activeExpenditureKcal: 400, totalExpenditureKcal: 2000, movementDistanceMeters: 3000, floorsUp: 1, floorsDown: 1, moderateMinutes: 15, vigorousMinutes: 0 } }, nutrition: { intake: { consumedCaloriesKcal: 700, proteinGrams: 40, fatGrams: 30, carbohydrateGrams: 65 } } };
    await new TrainingRepository(db).importExternalActivity({ connectionId: id, personId, consentId, providerIdentity: "synthetic-activity", normalizedChecksum: "a".repeat(64), occurredAt: "2026-11-21T09:00:00Z", localDate, timezone: "Europe/Belgrade", name: "Synthetic run", durationSeconds: 1200, distanceMeters: 3000, trainingLoad: null, trainingLoadBasis: null, trainingLoadBasisVersion: null, averageHeartRate: 125, maximumHeartRate: 150, deviceName: null, sourceProvider: "garmin_personal", garminAttributed: true, providerExerciseLoad: 37, providerExerciseLoadBasis: "garmin_activity_training_load_v1", trainingStressScore: 24, caloriesKcal: 200, aerobicTrainingEffect: 2.5, anaerobicTrainingEffect: 0.4, averagePowerWatts: 180, normalizedPowerWatts: 190, maximumPowerWatts: 250, intensityFactor: 0.8, bodyBatteryDelta: -5 });
    await repo.importFitnessDay(connection, day);
    await repo.importNutritionDay(connection, day);
    await repo.importBodyMeasurement(connection, { identity: "body", localDate, timezone: "Europe/Belgrade", measuredAt: null, weightKg: null, composition: { bodyFatPercent: 18, bodyWaterPercent: null, muscleMassKg: null, boneMassKg: null, bmi: 23 } });
    for (const owner of [personId, other]) {
      const app = await buildApp({ config: loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", PERSON_CONTEXT_MODE: "synthetic", SYNTHETIC_PERSON_ID: owner, DATABASE_URL: url }), database: db, recoveryErasureWorkerEnabled: false });
      try {
        const http = getFastifyInstance(app);
        const fitness = await http.inject({ method: "GET", url: `/v1/connected-data/fitness?fromDate=${localDate}&toDate=${localDate}` });
        expect(fitness.statusCode, fitness.body).toBe(200);
        expect(fitness.headers["cache-control"]).toBe("no-store");
        const nutrition = await http.inject({ method: "GET", url: `/v1/connected-data/nutrition?localDate=${localDate}` });
        expect(nutrition.statusCode, nutrition.body).toBe(200);
        const body = await http.inject({ method: "GET", url: `/v1/connected-data/body-composition?fromDate=${localDate}` });
        expect(body.statusCode, body.body).toBe(200);
        if (owner === other) {
          expect(fitness.json()).toEqual({ items: [] });
          expect(nutrition.json()).toEqual({ item: null });
          expect(body.json()).toEqual({ items: [] });
        } else {
          const context = await app.get(TrainingService).getTrainingContext({ localDate, historyLimit: 20 });
          expect(context.connectedDailyFitness).toHaveLength(1);
          expect(context.recentExternalActivities[0]).toMatchObject({ trainingLoad: null, providerExerciseLoad: 37, providerExerciseLoadBasis: "garmin_activity_training_load_v1", trainingStressScore: 24, caloriesKcal: 200, intensityFactor: 0.8 });
          expect(fitness.json().items[0]).toMatchObject({ values: { totalExpenditureKcal: 2000 } });
          expect(nutrition.json().item).toMatchObject({ values: { consumedCaloriesKcal: 700 } });
          expect(body.json().items[0]).toMatchObject({ measuredAt: null, values: { bodyFatPercent: 18 } });
          const projection = await http.inject({ method: "GET", url: `/v1/day-projections?localDate=${localDate}&timezone=Europe%2FBelgrade` });
          expect(projection.statusCode, projection.body).toBe(200);
          expect(projection.json().snapshot.nutrition).toMatchObject({ totals: { mealCount: 0, caloriesKcal: 0 }, connectedDay: { values: { consumedCaloriesKcal: 700 } } });
          expect(projection.json().snapshot.training.connectedDailyFitness).toHaveLength(1);
          expect(projection.json().snapshot.physical.bodyCompositionObservations).toHaveLength(1);
        }
        const spec = (await http.inject({ method: "GET", url: "/openapi.json" })).json();
        expect(spec.paths).toHaveProperty("/v1/connected-data/fitness");
        expect(spec.paths).toHaveProperty("/v1/connected-data/nutrition");
        expect(spec.paths).toHaveProperty("/v1/connected-data/body-composition");
        expect((await http.inject({ method: "GET", url: `/v1/connected-data/fitness?personId=${personId}` })).statusCode).toBe(400);
      } finally { await app.close(); }
    }
  });
});
