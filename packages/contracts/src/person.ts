import type { FromSchema } from "json-schema-to-ts";

export const PersonStatusSchema = {
  type: "string",
  enum: ["active", "archived"]
} as const;

export const PersonKindSchema = {
  type: "string",
  enum: ["real", "synthetic"]
} as const;

export const PersonSchema = {
  $id: "Person",
  type: "object",
  additionalProperties: false,
  required: ["id", "kind", "status", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    kind: PersonKindSchema,
    status: PersonStatusSchema,
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" }
  }
} as const;

/** Domain identity of a person whose fitness data is managed. */
export type Person = FromSchema<typeof PersonSchema>;

export const PersonAccessRoleSchema = {
  type: "string",
  enum: ["owner", "editor", "viewer", "coach"]
} as const;

export const PersonAccessGrantStatusSchema = {
  type: "string",
  enum: ["active", "revoked"]
} as const;

export const PersonAccessGrantSchema = {
  $id: "PersonAccessGrant",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "personId",
    "userId",
    "role",
    "status",
    "grantedAt",
    "revokedAt"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    personId: { type: "string", format: "uuid" },
    userId: { type: "string", format: "uuid" },
    role: PersonAccessRoleSchema,
    status: PersonAccessGrantStatusSchema,
    grantedAt: { type: "string", format: "date-time" },
    revokedAt: {
      anyOf: [
        { type: "string", format: "date-time" },
        { type: "null" }
      ]
    }
  }
} as const;

/** Explicit authorization relationship between a User and a Person. */
export type PersonAccessGrant = FromSchema<
  typeof PersonAccessGrantSchema
>;
