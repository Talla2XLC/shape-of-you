import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication
} from "@nestjs/platform-fastify";
import type { FastifyInstance } from "fastify";

import type { AppConfig } from "@shape-of-you/config";

import { AppModule } from "./application/app.module.js";
import {
  SyntheticPersonContext,
  type PersonContext
} from "./application/person-context.js";
import {
  createDatabase,
  type DatabaseContext
} from "./database/context.js";
import { ApplicationExceptionFilter } from "./http/application-exception.filter.js";
import { FastifyLoggerService } from "./http/fastify-logger.service.js";
import type { ReadinessProbe } from "./system/system.controller.js";
import {
  WeightMeasurementRepository,
  type WeightMeasurementStore
} from "./storage/weight-measurement-repository.js";
import {
  BodyMeasurementSessionRepository,
  type BodyMeasurementSessionStore
} from "./storage/body-measurement-session-repository.js";
import {
  PhysicalGoalRepository,
  type PhysicalGoalStore
} from "./storage/physical-goal-repository.js";
import {
  NutritionRepository,
  type NutritionStore
} from "./storage/nutrition-repository.js";
import {
  TrainingRepository,
  type TrainingStore
} from "./storage/training-repository.js";
import {
  RecoveryRepository,
  type RecoveryStore
} from "./storage/recovery-repository.js";
import {
  CoachingRepository,
  type CoachingStore
} from "./storage/coaching-repository.js";

/** Explicit dependencies and validated configuration used to build the API. */
export interface BuildAppOptions {
  /** Validated runtime configuration. */
  readonly config: AppConfig;
  /** Optional caller-owned database context, primarily for composition tests. */
  readonly database?: DatabaseContext;
  /** Optional readiness override used by tests or alternate dependency checks. */
  readonly readinessProbe?: ReadinessProbe;
  /** Optional persistence implementation used for isolated application tests. */
  readonly store?: WeightMeasurementStore;
  /** Optional body-session persistence used for isolated application tests. */
  readonly bodyMeasurementSessionStore?: BodyMeasurementSessionStore;
  /** Optional goal persistence used for isolated application tests. */
  readonly physicalGoalStore?: PhysicalGoalStore;
  /** Optional Nutrition persistence used for isolated application tests. */
  readonly nutritionStore?: NutritionStore;
  /** Optional Training persistence used for isolated application tests. */
  readonly trainingStore?: TrainingStore;
  /** Optional Recovery persistence used for isolated application tests. */
  readonly recoveryStore?: RecoveryStore;
  /** Optional Coaching persistence used for isolated application tests. */
  readonly coachingStore?: CoachingStore;
  /** Optional Person resolution boundary, primarily for isolated tests. */
  readonly personContext?: PersonContext;
}

/**
 * Returns the underlying Fastify instance for adapter-specific operations.
 *
 * @param app - Bootstrapped Nest application using FastifyAdapter.
 * @returns Fastify instance used for request injection and structured logging.
 */
export function getFastifyInstance(
  app: NestFastifyApplication
): FastifyInstance {
  return app.getHttpAdapter().getInstance() as FastifyInstance;
}

/**
 * Builds and initializes the Nest API without starting a network listener.
 *
 * The application closes only database contexts that it creates itself.
 *
 * @param options - Validated configuration and optional injected dependencies.
 * @returns An initialized Nest application ready to listen or inject requests.
 * @throws Error when no WeightMeasurement store can be constructed.
 */
export async function buildApp(
  options: BuildAppOptions
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    logger:
      options.config.NODE_ENV === "test"
        ? false
        : { level: options.config.LOG_LEVEL }
  });
  const ownsDatabase = !options.database && !options.store;
  const database =
    options.database ??
    (options.store ? undefined : createDatabase(options.config));
  const store =
    options.store ??
    (database ? new WeightMeasurementRepository(database) : undefined);
  const bodyMeasurementSessionStore =
    options.bodyMeasurementSessionStore ??
    (database
      ? new BodyMeasurementSessionRepository(database)
      : undefined);
  const physicalGoalStore =
    options.physicalGoalStore ??
    (database ? new PhysicalGoalRepository(database) : undefined);
  const nutritionStore =
    options.nutritionStore ??
    (database ? new NutritionRepository(database) : undefined);
  const trainingStore =
    options.trainingStore ??
    (database ? new TrainingRepository(database) : undefined);
  const recoveryStore =
    options.recoveryStore ??
    (database ? new RecoveryRepository(database) : undefined);
  const coachingStore =
    options.coachingStore ??
    (database ? new CoachingRepository(database) : undefined);

  if (
    !store ||
    !bodyMeasurementSessionStore ||
    !physicalGoalStore ||
    !nutritionStore ||
    !trainingStore ||
    !recoveryStore ||
    !coachingStore
  ) {
    throw new Error("All application persistence stores are required");
  }

  const personContext =
    options.personContext ??
    (options.config.PERSON_CONTEXT_MODE === "synthetic" &&
    options.config.SYNTHETIC_PERSON_ID
      ? new SyntheticPersonContext(options.config.SYNTHETIC_PERSON_ID)
      : undefined);

  if (!personContext) {
    throw new Error(
      "Authenticated Person context is not implemented; use explicit synthetic mode"
    );
  }

  const readinessProbe =
    options.readinessProbe ??
    (database
      ? async () => {
          await database.pool.query("select 1");
        }
      : async () => {
          throw new Error("Database is not configured");
        });
  const logger =
    options.config.NODE_ENV === "test"
      ? false
      : new FastifyLoggerService(adapter.getInstance().log);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register({
      store,
      bodyMeasurementSessionStore,
      physicalGoalStore,
      nutritionStore,
      trainingStore,
      recoveryStore,
      coachingStore,
      personContext,
      readinessProbe,
      database,
      ownsDatabase
    }),
    adapter,
    { logger }
  );

  app.useGlobalFilters(new ApplicationExceptionFilter());
  await app.init();
  return app;
}
