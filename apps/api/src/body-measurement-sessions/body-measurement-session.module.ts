import { Module } from "@nestjs/common";

import { BodyMeasurementSessionController } from "./body-measurement-session.controller.js";
import { BodyMeasurementSessionService } from "./body-measurement-session.service.js";

/** Encapsulates body measurement session commands and queries. */
@Module({
  controllers: [BodyMeasurementSessionController],
  providers: [BodyMeasurementSessionService]
})
export class BodyMeasurementSessionModule {}
