import { Controller, Get, Inject, Query, UseInterceptors } from "@nestjs/common";

import {
  ProgressDataCoverageQuerySchema,
  ProgressDataCoverageSchema,
  ProgressOverviewQuerySchema,
  ProgressOverviewSchema,
  type ProgressDataCoverage,
  type ProgressDataCoverageQuery,
  type ProgressOverview,
  type ProgressOverviewQuery
} from "@shape-of-you/contracts";

import { JsonSchemaPipe, JsonSchemaResponseInterceptor } from "../http/json-schema.js";
import { ProgressOverviewService } from "./progress-overview.service.js";
import { ProgressDataCoverageService } from "./progress-data-coverage.service.js";

/** HTTP transport for the bounded progress read model. */
@Controller("v1")
export class ProgressOverviewController {
  public constructor(
    @Inject(ProgressOverviewService) private readonly service: ProgressOverviewService,
    @Inject(ProgressDataCoverageService) private readonly coverage: ProgressDataCoverageService
  ) {}

  /** Reads a sparse factual overview for one inclusive local-date range. */
  @Get("progress-overview")
  @UseInterceptors(new JsonSchemaResponseInterceptor(ProgressOverviewSchema))
  public read(
    @Query(new JsonSchemaPipe<ProgressOverviewQuery>(ProgressOverviewQuerySchema, true)) query: ProgressOverviewQuery
  ): Promise<ProgressOverview> {
    return this.service.read(query);
  }

  /** Reads provider-neutral profile evidence and recommendation-context readiness. */
  @Get("progress-data-coverage")
  @UseInterceptors(new JsonSchemaResponseInterceptor(ProgressDataCoverageSchema))
  public readCoverage(
    @Query(new JsonSchemaPipe<ProgressDataCoverageQuery>(ProgressDataCoverageQuerySchema, true)) query: ProgressDataCoverageQuery
  ): Promise<ProgressDataCoverage> {
    return this.coverage.read(query);
  }
}
