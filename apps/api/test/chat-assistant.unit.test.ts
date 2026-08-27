import { describe, expect, it } from "vitest";

import { SyntheticPersonContext } from "../src/application/person-context.js";
import { ChatAssistantService } from "../src/chat-assistant/chat-assistant.service.js";
import {
  assertExternalConversationId,
  chatAssistantConversationUrl
} from "../src/domain/chat-assistant-conversation-binding.js";
import type {
  ChatAssistantBindingResolution,
  ChatAssistantConversationBindingStore
} from "../src/storage/chat-assistant-conversation-binding-repository.js";

const personId = "00000000-0000-4000-8000-000000000001";
const conversationId = "00000000-0000-8000-8000-000000000068";

function store(
  resolution: ChatAssistantBindingResolution
): ChatAssistantConversationBindingStore {
  return { resolveActive: async () => resolution };
}

describe("chat assistant launcher domain", () => {
  it("builds only the canonical ChatGPT conversation destination", () => {
    expect(
      chatAssistantConversationUrl({
        externalConversationId: conversationId,
        surface: "chatgpt_work"
      })
    ).toBe(`https://chatgpt.com/c/${conversationId}`);
  });

  it("rejects URLs, slashes, and unbounded identifiers", () => {
    for (const value of [
      "https://evil.test/c/private",
      "../../private-conversation",
      "short",
      "x".repeat(129)
    ]) {
      expect(() => assertExternalConversationId(value)).toThrow();
    }
  });

  it.each([
    ["missing", "not_configured"],
    ["disabled", "disabled"],
    ["ambiguous", "misconfigured"]
  ] as const)("maps %s state to %s without fallback", async (status, reason) => {
    const service = new ChatAssistantService(
      store({ status }),
      new SyntheticPersonContext(personId)
    );
    await expect(service.launch()).resolves.toEqual({
      status: "unavailable",
      reason
    });
  });

  it("fails closed when persisted state is malformed", async () => {
    const service = new ChatAssistantService(
      store({
        status: "active",
        binding: {
          id: "00000000-0000-4000-8000-000000000099",
          personId,
          surface: "chatgpt_work",
          externalConversationId: "https://evil.test/private",
          status: "active",
          createdAt: new Date(0),
          updatedAt: new Date(0)
        }
      }),
      new SyntheticPersonContext(personId)
    );
    await expect(service.launch()).resolves.toEqual({
      status: "unavailable",
      reason: "misconfigured"
    });
  });
});
