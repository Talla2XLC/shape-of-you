import { describe, expect, it } from "vitest";

import type { AppConfig } from "@shape-of-you/config";
import type {
  CreateWeightMeasurement,
  WeightMeasurement,
  WeightMeasurementList
} from "@shape-of-you/contracts";

import { buildApp } from "../src/app.js";
import {
  toNewWeightMeasurement
} from "../src/domain/weight-measurement.js";
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
  SHUTDOWN_TIMEOUT_MS: 1_000
};

const baselineInput: CreateWeightMeasurement = {
  measuredAt: "2026-07-28T05:30:00.000Z",
  timezone: "Europe/Moscow",
  weightKg: 82.125,
  source: "manual",
  dedupeKey: "manual:2026-07-28T05:30:00Z",
  provenance: { channel: "api" }
};

const baselineMeasurement: WeightMeasurement = {
  id: "01983f6c-e470-7000-8000-000000000001",
  measuredAt: baselineInput.measuredAt,
  localDate: "2026-07-28",
  timezone: baselineInput.timezone,
  weightKg: baselineInput.weightKg,
  source: baselineInput.source,
  sourceRecordId: null,
  dedupeKey: baselineInput.dedupeKey,
  confidence: null,
  provenance: baselineInput.provenance,
  createdAt: "2026-07-28T05:30:01.000Z"
};

class FakeStore implements WeightMeasurementStore {
  public async create(
    input: CreateWeightMeasurement
  ): Promise<CreateWeightMeasurementResult> {
    toNewWeightMeasurement(input);
    return {
      created: true,
      measurement: {
        ...baselineMeasurement,
        measuredAt: input.measuredAt,
        timezone: input.timezone,
        weightKg: input.weightKg,
        source: input.source,
        sourceRecordId: input.sourceRecordId ?? null,
        dedupeKey: input.dedupeKey,
        confidence: input.confidence ?? null,
        provenance: input.provenance
      }
    };
  }

  public async findById(): Promise<WeightMeasurement | null> {
    return baselineMeasurement;
  }

  public async list(): Promise<WeightMeasurementList> {
    return { items: [baselineMeasurement], nextCursor: null };
  }
}

describe("API bootstrap", () => {
  it("serves health and OpenAPI generated from route schemas", async () => {
    const app = await buildApp({
      config,
      store: new FakeStore(),
      readinessProbe: async () => undefined
    });

    const health = await app.inject({ method: "GET", url: "/health" });
    const openapi = await app.inject({ method: "GET", url: "/openapi.json" });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok" });
    expect(openapi.statusCode).toBe(200);
    expect(openapi.json().paths).toHaveProperty(
      "/v1/weight-measurements"
    );
    expect(
      openapi.json().paths["/v1/weight-measurements"].post.requestBody
    ).toBeDefined();

    await app.close();
  });

  it("returns 503 when the PostgreSQL readiness probe fails", async () => {
    const app = await buildApp({
      config,
      store: new FakeStore(),
      readinessProbe: async () => {
        throw new Error("database unavailable");
      }
    });

    const response = await app.inject({ method: "GET", url: "/ready" });

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
      readinessProbe: async () => undefined
    });

    const response = await app.inject({
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
      readinessProbe: async () => undefined
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/weight-measurements",
      payload: { ...baselineInput, timezone: "Mars/Olympus_Mons" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("IANA timezone");

    await app.close();
  });
});
