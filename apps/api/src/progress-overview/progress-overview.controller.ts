import { Controller, Get, Inject, Query, UseInterceptors } from "@nestjs/common";

import {
  ProgressDataCoverageQuerySchema,
  ProgressDataCoverageSchema,
  ProgressOverviewQuerySchema,
  ProgressOverviewSchema,
  PersonalInsightsQuerySchema,
  PersonalInsightsResultSchema,
  type PersonalInsightsQuery,
  type PersonalInsightsResult,
  type ProgressDataCoverage,
  type ProgressDataCoverageQuery,
  type ProgressOverview,
  type ProgressOverviewQuery
} from "@shape-of-you/contracts";

import { JsonSchemaPipe, JsonSchemaResponseInterceptor } from "../http/json-schema.js";
import { ProgressOverviewService } from "./progress-overview.service.js";
import { ProgressDataCoverageService } from "./progress-data-coverage.service.js";
import { PersonalInsightsService } from "./personal-insights.service.js";

/** HTTP transport for the bounded progress read model. */
@Controller("v1")
export class ProgressOverviewController {
  public constructor(
    @Inject(ProgressOverviewService) private readonly service: ProgressOverviewService,
    @Inject(ProgressDataCoverageService) private readonly coverage: ProgressDataCoverageService,
    @Inject(PersonalInsightsService) private readonly insights: PersonalInsightsService
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

  /** Reads evidence-gated observations over completed Person-local days. */
  @Get("personal-insights")
  @UseInterceptors(new JsonSchemaResponseInterceptor(PersonalInsightsResultSchema))
  public readInsights(
    @Query(new JsonSchemaPipe<PersonalInsightsQuery>(PersonalInsightsQuerySchema, true)) query: PersonalInsightsQuery
  ): Promise<PersonalInsightsResult> {
    return this.insights.read(query);
  }
}
