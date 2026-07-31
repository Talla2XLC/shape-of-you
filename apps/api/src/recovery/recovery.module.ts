import { Module } from "@nestjs/common";

import {
  RecoveryAssessmentController,
  RecoveryConnectionController,
  RecoveryObservationController
} from "./recovery.controller.js";
import { RecoveryService } from "./recovery.service.js";

/** Recovery observations, consent and assessment module. */
@Module({
  controllers: [RecoveryConnectionController, RecoveryObservationController, RecoveryAssessmentController],
  providers: [RecoveryService]
})
export class RecoveryModule {}
