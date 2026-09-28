import { Module } from "@nestjs/common";

import { CoachingController } from "./coaching.controller.js";
import { CoachingService } from "./coaching.service.js";
import { DailyAssessmentController } from "./daily-assessment.controller.js";
import { DailyAssessmentService } from "./daily-assessment.service.js";
import { NutritionModule } from "../nutrition/nutrition.module.js";
import { RecoveryModule } from "../recovery/recovery.module.js";
import { TrainingModule } from "../training/training.module.js";
import { WeightMeasurementModule } from "../weight-measurements/weight-measurement.module.js";
import { DailyContextNoteModule } from "../daily-context-notes/daily-context-note.module.js";
import { CurrentRecoveryContextService } from "./current-recovery-context.service.js";
import { DailyDecisionContextService } from "./daily-decision-context.service.js";

/** Coaching recommendation and decision module. */
@Module({
  imports: [
    RecoveryModule,
    TrainingModule,
    NutritionModule,
    WeightMeasurementModule,
    DailyContextNoteModule
  ],
  controllers: [CoachingController, DailyAssessmentController],
  providers: [CoachingService, DailyAssessmentService, CurrentRecoveryContextService, DailyDecisionContextService],
  exports: [CoachingService, DailyAssessmentService, CurrentRecoveryContextService, DailyDecisionContextService]
})
export class CoachingModule {}
