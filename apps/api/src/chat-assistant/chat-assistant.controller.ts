import { Controller, Get, Headers, Inject, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";

import type {
  ChatAssistantLaunchError,
  ChatAssistantLaunchFailureReason
} from "@shape-of-you/contracts";

import { ChatAssistantService } from "./chat-assistant.service.js";

const failureMessages: Record<ChatAssistantLaunchFailureReason, string> = {
  disabled: "Shape of You Coach is disabled for this account",
  misconfigured: "Shape of You Coach configuration requires operator attention",
  not_configured: "Shape of You Coach is not configured for this account"
};

/** Browser and API transport for the persistent Work conversation launcher. */
@Controller("v1/chat-assistant")
export class ChatAssistantController {
  public constructor(
    @Inject(ChatAssistantService) private readonly service: ChatAssistantService
  ) {}

  /** Redirects to one allowlisted conversation or returns a bounded stop state. */
  @Get("launch")
  public async launch(
    @Headers("accept") accept: string | undefined,
    @Res() reply: FastifyReply
  ): Promise<void> {
    reply.header("cache-control", "no-store");
    reply.header("referrer-policy", "no-referrer");
    const resolution = await this.service.launch();
    if (resolution.status === "ready") {
      await reply.code(303).redirect(resolution.url);
      return;
    }
    if (accept?.includes("text/html")) {
      const target = new URL("/progress", "https://shape-of-you.invalid");
      target.searchParams.set("coach", resolution.reason);
      await reply.code(303).redirect(`${target.pathname}${target.search}`);
      return;
    }
    const body: ChatAssistantLaunchError = {
      error: "CHAT_ASSISTANT_UNAVAILABLE",
      message: failureMessages[resolution.reason],
      reason: resolution.reason,
      statusCode: 503
    };
    await reply.code(503).send(body);
  }
}
