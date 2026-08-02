import { Module } from "@nestjs/common";

import { IntakeController } from "./intake.controller.js";
import { IntakeService } from "./intake.service.js";
import { IntakeWorker } from "./intake.worker.js";

/** Encapsulates durable natural-language Intake orchestration. */
@Module({
  controllers: [IntakeController],
  providers: [IntakeService, IntakeWorker],
  exports: [IntakeWorker]
})
export class IntakeModule {}
