import fastifySwagger from "@fastify/swagger";
import Fastify, {
  type FastifyError,
  type FastifyInstance
} from "fastify";

import type { AppConfig } from "@shape-of-you/config";
import type { ErrorResponse } from "@shape-of-you/contracts";

import {
  createDatabase,
  type DatabaseContext
} from "./database/context.js";
import { ApplicationError } from "./domain/errors.js";
import {
  registerHealthRoutes,
  type ReadinessProbe
} from "./routes/health.js";
import { registerWeightMeasurementRoutes } from "./routes/weight-measurements.js";
import {
  WeightMeasurementRepository,
  type WeightMeasurementStore
} from "./storage/weight-measurement-repository.js";

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
}

function errorResponse(
  statusCode: number,
  error: string,
  message: string
): ErrorResponse {
  return { statusCode, error, message };
}

/**
 * Builds and configures the Fastify API without starting a network listener.
 *
 * The application closes only database contexts that it creates itself.
 *
 * @param options - Validated configuration and optional injected dependencies.
 * @returns A configured Fastify instance ready to listen or inject requests.
 * @throws Error when no WeightMeasurement store can be constructed.
 */
export async function buildApp(
  options: BuildAppOptions
): Promise<FastifyInstance> {
  const app = Fastify({
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

  if (!store) {
    throw new Error("A WeightMeasurement store is required");
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

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Shape of You API",
        description: "Initial modular backend API",
        version: "0.1.0"
      }
    }
  });

  app.setErrorHandler(
    (error: FastifyError, _request, reply) => {
      if (error.validation) {
        return reply
          .code(400)
          .send(
            errorResponse(
              400,
              "VALIDATION_ERROR",
              "Request validation failed"
            )
          );
      }

      if (error instanceof ApplicationError) {
        return reply
          .code(error.statusCode)
          .send(errorResponse(error.statusCode, error.code, error.message));
      }

      app.log.error({ err: error }, "unhandled request error");
      return reply
        .code(500)
        .send(
          errorResponse(500, "INTERNAL_SERVER_ERROR", "Internal server error")
        );
    }
  );

  await registerHealthRoutes(app, readinessProbe);
  await registerWeightMeasurementRoutes(app, store);

  app.get(
    "/openapi.json",
    {
      schema: {
        hide: true
      }
    },
    async () => app.swagger()
  );

  if (ownsDatabase && database) {
    app.addHook("onClose", async () => {
      await database.pool.end();
    });
  }

  return app;
}
