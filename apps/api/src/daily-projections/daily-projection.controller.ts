import { Controller, Get, Inject, Query, UseInterceptors } from "@nestjs/common";
import {
  DailyProjectionQuerySchema,
  DailyProjectionSchema,
  type DailyProjection,
  type DailyProjectionQuery
} from "@shape-of-you/contracts";

import { JsonSchemaPipe, JsonSchemaResponseInterceptor } from "../http/json-schema.js";
import { DailyProjectionService } from "./daily-projection.service.js";

/** HTTP transport for the always-live Person-local daily projection. */
@Controller("v1")
export class DailyProjectionController {
  public constructor(
    @Inject(DailyProjectionService) private readonly service: DailyProjectionService
  ) {}

  /** Composes current owning-domain facts for one exact local date and timezone. */
  @Get("day-projections")
  @UseInterceptors(new JsonSchemaResponseInterceptor(DailyProjectionSchema))
  public projection(
    @Query(new JsonSchemaPipe<DailyProjectionQuery>(DailyProjectionQuerySchema, true))
    query: DailyProjectionQuery
  ): Promise<DailyProjection> {
    return this.service.projection(query);
  }
}
