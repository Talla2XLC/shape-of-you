import { Module } from "@nestjs/common";

import { BodyMeasurementSessionModule } from "../body-measurement-sessions/body-measurement-session.module.js";
import { CoachingModule } from "../coaching/coaching.module.js";
import { DailyContextNoteModule } from "../daily-context-notes/daily-context-note.module.js";
import { NutritionModule } from "../nutrition/nutrition.module.js";
import { RecoveryModule } from "../recovery/recovery.module.js";
import { TrainingModule } from "../training/training.module.js";
import { WeightMeasurementModule } from "../weight-measurements/weight-measurement.module.js";
import { DailyProjectionController } from "./daily-projection.controller.js";
import { DailyProjectionService } from "./daily-projection.service.js";

/** Composes current daily views through module-owned read services. */
@Module({
  imports: [
    WeightMeasurementModule,
    BodyMeasurementSessionModule,
    NutritionModule,
    TrainingModule,
    RecoveryModule,
    CoachingModule,
    DailyContextNoteModule
  ],
  controllers: [DailyProjectionController],
  providers: [DailyProjectionService],
  exports: [DailyProjectionService]
})
export class DailyProjectionModule {}
