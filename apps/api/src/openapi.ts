import {
  BodyMeasurementSessionHistorySchema,
  BodyMeasurementSessionIdParamsSchema,
  BodyMeasurementSessionListSchema,
  BodyMeasurementSessionSchema,
  CorrectBodyMeasurementSessionSchema,
  CreateBodyMeasurementSessionSchema,
  CreatePhysicalGoalSchema,
  CreatePhysicalGoalVersionSchema,
  CorrectWeightMeasurementSchema,
  CreateWeightMeasurementSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  ListBodyMeasurementSessionsQuerySchema,
  ListPhysicalGoalsQuerySchema,
  ListWeightMeasurementsQuerySchema,
  PhysicalGoalHistorySchema,
  PhysicalGoalIdParamsSchema,
  PhysicalGoalListSchema,
  PhysicalGoalSchema,
  PhysicalGoalTransitionSchema,
  PhysicalGoalVersionParamsSchema,
  ReadinessResponseSchema,
  WeightMeasurementHistorySchema,
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

function bodyMeasurementPaths(): Record<string, object> {
  return {
    "/v1/body-measurement-sessions": {
      post: {
        tags: ["body-measurements"],
        summary: "Create an immutable body measurement session",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: CreateBodyMeasurementSessionSchema
            }
          }
        },
        responses: {
          "200": {
            description: "Existing session for the dedupe key",
            content: {
              "application/json": {
                schema: BodyMeasurementSessionSchema
              }
            }
          },
          "201": {
            description: "Session created",
            content: {
              "application/json": {
                schema: BodyMeasurementSessionSchema
              }
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
        tags: ["body-measurements"],
        summary: "List current body measurement sessions",
        parameters: [
          schemaParameter(
            "limit",
            "query",
            false,
            ListBodyMeasurementSessionsQuerySchema.properties.limit
          ),
          schemaParameter(
            "cursor",
            "query",
            false,
            ListBodyMeasurementSessionsQuerySchema.properties.cursor
          ),
          schemaParameter(
            "metric",
            "query",
            false,
            ListBodyMeasurementSessionsQuerySchema.properties.metric
          )
        ],
        responses: {
          "200": {
            description: "Stable session page",
            content: {
              "application/json": {
                schema: BodyMeasurementSessionListSchema
              }
            }
          }
        }
      }
    },
    "/v1/body-measurement-sessions/{id}": {
      get: {
        tags: ["body-measurements"],
        summary: "Read a body measurement session",
        parameters: [
          schemaParameter(
            "id",
            "path",
            true,
            BodyMeasurementSessionIdParamsSchema.properties.id
          )
        ],
        responses: {
          "200": {
            description: "Session found",
            content: {
              "application/json": {
                schema: BodyMeasurementSessionSchema
              }
            }
          },
          "404": {
            description: "Session not found",
            content: {
              "application/json": { schema: ErrorResponseSchema }
            }
          }
        }
      }
    },
    "/v1/body-measurement-sessions/{id}/corrections": {
      post: {
        tags: ["body-measurements"],
        summary: "Append a full body session correction",
        parameters: [
          schemaParameter(
            "id",
            "path",
            true,
            BodyMeasurementSessionIdParamsSchema.properties.id
          )
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: CorrectBodyMeasurementSessionSchema
            }
          }
        },
        responses: {
          "200": {
            description: "Existing idempotent correction",
            content: {
              "application/json": {
                schema: BodyMeasurementSessionSchema
              }
            }
          },
          "201": {
            description: "Correction appended",
            content: {
              "application/json": {
                schema: BodyMeasurementSessionSchema
              }
            }
          },
          "409": {
            description: "Session already superseded",
            content: {
              "application/json": { schema: ErrorResponseSchema }
            }
          }
        }
      }
    },
    "/v1/body-measurement-sessions/{id}/history": {
      get: {
        tags: ["body-measurements"],
        summary: "Read the complete body session correction chain",
        parameters: [
          schemaParameter(
            "id",
            "path",
            true,
            BodyMeasurementSessionIdParamsSchema.properties.id
          )
        ],
        responses: {
          "200": {
            description: "Original-to-current session chain",
            content: {
              "application/json": {
                schema: BodyMeasurementSessionHistorySchema
              }
            }
          }
        }
      }
    }
  };
}

