import { Module } from "@nestjs/common";

import { SystemController } from "./system.controller.js";

/** Groups system-level HTTP endpoints for the backend process. */
@Module({
  controllers: [SystemController]
})
export class SystemModule {}
