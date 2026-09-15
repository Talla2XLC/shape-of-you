import { Module } from "@nestjs/common";

import { CoachingController } from "./coaching.controller.js";
import { CoachingService } from "./coaching.service.js";
import { DailyAssessmentController } from "./daily-assessment.controller.js";
import { DailyAssessmentService } from "./daily-assessment.service.js";
import { NutritionModule } from "../nutrition/nutrition.module.js";
import { RecoveryModule } from "../recovery/recovery.module.js";
import { TrainingModule } from "../training/training.module.js";
import { WeightMeasurementModule } from "../weight-measurements/weight-measurement.module.js";

/** Coaching recommendation and decision module. */
@Module({
  imports: [RecoveryModule, TrainingModule, NutritionModule, WeightMeasurementModule],
  controllers: [CoachingController, DailyAssessmentController],
  providers: [CoachingService, DailyAssessmentService],
  exports: [CoachingService, DailyAssessmentService]
})
export class CoachingModule {}
