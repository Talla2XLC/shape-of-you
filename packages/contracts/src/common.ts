import type { FromSchema } from "json-schema-to-ts";

export const ErrorResponseSchema = {
  $id: "ErrorResponse",
  type: "object",
  additionalProperties: false,
  required: ["error", "message", "statusCode"],
  properties: {
    error: { type: "string" },
    message: { type: "string" },
    statusCode: { type: "integer", minimum: 400, maximum: 599 }
  }
} as const;

export type ErrorResponse = FromSchema<typeof ErrorResponseSchema>;

export const HealthResponseSchema = {
  $id: "HealthResponse",
  type: "object",
  additionalProperties: false,
  required: ["status"],
  properties: {
    status: { type: "string", enum: ["ok"] }
  }
} as const;

export type HealthResponse = FromSchema<typeof HealthResponseSchema>;

export const ReadinessResponseSchema = {
  $id: "ReadinessResponse",
  type: "object",
  additionalProperties: false,
  required: ["status", "database"],
  properties: {
    status: { type: "string", enum: ["ready", "not_ready"] },
    database: { type: "string", enum: ["up", "down"] }
  }
} as const;

export type ReadinessResponse = FromSchema<typeof ReadinessResponseSchema>;
