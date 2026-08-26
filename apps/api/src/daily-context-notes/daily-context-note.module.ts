import { Module } from "@nestjs/common";

import { DailyContextNoteController } from "./daily-context-note.controller.js";
import { DailyContextNoteService } from "./daily-context-note.service.js";

/** Encapsulates narrow Person-local DailyContextNote facts. */
@Module({
  controllers: [DailyContextNoteController],
  providers: [DailyContextNoteService],
  exports: [DailyContextNoteService]
})
export class DailyContextNoteModule {}
