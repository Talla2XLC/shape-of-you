/** Supported external assistant surface. */
export type ChatAssistantSurface = "chatgpt_chat";

/** Lifecycle state of a Person-owned external conversation binding. */
export type ChatAssistantBindingStatus = "active" | "disabled";

/** Person-owned pointer to one external conversation without credentials. */
export interface ChatAssistantConversationBinding {
  readonly id: string;
  readonly personId: string;
  readonly surface: ChatAssistantSurface;
  readonly externalConversationId: string;
  readonly status: ChatAssistantBindingStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const externalConversationIdPattern = /^[A-Za-z0-9_-]{16,128}$/u;

/** Validates a bounded opaque ChatGPT conversation identifier. */
export function assertExternalConversationId(value: string): void {
  if (!externalConversationIdPattern.test(value)) {
    throw new Error(
      "External conversation id must contain 16 to 128 URL-safe characters"
    );
  }
}

/** Builds the sole allowlisted external destination for a binding. */
export function chatAssistantConversationUrl(
  binding: Pick<
    ChatAssistantConversationBinding,
    "externalConversationId" | "surface"
  >
): string {
  if (binding.surface !== "chatgpt_chat") {
    throw new Error("Unsupported chat assistant surface");
  }
  assertExternalConversationId(binding.externalConversationId);
  return new URL(
    `/c/${binding.externalConversationId}`,
    "https://chatgpt.com"
  ).toString();
}
