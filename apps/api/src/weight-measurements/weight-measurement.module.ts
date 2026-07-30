import { Module } from "@nestjs/common";

import { WeightMeasurementController } from "./weight-measurement.controller.js";
import { WeightMeasurementService } from "./weight-measurement.service.js";

/** Encapsulates the current Physical State measurement vertical. */
@Module({
  controllers: [WeightMeasurementController],
  providers: [WeightMeasurementService]
})
export class WeightMeasurementModule {}
