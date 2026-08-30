import { Inject, Injectable } from "@nestjs/common";

import type { ChatAssistantLaunchFailureReason } from "@shape-of-you/contracts";

import type { PersonContext } from "../application/person-context.js";
import {
  CHAT_ASSISTANT_CONVERSATION_BINDING_STORE,
  PERSON_CONTEXT
} from "../application/tokens.js";
import { chatAssistantConversationUrl } from "../domain/chat-assistant-conversation-binding.js";
import type { ChatAssistantConversationBindingStore } from "../storage/chat-assistant-conversation-binding-repository.js";

/** Result of resolving the current Person's durable ChatGPT conversation. */
export type ChatAssistantLaunchResolution =
  | { readonly status: "ready"; readonly url: string }
  | { readonly status: "unavailable"; readonly reason: ChatAssistantLaunchFailureReason };

/** Resolves a safe external assistant destination without mutating state. */
@Injectable()
export class ChatAssistantService {
  public constructor(
    @Inject(CHAT_ASSISTANT_CONVERSATION_BINDING_STORE)
    private readonly store: ChatAssistantConversationBindingStore,
    @Inject(PERSON_CONTEXT) private readonly personContext: PersonContext
  ) {}

  /** Returns one allowlisted destination or a bounded fail-closed reason. */
  public async launch(): Promise<ChatAssistantLaunchResolution> {
    const resolution = await this.store.resolveActive(
      this.personContext.getPersonId(),
      "chatgpt_chat"
    );
    if (resolution.status === "missing") {
      return { status: "unavailable", reason: "not_configured" };
    }
    if (resolution.status === "disabled") {
      return { status: "unavailable", reason: "disabled" };
    }
    if (resolution.status === "ambiguous") {
      return { status: "unavailable", reason: "misconfigured" };
    }
    try {
      return {
        status: "ready",
        url: chatAssistantConversationUrl(resolution.binding)
      };
    } catch {
      return { status: "unavailable", reason: "misconfigured" };
    }
  }
}
