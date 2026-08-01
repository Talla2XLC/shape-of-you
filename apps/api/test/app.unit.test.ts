import { describe, expect, it } from "vitest";

import type { AppConfig } from "@shape-of-you/config";
import {
  type CorrectWeightMeasurement,
  CreateWeightMeasurementSchema,
  type CreateWeightMeasurement,
  type WeightMeasurement,
  type WeightMeasurementHistory,
  type WeightMeasurementList
} from "@shape-of-you/contracts";

import { buildApp, getFastifyInstance } from "../src/app.js";
import {
  toNewWeightMeasurement
} from "../src/domain/weight-measurement.js";
import type {
  BodyMeasurementSessionStore
} from "../src/storage/body-measurement-session-repository.js";
import type {
  PhysicalGoalStore
} from "../src/storage/physical-goal-repository.js";
import type {
  NutritionStore
} from "../src/storage/nutrition-repository.js";
import type { TrainingStore } from "../src/storage/training-repository.js";
import type { RecoveryStore } from "../src/storage/recovery-repository.js";
import type { CoachingStore } from "../src/storage/coaching-repository.js";
import type {
  CreateWeightMeasurementResult,
  WeightMeasurementStore
} from "../src/storage/weight-measurement-repository.js";

const config: AppConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 3_000,
  DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
  LOG_LEVEL: "silent",
  PERSON_CONTEXT_MODE: "synthetic",
  SYNTHETIC_PERSON_ID: "00000000-0000-4000-8000-000000000001",
  SHUTDOWN_TIMEOUT_MS: 1_000
};

const personId = "00000000-0000-4000-8000-000000000001";
const sourceReferenceId = "01983f6c-e470-7000-8000-000000000002";

const baselineInput: CreateWeightMeasurement = {
  measuredAt: "2026-07-28T05:30:00.000Z",
  timezone: "Europe/Moscow",
  weightKg: 82.125,
  dedupeKey: "manual:2026-07-28T05:30:00Z",
  sourceReference: {
    channel: "manual",
    externalSystem: null,
    externalRecordId: null,
    occurredAt: "2026-07-28T05:30:00.000Z"
  }
};

const baselineMeasurement: WeightMeasurement = {
  id: "01983f6c-e470-7000-8000-000000000001",
  personId,
  measuredAt: baselineInput.measuredAt,
  localDate: "2026-07-28",
  timezone: baselineInput.timezone,
  weightKg: baselineInput.weightKg,
  sourceReference: {
    id: sourceReferenceId,
    ...baselineInput.sourceReference,
    ingestedAt: "2026-07-28T05:30:01.000Z"
  },
  dedupeKey: baselineInput.dedupeKey,
  confidence: null,
  supersedesId: null,
  correctionReason: null,
  createdAt: "2026-07-28T05:30:01.000Z"
};

class FakeStore implements WeightMeasurementStore {
  public async create(
    activePersonId: string,
    input: CreateWeightMeasurement
  ): Promise<CreateWeightMeasurementResult> {
    toNewWeightMeasurement(
      activePersonId,
      sourceReferenceId,
      input
    );
    return {
      created: true,
      measurement: {
        ...baselineMeasurement,
        personId: activePersonId,
        measuredAt: input.measuredAt,
        timezone: input.timezone,
        weightKg: input.weightKg,
        sourceReference: {
          ...baselineMeasurement.sourceReference,
          ...input.sourceReference
        },
        dedupeKey: input.dedupeKey,
        confidence: input.confidence ?? null
      }
    };
  }

  public async correct(
    activePersonId: string,
    id: string,
    input: CorrectWeightMeasurement
  ): Promise<CreateWeightMeasurementResult> {
    return {
      created: true,
      measurement: {
        ...baselineMeasurement,
        id: "01983f6c-e470-7000-8000-000000000003",
        personId: activePersonId,
        measuredAt: input.measuredAt,
        timezone: input.timezone,
        weightKg: input.weightKg,
        sourceReference: {
          ...baselineMeasurement.sourceReference,
          ...input.sourceReference
        },
        dedupeKey: input.dedupeKey,
        confidence: input.confidence ?? null,
        supersedesId: id,
        correctionReason: input.reason
      }
    };
  }

  public async findById(): Promise<WeightMeasurement | null> {
    return baselineMeasurement;
  }

  public async list(): Promise<WeightMeasurementList> {
    return { items: [baselineMeasurement], nextCursor: null };
  }

  public async history(): Promise<WeightMeasurementHistory> {
    return { items: [baselineMeasurement] };
  }
}

const unreachable = async (): Promise<never> => {
  throw new Error("store method was not expected in this test");
};

const bodyMeasurementSessionStore: BodyMeasurementSessionStore = {
  create: unreachable,
  correct: unreachable,
  findById: unreachable,
  list: unreachable,
  history: unreachable
};

const physicalGoalStore: PhysicalGoalStore = {
  create: unreachable,
  addVersion: unreachable,
  activate: unreachable,
  complete: unreachable,
  cancel: unreachable,
  findById: unreachable,
  history: unreachable,
  list: unreachable
};

const nutritionStore: NutritionStore = {
  createBrand: unreachable,
  appendBrandVersion: unreachable,
  findBrand: unreachable,
  createIngredient: unreachable,
  appendIngredientVersion: unreachable,
  findIngredient: unreachable,
  createFood: unreachable,
  appendFoodVersion: unreachable,
  findFood: unreachable,
  upsertFoodOverlay: unreachable,
  createMeal: unreachable,
  correctMeal: unreachable,
  findMeal: unreachable,
  listMeals: unreachable,
  mealHistory: unreachable,
  dailyTotals: unreachable
};

