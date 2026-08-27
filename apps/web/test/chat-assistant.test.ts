import { describe, expect, it } from "vitest";

import {
  chatAssistantLaunchRoute,
  chatAssistantStopMessage
} from "../app/lib/chat-assistant";

describe("chat assistant launcher contract", () => {
  it("uses only the same-origin API launcher route", () => {
    expect(chatAssistantLaunchRoute).toBe("/api/v1/chat-assistant/launch");
    expect(chatAssistantLaunchRoute).not.toContain("chatgpt.com");
  });

  it("renders only controlled fail-closed reasons", () => {
    expect(chatAssistantStopMessage("not_configured")).toContain(
      "not configured"
    );
    expect(chatAssistantStopMessage("disabled")).toContain("disabled");
    expect(chatAssistantStopMessage("misconfigured")).toContain(
      "No fallback was used"
    );
    expect(chatAssistantStopMessage("https://evil.test/private")).toBeNull();
    expect(chatAssistantStopMessage(["disabled"])).toBeNull();
  });
});
