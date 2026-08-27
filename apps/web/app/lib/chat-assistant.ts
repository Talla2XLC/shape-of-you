const stopMessages = {
  disabled: "Shape of You Coach is disabled for this account. No data was changed.",
  misconfigured: "Shape of You Coach needs operator attention. No fallback was used and no data was changed.",
  not_configured: "Shape of You Coach is not configured for this account. No data was changed."
} as const;

/** Same-origin API route that resolves the current Person's conversation. */
export const chatAssistantLaunchRoute = "/api/v1/chat-assistant/launch";

/** Maps only controlled launcher reasons to user-safe stop messages. */
export function chatAssistantStopMessage(value: unknown): string | null {
  if (typeof value !== "string" || !(value in stopMessages)) return null;
  return stopMessages[value as keyof typeof stopMessages];
}
