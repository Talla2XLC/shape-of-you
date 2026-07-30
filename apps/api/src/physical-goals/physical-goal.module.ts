import { Module } from "@nestjs/common";

import { PhysicalGoalController } from "./physical-goal.controller.js";
import { PhysicalGoalService } from "./physical-goal.service.js";

/** Encapsulates versioned PhysicalGoal commands and queries. */
@Module({
  controllers: [PhysicalGoalController],
  providers: [PhysicalGoalService]
})
export class PhysicalGoalModule {}
