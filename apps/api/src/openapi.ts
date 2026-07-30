import {
  CreateWeightMeasurementSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  ListWeightMeasurementsQuerySchema,
  ReadinessResponseSchema,
  WeightMeasurementIdParamsSchema,
  WeightMeasurementListSchema,
  WeightMeasurementSchema
} from "@shape-of-you/contracts";

function schemaParameter(
  name: string,
  location: "path" | "query",
  required: boolean,
  schema: object
): object {
  return { name, in: location, required, schema };
}

/**
 * Builds the public OpenAPI document from the shared runtime schemas.
 *
 * @returns OpenAPI 3.1 document for the current API surface.
 */
export function createOpenApiDocument(): object {
  return {
    openapi: "3.1.0",
    info: {
      title: "Shape of You API",
      description: "Initial modular backend API",
      version: "0.1.0"
    },
    paths: {
      "/health": {
        get: {
          tags: ["system"],
          summary: "Process liveness",
          responses: {
            "200": {
              description: "Process is alive",
              content: {
                "application/json": { schema: HealthResponseSchema }
              }
            }
          }
        }
      },
      "/ready": {
        get: {
          tags: ["system"],
          summary: "PostgreSQL readiness",
          responses: {
            "200": {
              description: "Dependencies are ready",
              content: {
                "application/json": { schema: ReadinessResponseSchema }
              }
            },
            "503": {
              description: "A required dependency is unavailable",
              content: {
                "application/json": { schema: ReadinessResponseSchema }
              }
            }
          }
        }
      },
      "/v1/weight-measurements": {
        post: {
          tags: ["weight-measurements"],
          summary: "Create an immutable weight measurement",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: CreateWeightMeasurementSchema }
            }
          },
          responses: {
            "200": {
              description: "Existing measurement for the dedupe key",
              content: {
                "application/json": { schema: WeightMeasurementSchema }
              }
            },
            "201": {
              description: "Measurement created",
              content: {
                "application/json": { schema: WeightMeasurementSchema }
              }
            },
            "400": {
              description: "Invalid request",
              content: {
                "application/json": { schema: ErrorResponseSchema }
              }
            }
          }
        },
        get: {
          tags: ["weight-measurements"],
          summary: "List weight measurements in stable descending order",
          parameters: [
            schemaParameter(
              "limit",
              "query",
              false,
              ListWeightMeasurementsQuerySchema.properties.limit
            ),
            schemaParameter(
              "cursor",
              "query",
              false,
              ListWeightMeasurementsQuerySchema.properties.cursor
            )
          ],
          responses: {
            "200": {
              description: "One stable page",
              content: {
                "application/json": { schema: WeightMeasurementListSchema }
              }
            },
            "400": {
              description: "Invalid request",
              content: {
                "application/json": { schema: ErrorResponseSchema }
              }
            }
          }
        }
      },
      "/v1/weight-measurements/{id}": {
        get: {
          tags: ["weight-measurements"],
          summary: "Read a weight measurement by id",
          parameters: [
            schemaParameter(
              "id",
              "path",
              true,
              WeightMeasurementIdParamsSchema.properties.id
            )
          ],
          responses: {
            "200": {
              description: "Measurement found",
              content: {
                "application/json": { schema: WeightMeasurementSchema }
              }
            },
            "400": {
              description: "Invalid identifier",
              content: {
                "application/json": { schema: ErrorResponseSchema }
              }
            },
            "404": {
              description: "Measurement not found",
              content: {
                "application/json": { schema: ErrorResponseSchema }
              }
            }
          }
        }
      }
    }
  };
}
