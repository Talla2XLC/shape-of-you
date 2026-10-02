import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { AppConfig } from "@shape-of-you/config";
import { buildApp, getFastifyInstance } from "../src/app.js";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { TrainingRepository } from "../src/storage/training-repository.js";

let container: StartedPostgreSqlContainer;
let database: DatabaseContext;
let app: NestFastifyApplication;
const person = "00000000-0000-4000-8000-000000000150";
const another = "00000000-0000-4000-8000-000000000151";
const report = {
  occurredAt: null, temporalPrecision: "local_date" as const, localDate: "2026-10-02", timezone: "Europe/Belgrade",
  completionState: "in_progress" as const, workoutName: "A", dedupeKey: "a-start",
  sourceReference: { channel: "manual" as const, externalSystem: null, externalRecordId: null, occurredAt: null },
  exercises: [
    { exerciseLabel: "Smith-присед", exerciseVersionId: null, loadBasis: "external_weight" as const, note: "60 кг блинов; RIR 1–2", sets: Array.from({ length: 3 }, () => ({ weightKg: 60, reps: 10 })) },
    { exerciseLabel: "Жим гантелей", sets: Array.from({ length: 3 }, () => ({ weightKg: 22.5, reps: 12, rir: 2 })) },
    { exerciseLabel: "Разведения", sets: [] },
    { exerciseLabel: "Горизонтальная тяга", note: "RIR 1–2", sets: Array.from({ length: 3 }, () => ({ weightKg: 40, reps: 12 })) },
    { exerciseLabel: "Пресс", note: "Дальше тяжко", sets: Array.from({ length: 3 }, () => ({ weightKg: 15, reps: 12 })) }
  ]
};

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  const databaseUrl = container.getConnectionUri();
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = person;
  await runMigrations(databaseUrl);
  const config: AppConfig = { NODE_ENV: "test", HOST: "127.0.0.1", PORT: 3000, DATABASE_URL: databaseUrl,
    LOG_LEVEL: "silent", PERSON_CONTEXT_MODE: "synthetic", SYNTHETIC_PERSON_ID: person, SHUTDOWN_TIMEOUT_MS: 1000 };
  database = createDatabase(config);
  app = await buildApp({ config, database });
  await database.pool.query("insert into persons (id,kind,status) values ($1,'real','active'), ($2,'real','active') on conflict do nothing", [person, another]);
});
afterAll(async () => { await app?.close(); await database?.pool.end(); await container?.stop(); });

