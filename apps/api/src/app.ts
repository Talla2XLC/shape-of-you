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
  RequestPersonContext,
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
import {
  IntakeRepository,
  type IntakeStore
} from "./storage/intake-repository.js";
import {
  DailyContextNoteRepository,
  type DailyContextNoteStore
} from "./storage/daily-context-note-repository.js";
import type { IntakeParser } from "./domain/intake.js";
import { WeightMeasurementService } from "./weight-measurements/weight-measurement.service.js";
import { BodyMeasurementSessionService } from "./body-measurement-sessions/body-measurement-session.service.js";
import { NutritionService } from "./nutrition/nutrition.service.js";
import { TrainingService } from "./training/training.service.js";
import { RecoveryService } from "./recovery/recovery.service.js";
import { DailyContextNoteService } from "./daily-context-notes/daily-context-note.service.js";
import { DailyProjectionService } from "./daily-projections/daily-projection.service.js";
import { IdentitySubjectMappingRepository } from "./storage/identity-subject-mapping-repository.js";
import { McpAuthorizer } from "./mcp/oauth.js";
import { registerMcpRoutes } from "./mcp/server.js";
import { BrowserAuth } from "./browser-auth/browser-auth.js";
import {
  ChatAssistantConversationBindingRepository,
  type ChatAssistantConversationBindingStore
} from "./storage/chat-assistant-conversation-binding-repository.js";

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
  /** Optional test override for the API-owned Recovery erasure poller. */
  readonly recoveryErasureWorkerEnabled?: boolean;
  /** Optional Coaching persistence used for isolated application tests. */
  readonly coachingStore?: CoachingStore;
  /** Optional Intake persistence used for isolated application tests. */
  readonly intakeStore?: IntakeStore;
  /** Optional DailyContextNote persistence used for isolated application tests. */
  readonly dailyContextNoteStore?: DailyContextNoteStore;
  /** Optional assistant binding persistence used for isolated tests. */
  readonly chatAssistantConversationBindingStore?: ChatAssistantConversationBindingStore;
  /** Optional provider-neutral parser that enables the background worker. */
  readonly intakeParser?: IntakeParser;
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
 * @throws Error when the complete set of application stores cannot be constructed.
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
  const intakeStore =
    options.intakeStore ??
    (database ? new IntakeRepository(database) : undefined);
  const dailyContextNoteStore =
    options.dailyContextNoteStore ??
    (database ? new DailyContextNoteRepository(database) : undefined);
  const chatAssistantConversationBindingStore =
    options.chatAssistantConversationBindingStore ??
    (database
      ? new ChatAssistantConversationBindingRepository(database)
      : {
          resolveActive: async () => ({ status: "missing" as const })
        });

  if (
    !store ||
    !bodyMeasurementSessionStore ||
    !physicalGoalStore ||
    !nutritionStore ||
    !trainingStore ||
    !recoveryStore ||
    !coachingStore ||
    !intakeStore ||
    !dailyContextNoteStore
  ) {
    throw new Error("All application persistence stores are required");
  }

  const personContext =
    options.personContext ??
    new RequestPersonContext(
      options.config.PERSON_CONTEXT_MODE === "synthetic"
        ? options.config.SYNTHETIC_PERSON_ID
        : undefined
    );

  const readinessProbe =
    options.readinessProbe ??
    (database
      ? async () => {
          await database.pool.query("select 1");
        }
      : async () => {
          throw new Error("Database is not configured");
      });
  const identitySubjectMappings = database
    ? new IdentitySubjectMappingRepository(database)
    : null;
  const browserAuth =
    identitySubjectMappings &&
    personContext instanceof RequestPersonContext &&
    options.config.PERSON_CONTEXT_MODE === "authenticated"
      ? new BrowserAuth({
          origin: options.config.API_BROWSER_ORIGIN!,
          issuer: options.config.IDENTITY_OAUTH_ISSUER!,
          jwksUri: options.config.IDENTITY_OAUTH_JWKS_URI!,
          resource: options.config.IDENTITY_OAUTH_RESOURCE!,
          clientId: options.config.API_BROWSER_OAUTH_CLIENT_ID!,
          cookieKeys: options.config.API_BROWSER_SESSION_KEYS!
            .split(",")
            .map((key) => key.trim())
            .filter(Boolean),
          resolveAuthorizedPersons:
            identitySubjectMappings.resolveAuthorizedPersons.bind(
              identitySubjectMappings
            ),
          requestRecoveryErasure: ({
            personId,
            connectionId,
            idempotencyKey,
            authorityId
          }) => recoveryStore.requestErasure(
            personId,
            connectionId,
            idempotencyKey,
            "user_request",
            authorityId
          )
        })
      : null;
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
      recoveryErasureWorkerEnabled:
        options.recoveryErasureWorkerEnabled ?? options.config.NODE_ENV !== "test",
      coachingStore,
      intakeStore,
      dailyContextNoteStore,
      chatAssistantConversationBindingStore,
      intakeParser: options.intakeParser ?? null,
      personContext,
      readinessProbe,
      database,
      ownsDatabase
    }),
    adapter,
    { logger }
  );

  if (
    database &&
    personContext instanceof RequestPersonContext &&
    options.config.IDENTITY_OAUTH_ISSUER &&
    options.config.IDENTITY_OAUTH_JWKS_URI &&
    options.config.IDENTITY_OAUTH_RESOURCE
  ) {
    registerMcpRoutes({
      fastify: getFastifyInstance(app),
      issuer: options.config.IDENTITY_OAUTH_ISSUER,
      resource: options.config.IDENTITY_OAUTH_RESOURCE,
      authorizer: new McpAuthorizer(
        options.config.IDENTITY_OAUTH_ISSUER,
        options.config.IDENTITY_OAUTH_JWKS_URI,
        options.config.IDENTITY_OAUTH_RESOURCE,
        new IdentitySubjectMappingRepository(database)
      ),
      personContext,
      services: {
        weights: app.get(WeightMeasurementService),
        bodyMeasurements: app.get(BodyMeasurementSessionService),
        nutrition: app.get(NutritionService),
        training: app.get(TrainingService),
        recovery: app.get(RecoveryService),
        dailyContextNotes: app.get(DailyContextNoteService),
        dailyProjection: app.get(DailyProjectionService)
      }
    });
  }
  if (browserAuth && personContext instanceof RequestPersonContext) {
    browserAuth.register(getFastifyInstance(app));
    browserAuth.guardApiRoutes(getFastifyInstance(app), personContext);
  }

  app.useGlobalFilters(new ApplicationExceptionFilter());
  await app.init();
  return app;
}
