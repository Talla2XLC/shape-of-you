import { Module } from "@nestjs/common";

import { GarminPersonalController } from "./garmin-personal.controller.js";
import { GarminPersonalService } from "./garmin-personal.service.js";
import { IntegrationController } from "./integration.controller.js";
import { IntegrationService } from "./integration.service.js";
import { IntegrationWorker } from "./integration.worker.js";

/** In-process external account integration module. */
@Module({
  controllers: [IntegrationController, GarminPersonalController],
  providers: [IntegrationService, GarminPersonalService, IntegrationWorker],
  exports: [IntegrationService, GarminPersonalService]
})
export class IntegrationModule {}
