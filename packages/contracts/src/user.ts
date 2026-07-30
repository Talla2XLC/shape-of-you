import type { FromSchema } from "json-schema-to-ts";

export const UserStatusSchema = {
  type: "string",
  enum: ["active", "disabled"]
} as const;

export const UserSchema = {
  $id: "User",
  type: "object",
  additionalProperties: false,
  required: ["id", "status", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    status: UserStatusSchema,
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" }
  }
} as const;

/** Authentication account identity, distinct from fitness data ownership. */
export type User = FromSchema<typeof UserSchema>;
