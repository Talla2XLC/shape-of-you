import { Module } from "@nestjs/common";

import {
  TrainingCatalogController,
  TrainingProgramController,
  WorkoutSessionController
} from "./training.controller.js";
import { TrainingService } from "./training.service.js";

/** Encapsulates Training catalog, programs, workout facts, and projections. */
@Module({
  controllers: [
    TrainingCatalogController,
    TrainingProgramController,
    WorkoutSessionController
  ],
  providers: [TrainingService]
})
export class TrainingModule {}
