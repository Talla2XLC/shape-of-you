import { Module } from "@nestjs/common";

import {
  TrainingCatalogController,
  TrainingActivityRecordingModeController,
  TrainingProgramController,
  WorkoutSessionV2Controller,
  WorkoutSessionController
} from "./training.controller.js";
import { TrainingService } from "./training.service.js";

/** Encapsulates Training catalog, programs, workout facts, and projections. */
@Module({
  controllers: [
    TrainingCatalogController,
    TrainingActivityRecordingModeController,
    TrainingProgramController,
    WorkoutSessionV2Controller,
    WorkoutSessionController
  ],
  providers: [TrainingService],
  exports: [TrainingService]
})
export class TrainingModule {}
