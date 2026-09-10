import { Module } from "@nestjs/common";

import { IntegrationController } from "./integration.controller.js";
import { IntegrationService } from "./integration.service.js";
import { IntegrationWorker } from "./integration.worker.js";

/** In-process external account integration module. */
@Module({
  controllers: [IntegrationController],
  providers: [IntegrationService, IntegrationWorker],
  exports: [IntegrationService]
})
export class IntegrationModule {}
