import type { FromSchema } from "json-schema-to-ts";

export const ChatAssistantLaunchFailureReasonSchema = {
  type: "string",
  enum: ["disabled", "misconfigured", "not_configured"]
} as const;

/** Public stop reason that never contains an external conversation identifier. */
export type ChatAssistantLaunchFailureReason = FromSchema<
  typeof ChatAssistantLaunchFailureReasonSchema
>;

export const ChatAssistantLaunchErrorSchema = {
  $id: "ChatAssistantLaunchError",
  type: "object",
  additionalProperties: false,
  required: ["error", "message", "reason", "statusCode"],
  properties: {
    error: { type: "string", const: "CHAT_ASSISTANT_UNAVAILABLE" },
    message: { type: "string", minLength: 1 },
    reason: ChatAssistantLaunchFailureReasonSchema,
    statusCode: { type: "integer", const: 503 }
  }
} as const;

/** Typed API failure for a fail-closed assistant launch. */
export type ChatAssistantLaunchError = FromSchema<
  typeof ChatAssistantLaunchErrorSchema
>;