function physicalGoalPaths(): Record<string, object> {
  const goalResponse = {
    description: "PhysicalGoal aggregate",
    content: {
      "application/json": { schema: PhysicalGoalSchema }
    }
  };
  const transitionBody = {
    required: true,
    content: {
      "application/json": { schema: PhysicalGoalTransitionSchema }
    }
  };
  return {
    "/v1/physical-goals": {
      post: {
        tags: ["physical-goals"],
        summary: "Create a goal and first draft version",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: CreatePhysicalGoalSchema }
          }
        },
        responses: { "200": goalResponse, "201": goalResponse }
      },
      get: {
        tags: ["physical-goals"],
        summary: "List goals by lifecycle status",
        parameters: [
          schemaParameter(
            "status",
            "query",
            false,
            ListPhysicalGoalsQuerySchema.properties.status
          )
        ],
        responses: {
          "200": {
            description: "Goal list",
            content: {
              "application/json": { schema: PhysicalGoalListSchema }
            }
          }
        }
      }
    },
    "/v1/physical-goals/{id}": {
      get: {
        tags: ["physical-goals"],
        summary: "Read one PhysicalGoal",
        parameters: [
          schemaParameter(
            "id",
            "path",
            true,
            PhysicalGoalIdParamsSchema.properties.id
          )
        ],
        responses: { "200": goalResponse }
      }
    },
    "/v1/physical-goals/{id}/versions": {
      post: {
        tags: ["physical-goals"],
        summary: "Append an immutable draft version",
        parameters: [
          schemaParameter(
            "id",
            "path",
            true,
            PhysicalGoalIdParamsSchema.properties.id
          )
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: CreatePhysicalGoalVersionSchema
            }
          }
        },
        responses: { "200": goalResponse, "201": goalResponse }
      }
    },
    "/v1/physical-goals/{id}/versions/{version}/activate": {
      post: {
        tags: ["physical-goals"],
        summary: "Activate one immutable version",
        parameters: [
          schemaParameter(
            "id",
            "path",
            true,
            PhysicalGoalVersionParamsSchema.properties.id
          ),
          schemaParameter(
            "version",
            "path",
            true,
            PhysicalGoalVersionParamsSchema.properties.version
          )
        ],
        requestBody: transitionBody,
        responses: { "200": goalResponse }
      }
    },
    "/v1/physical-goals/{id}/complete": {
      post: {
        tags: ["physical-goals"],
        summary: "Complete an active goal",
        parameters: [
          schemaParameter(
            "id",
            "path",
            true,
            PhysicalGoalIdParamsSchema.properties.id
          )
        ],
        requestBody: transitionBody,
        responses: { "200": goalResponse }
      }
    },
    "/v1/physical-goals/{id}/cancel": {
      post: {
        tags: ["physical-goals"],
        summary: "Cancel a draft or active goal",
        parameters: [
          schemaParameter(
            "id",
            "path",
            true,
            PhysicalGoalIdParamsSchema.properties.id
          )
        ],
        requestBody: transitionBody,
        responses: { "200": goalResponse }
      }
    },
    "/v1/physical-goals/{id}/history": {
      get: {
        tags: ["physical-goals"],
        summary: "Read every immutable goal version",
        parameters: [
          schemaParameter(
            "id",
            "path",
            true,
            PhysicalGoalIdParamsSchema.properties.id
          )
        ],
        responses: {
          "200": {
            description: "Goal and immutable versions",
            content: {
              "application/json": { schema: PhysicalGoalHistorySchema }
            }
          }
        }
      }
    }
  };
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
      },
      "/v1/weight-measurements/{id}/corrections": {
        post: {
          tags: ["weight-measurements"],
          summary: "Append an immutable correction",
          parameters: [
            schemaParameter(
              "id",
              "path",
              true,
              WeightMeasurementIdParamsSchema.properties.id
            )
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: CorrectWeightMeasurementSchema
              }
            }
          },
          responses: {
            "200": {
              description: "Existing idempotent correction",
              content: {
                "application/json": { schema: WeightMeasurementSchema }
              }
            },
            "201": {
              description: "Correction appended",
              content: {
                "application/json": { schema: WeightMeasurementSchema }
              }
            },
            "404": {
              description: "Measurement not found",
              content: {
                "application/json": { schema: ErrorResponseSchema }
              }
            },
            "409": {
              description: "Measurement was already superseded",
              content: {
                "application/json": { schema: ErrorResponseSchema }
              }
            }
          }
        }
      },
      "/v1/weight-measurements/{id}/history": {
        get: {
          tags: ["weight-measurements"],
          summary: "Read the complete correction chain",
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
              description: "Original-to-current correction chain",
              content: {
                "application/json": {
                  schema: WeightMeasurementHistorySchema
                }
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
      },
      ...bodyMeasurementPaths(),
      ...physicalGoalPaths()
    }
  };
}