describe("reported workout PostgreSQL V2", () => {
  it("preserves all reported facts, completes once, and rejects stale parallel corrections", async () => {
    const http = getFastifyInstance(app);
    const first = await http.inject({ method: "POST", url: "/v2/training/sessions", payload: report });
    expect(first.statusCode, first.body).toBe(201);
    const fact = first.json();
    expect(fact).toMatchObject({ occurredAt: null, temporalPrecision: "local_date", completionState: "in_progress", localDate: report.localDate });
    expect(fact.exercises).toHaveLength(5);
    expect(fact.exercises[0]).toMatchObject({ exerciseId: null, exerciseVersionId: null, note: "60 кг блинов; RIR 1–2" });
    expect(fact.exercises[0].sets.map((set: { weightKg: number; rir: null }) => [set.weightKg,set.rir])).toEqual([[60,null],[60,null],[60,null]]);
    expect(fact.exercises[2].sets).toEqual([]);
    expect(fact.exercises[4].sets.map((set: { reps: number }) => set.reps)).toEqual([12,12,12]);
    const retry = await http.inject({ method: "POST", url: "/v2/training/sessions", payload: report });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().id).toBe(fact.id);
    const legacy = await http.inject({ method: "GET", url: "/v1/training/sessions?localDate=2026-10-02" });
    expect(legacy.statusCode).toBe(409);
    const store = new TrainingRepository(database);
    expect((await store.findWorkoutSession(another, fact.id))).toBeNull();
    expect((await store.personalRecords(person)).items).toEqual([]);
    const completed = { ...report, completionState: "completed" as const, dedupeKey: "a-finish", correctionReason: "Закончил A" };
    const results = await Promise.all(["a-finish", "a-other"].map((dedupeKey) => http.inject({ method: "POST", url: `/v2/training/sessions/${fact.id}/corrections`, payload: { ...completed, dedupeKey } })));
    expect(results.map((r) => r.statusCode).sort()).toEqual([201,409]);
    const winner = results.find((r) => r.statusCode === 201)!.json();
    const again = await http.inject({ method: "POST", url: `/v2/training/sessions/${fact.id}/corrections`, payload: { ...completed, dedupeKey: winner.dedupeKey } });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(winner.id);
    const current = await http.inject({ method: "GET", url: "/v2/training/sessions?localDate=2026-10-02" });
    expect(current.json().items).toHaveLength(1);
    expect(current.json().items[0]).toMatchObject({ completionState: "completed", supersedesId: fact.id });
    const history = await http.inject({ method: "GET", url: `/v2/training/sessions/${winner.id}/history` });
    expect(history.statusCode).toBe(200);
    expect(history.json().items).toHaveLength(2);
    expect((await store.personalRecords(person)).items).toEqual([]);
    const counts = await database.pool.query("select count(*)::int as count from performed_sets where performed_exercise_id=$1", [winner.exercises[2].id]);
    expect(counts.rows[0].count).toBe(0);
  });

  it("rejects empty measurement objects and preserves genuinely partial sets", async () => {
    const http = getFastifyInstance(app);
    const invalid = await http.inject({ method: "POST", url: "/v2/training/sessions", payload: { ...report, dedupeKey: "empty", exercises: [{ exerciseLabel: "Пресс", sets: [{}] }] } });
    expect(invalid.statusCode).toBe(400);
    const partial = await http.inject({ method: "POST", url: "/v2/training/sessions", payload: { ...report, dedupeKey: "weight-only", exercises: [{ exerciseLabel: "Пресс", sets: [{ weightKg: 15 }] }] } });
    expect(partial.statusCode,partial.body).toBe(201);
    expect(partial.json().exercises[0].sets[0]).toMatchObject({ weightKg: 15, reps: null, rir: null });
  });
  it("retains a resolved day-only record without inventing an instant or exposing private identities", async () => {
    const store = new TrainingRepository(database);
    const exercise = await store.createExercise(person, { visibility: "private", name: "Resolved Smith", category: "strength",
      movementPattern: null, equipment: "Smith", instructions: null, note: null });
    const http = getFastifyInstance(app);
    const payload = { ...report, completionState: "completed", dedupeKey: "resolved-date-only",
      exercises: [{ exerciseVersionId: exercise.currentVersion.id, exerciseLabel: "Resolved Smith", loadBasis: "external_weight", sets: [{ weightKg: 60, reps: 10 }] }] };
    const wrongLabel = await http.inject({ method: "POST", url: "/v2/training/sessions", payload: { ...payload, exercises: [{ ...payload.exercises[0], exerciseLabel: "Free bar squat" }] } });
    expect(wrongLabel.statusCode).toBe(409);
    const saved = await http.inject({ method: "POST", url: "/v2/training/sessions", payload });
    expect(saved.statusCode, saved.body).toBe(201);
    const records = await http.inject({ method: "GET", url: "/v2/training/personal-records" });
    expect(records.statusCode,records.body).toBe(200);
    expect(records.json().items).toEqual([expect.objectContaining({ exerciseId: exercise.id, weightKg: 60, reps: 10,
      occurredAt: null, localDate: "2026-10-02", temporalPrecision: "local_date" })]);
    const legacy = await http.inject({ method: "GET", url: "/v1/training/personal-records" });
    expect(legacy.statusCode).toBe(409);
    expect((await store.personalRecords(another)).items).toEqual([]);
    await expect(store.createWorkoutSession(another, { ...payload, completionState: "completed", dedupeKey: "foreign-exercise",
      exercises: [{ exerciseVersionId: exercise.currentVersion.id, exerciseLabel: "Resolved Smith", loadBasis: "external_weight", sets: [{ weightKg: 60, reps: 10 }] }] })).rejects.toThrow(/ExerciseVersion/);
  });

});
