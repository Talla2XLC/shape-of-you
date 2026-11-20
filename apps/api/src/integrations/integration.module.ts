import { Module } from "@nestjs/common";

import { GarminPersonalController } from "./garmin-personal.controller.js";
import { GarminPersonalService } from "./garmin-personal.service.js";
import { IntegrationController } from "./integration.controller.js";
import { IntegrationService } from "./integration.service.js";
import { IntegrationWorker } from "./integration.worker.js";
import { GarminCutoverController } from "./garmin-cutover.controller.js";
import { GarminCutoverService } from "./garmin-cutover.service.js";

/** In-process external account integration module. */
@Module({
  controllers: [IntegrationController, GarminPersonalController, GarminCutoverController],
  providers: [IntegrationService, GarminPersonalService, GarminCutoverService, IntegrationWorker],
  exports: [IntegrationService, GarminPersonalService, GarminCutoverService]
})
export class IntegrationModule {}
