import { Controller, Get, Inject, Query, UseInterceptors } from "@nestjs/common";

import {
  ProgressOverviewQuerySchema,
  ProgressOverviewSchema,
  type ProgressOverview,
  type ProgressOverviewQuery
} from "@shape-of-you/contracts";

import { JsonSchemaPipe, JsonSchemaResponseInterceptor } from "../http/json-schema.js";
import { ProgressOverviewService } from "./progress-overview.service.js";

/** HTTP transport for the bounded progress read model. */
@Controller("v1")
export class ProgressOverviewController {
  public constructor(@Inject(ProgressOverviewService) private readonly service: ProgressOverviewService) {}

  /** Reads a sparse factual overview for one inclusive local-date range. */
  @Get("progress-overview")
  @UseInterceptors(new JsonSchemaResponseInterceptor(ProgressOverviewSchema))
  public read(
    @Query(new JsonSchemaPipe<ProgressOverviewQuery>(ProgressOverviewQuerySchema, true)) query: ProgressOverviewQuery
  ): Promise<ProgressOverview> {
    return this.service.read(query);
  }
}
