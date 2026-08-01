import { Body, Controller, Get, Inject, Param, Post, Query, Res, UseInterceptors } from "@nestjs/common";
import type { FastifyReply } from "fastify";

import {
  CoachingRecommendationHistorySchema,
  CoachingRecommendationIdParamsSchema,
  CoachingRecommendationListSchema,
  CoachingRecommendationSchema,
  CreateCoachingRecommendationDecisionSchema,
  CreateTrainingAdjustmentRecommendationSchema,
  ListCoachingRecommendationsQuerySchema,
  type CoachingRecommendation,
  type CoachingRecommendationHistory,
  type CoachingRecommendationIdParams,
  type CoachingRecommendationList,
  type CreateCoachingRecommendationDecision,
  type CreateTrainingAdjustmentRecommendation,
  type ListCoachingRecommendationsQuery
} from "@shape-of-you/contracts";

import { JsonSchemaPipe, JsonSchemaResponseInterceptor } from "../http/json-schema.js";
import { CoachingService } from "./coaching.service.js";

/** HTTP transport for immutable Coaching recommendations and decisions. */
@Controller("v1/coaching/recommendations")
export class CoachingController {
  public constructor(@Inject(CoachingService) private readonly service: CoachingService) {}

  @Post("training-adjustments")
  @UseInterceptors(new JsonSchemaResponseInterceptor(CoachingRecommendationSchema))
  public async createTrainingAdjustment(
    @Body(new JsonSchemaPipe<CreateTrainingAdjustmentRecommendation>(CreateTrainingAdjustmentRecommendationSchema))
    input: CreateTrainingAdjustmentRecommendation,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<CoachingRecommendation> {
    const result = await this.service.createTrainingAdjustment(input);
    void reply.code(result.created ? 201 : 200);
    return result.recommendation;
  }

  @Get()
  @UseInterceptors(new JsonSchemaResponseInterceptor(CoachingRecommendationListSchema))
  public list(
    @Query(new JsonSchemaPipe<ListCoachingRecommendationsQuery>(ListCoachingRecommendationsQuerySchema, true))
    query: ListCoachingRecommendationsQuery
  ): Promise<CoachingRecommendationList> {
    return this.service.list(query);
  }

  @Get(":id")
  @UseInterceptors(new JsonSchemaResponseInterceptor(CoachingRecommendationSchema))
  public find(
    @Param(new JsonSchemaPipe<CoachingRecommendationIdParams>(CoachingRecommendationIdParamsSchema, true))
    params: CoachingRecommendationIdParams
  ): Promise<CoachingRecommendation> {
    return this.service.find(params.id);
  }

  @Get(":id/history")
  @UseInterceptors(new JsonSchemaResponseInterceptor(CoachingRecommendationHistorySchema))
  public history(
    @Param(new JsonSchemaPipe<CoachingRecommendationIdParams>(CoachingRecommendationIdParamsSchema, true))
    params: CoachingRecommendationIdParams
  ): Promise<CoachingRecommendationHistory> {
    return this.service.history(params.id);
  }

  @Post(":id/decisions")
  @UseInterceptors(new JsonSchemaResponseInterceptor(CoachingRecommendationSchema))
  public async decide(
    @Param(new JsonSchemaPipe<CoachingRecommendationIdParams>(CoachingRecommendationIdParamsSchema, true))
    params: CoachingRecommendationIdParams,
    @Body(new JsonSchemaPipe<CreateCoachingRecommendationDecision>(CreateCoachingRecommendationDecisionSchema))
    input: CreateCoachingRecommendationDecision,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<CoachingRecommendation> {
    const result = await this.service.decide(params.id, input);
    void reply.code(result.created ? 201 : 200);
    return result.recommendation;
  }
}
