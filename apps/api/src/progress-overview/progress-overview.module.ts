import { Module } from "@nestjs/common";

import { BodyMeasurementSessionModule } from "../body-measurement-sessions/body-measurement-session.module.js";
import { CoachingModule } from "../coaching/coaching.module.js";
import { NutritionModule } from "../nutrition/nutrition.module.js";
import { RecoveryModule } from "../recovery/recovery.module.js";
import { TrainingModule } from "../training/training.module.js";
import { WeightMeasurementModule } from "../weight-measurements/weight-measurement.module.js";
import { ProgressOverviewController } from "./progress-overview.controller.js";
import { ProgressOverviewService } from "./progress-overview.service.js";

/** Composes module-owned range reads without taking ownership of source facts. */
@Module({
  imports: [WeightMeasurementModule, BodyMeasurementSessionModule, NutritionModule, TrainingModule, RecoveryModule, CoachingModule],
  controllers: [ProgressOverviewController],
  providers: [ProgressOverviewService]
})
export class ProgressOverviewModule {}