const trainingStore: TrainingStore = {
  createExercise: unreachable,
  appendExerciseVersion: unreachable,
  findExercise: unreachable,
  upsertExerciseOverlay: unreachable,
  stageExerciseSourceRecord: unreachable,
  createProgram: unreachable,
  appendProgramVersion: unreachable,
  activateProgramVersion: unreachable,
  findProgram: unreachable,
  findActiveProgram: unreachable,
  createWorkoutSession: unreachable,
  correctWorkoutSession: unreachable,
  findWorkoutSession: unreachable,
  listWorkoutSessions: unreachable,
  workoutSessionHistory: unreachable,
  personalRecords: unreachable,
  progressionCandidates: unreachable,
  acceptProgressionCandidate: unreachable
};

const recoveryStore: RecoveryStore = {
  registerDeviceModel: unreachable,
  createConnection: unreachable,
  grantConsent: unreachable,
  revokeConsent: unreachable,
  createObservation: unreachable,
  correctObservation: unreachable,
  findObservation: unreachable,
  listObservations: unreachable,
  observationHistory: unreachable,
  registerPolicyVersion: unreachable,
  createAssessment: unreachable,
  findAssessment: unreachable,
  listAssessments: unreachable
};

const coachingStore: CoachingStore = {
  registerPolicyVersion: unreachable,
  createTrainingAdjustment: unreachable,
  decide: unreachable,
  find: unreachable,
  list: unreachable,
  history: unreachable
};

const physicalStateStores = {
  bodyMeasurementSessionStore,
  physicalGoalStore,
  nutritionStore,
  trainingStore,
  recoveryStore,
  coachingStore
};

describe("API bootstrap", () => {
  it("serves health and OpenAPI generated from route schemas", async () => {
    const app = await buildApp({
      config,
      store: new FakeStore(),
      ...physicalStateStores,
      readinessProbe: async () => undefined
    });

    const fastify = getFastifyInstance(app);
    const health = await fastify.inject({ method: "GET", url: "/health" });
    const openapi = await fastify.inject({
      method: "GET",
      url: "/openapi.json"
    });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok" });
    expect(openapi.statusCode).toBe(200);
    expect(openapi.json().paths).toHaveProperty(
      "/v1/weight-measurements"
    );
    expect(
      openapi.json().paths["/v1/weight-measurements"].post.requestBody
        .content["application/json"].schema
    ).toEqual(CreateWeightMeasurementSchema);
    expect(
      openapi.json().paths["/v1/weight-measurements"].post.requestBody
    ).toBeDefined();
    expect(openapi.json().paths).toHaveProperty(
      "/v1/body-measurement-sessions"
    );
    expect(openapi.json().paths).toHaveProperty("/v1/physical-goals");
    expect(openapi.json().paths).toHaveProperty(
      "/v1/nutrition/catalog/foods"
    );
    expect(openapi.json().paths).toHaveProperty("/v1/nutrition/meals");
    expect(openapi.json().paths).toHaveProperty("/v1/recovery/observations");
    expect(openapi.json().paths).toHaveProperty("/v1/recovery/assessments");
    expect(openapi.json().paths).toHaveProperty(
      "/v1/coaching/recommendations/training-adjustments"
    );

    await app.close();
  });

  it("returns 503 when the PostgreSQL readiness probe fails", async () => {
    const app = await buildApp({
      config,
      store: new FakeStore(),
      ...physicalStateStores,
      readinessProbe: async () => {
        throw new Error("database unavailable");
      }
    });

    const response = await getFastifyInstance(app).inject({
      method: "GET",
      url: "/ready"
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "not_ready",
      database: "down"
    });

    await app.close();
  });

  it("rejects an invalid weight before storage", async () => {
    const app = await buildApp({
      config,
      store: new FakeStore(),
      ...physicalStateStores,
      readinessProbe: async () => undefined
    });

    const response = await getFastifyInstance(app).inject({
      method: "POST",
      url: "/v1/weight-measurements",
      payload: { ...baselineInput, weightKg: 0 }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("VALIDATION_ERROR");

    await app.close();
  });

  it("rejects an invalid IANA timezone", async () => {
    const app = await buildApp({
      config,
      store: new FakeStore(),
      ...physicalStateStores,
      readinessProbe: async () => undefined
    });

    const response = await getFastifyInstance(app).inject({
      method: "POST",
      url: "/v1/weight-measurements",
      payload: { ...baselineInput, timezone: "Mars/Olympus_Mons" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("IANA timezone");

    await app.close();
  });

  it("rejects handler output that violates the shared response schema", async () => {
    const store = new FakeStore();
    store.list = async () =>
      ({ items: [{ invalid: true }], nextCursor: null }) as unknown as
        WeightMeasurementList;
    const app = await buildApp({
      config,
      store,
      ...physicalStateStores,
      readinessProbe: async () => undefined
    });

    const response = await getFastifyInstance(app).inject({
      method: "GET",
      url: "/v1/weight-measurements"
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      statusCode: 500,
      error: "INTERNAL_SERVER_ERROR",
      message: "Internal server error"
    });

    await app.close();
  });
});
