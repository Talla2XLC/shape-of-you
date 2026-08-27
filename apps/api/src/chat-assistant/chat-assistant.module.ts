import { Module } from "@nestjs/common";

import { ChatAssistantController } from "./chat-assistant.controller.js";
import { ChatAssistantService } from "./chat-assistant.service.js";

/** Composes the API-owned external assistant launcher boundary. */
@Module({
  controllers: [ChatAssistantController],
  providers: [ChatAssistantService]
})
export class ChatAssistantModule {}
