import type { FastifyInstance } from "fastify";

import {
  CreateWeightMeasurementSchema,
  ErrorResponseSchema,
  ListWeightMeasurementsQuerySchema,
  WeightMeasurementIdParamsSchema,
  WeightMeasurementListSchema,
  WeightMeasurementSchema,
  type CreateWeightMeasurement,
  type ErrorResponse,
  type ListWeightMeasurementsQuery,
  type WeightMeasurement,
  type WeightMeasurementIdParams,
  type WeightMeasurementList
} from "@shape-of-you/contracts";

import { NotFoundError } from "../domain/errors.js";
import type { WeightMeasurementStore } from "../storage/weight-measurement-repository.js";

/**
 * Registers immutable WeightMeasurement create, read, and list endpoints.
 *
 * @param app - Fastify application receiving the routes.
 * @param store - Persistence boundary used by all registered handlers.
 */
export async function registerWeightMeasurementRoutes(
  app: FastifyInstance,
  store: WeightMeasurementStore
): Promise<void> {
  app.post<{
    Body: CreateWeightMeasurement;
    Reply: WeightMeasurement | ErrorResponse;
  }>(
    "/v1/weight-measurements",
    {
      schema: {
        tags: ["weight-measurements"],
        summary: "Create an immutable weight measurement",
        body: CreateWeightMeasurementSchema,
        response: {
          200: WeightMeasurementSchema,
          201: WeightMeasurementSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const result = await store.create(request.body);
      return reply
        .code(result.created ? 201 : 200)
        .send(result.measurement);
    }
  );

  app.get<{
    Params: WeightMeasurementIdParams;
    Reply: WeightMeasurement | ErrorResponse;
  }>(
    "/v1/weight-measurements/:id",
    {
      schema: {
        tags: ["weight-measurements"],
        summary: "Read a weight measurement by id",
        params: WeightMeasurementIdParamsSchema,
        response: {
          200: WeightMeasurementSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema
        }
      }
    },
    async (request) => {
      const measurement = await store.findById(request.params.id);
      if (!measurement) {
        throw new NotFoundError("WeightMeasurement was not found");
      }
      return measurement;
    }
  );

  app.get<{
    Querystring: ListWeightMeasurementsQuery;
    Reply: WeightMeasurementList | ErrorResponse;
  }>(
    "/v1/weight-measurements",
    {
      schema: {
        tags: ["weight-measurements"],
        summary: "List weight measurements in stable descending order",
        querystring: ListWeightMeasurementsQuerySchema,
        response: {
          200: WeightMeasurementListSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema
        }
      }
    },
    async (request) =>
      store.list(request.query.limit ?? 50, request.query.cursor)
  );
}
