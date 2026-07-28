import type { FastifyInstance } from "fastify";

import {
  HealthResponseSchema,
  ReadinessResponseSchema,
  type HealthResponse,
  type ReadinessResponse
} from "@shape-of-you/contracts";

/** Probe that resolves when required dependencies are ready for API traffic. */
export type ReadinessProbe = () => Promise<void>;

/**
 * Registers process liveness and dependency readiness endpoints.
 *
 * @param app - Fastify application receiving the routes.
 * @param readinessProbe - Dependency check used by `/ready`.
 */
export async function registerHealthRoutes(
  app: FastifyInstance,
  readinessProbe: ReadinessProbe
): Promise<void> {
  app.get<{ Reply: HealthResponse }>(
    "/health",
    {
      schema: {
        tags: ["system"],
        summary: "Process liveness",
        response: {
          200: HealthResponseSchema
        }
      }
    },
    async () => ({ status: "ok" })
  );

  app.get<{ Reply: ReadinessResponse }>(
    "/ready",
    {
      schema: {
        tags: ["system"],
        summary: "PostgreSQL readiness",
        response: {
          200: ReadinessResponseSchema,
          503: ReadinessResponseSchema
        }
      }
    },
    async (_request, reply) => {
      try {
        await readinessProbe();
        return { status: "ready", database: "up" };
      } catch (error) {
        app.log.warn(
          {
            error: error instanceof Error ? error.message : "unknown"
          },
          "readiness probe failed"
        );
        return reply
          .code(503)
          .send({ status: "not_ready", database: "down" });
      }
    }
  );
}
