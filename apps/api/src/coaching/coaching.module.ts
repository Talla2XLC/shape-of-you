import { Module } from "@nestjs/common";

import { CoachingController } from "./coaching.controller.js";
import { CoachingService } from "./coaching.service.js";

/** Coaching recommendation and decision module. */
@Module({
  controllers: [CoachingController],
  providers: [CoachingService]
})
export class CoachingModule {}
