import { Body, Controller, Get, Inject, Param, Post, Put, Res, UseInterceptors } from "@nestjs/common";
import type { FastifyReply } from "fastify";

import {
  CreateDailyRecommendationFeedbackSchema,
  DailyAssessmentResultSchema,
  DailyRecommendationFeedbackListSchema,
  DailyRecommendationFeedbackSchema,
  DailyRecommendationSnapshotIdParamsSchema,
  PersonPreferencesSchema,
  UpdatePersonPreferencesSchema,
  type CreateDailyRecommendationFeedback,
  type DailyAssessmentResult,
  type DailyRecommendationFeedback,
  type DailyRecommendationFeedbackList,
  type DailyRecommendationSnapshotIdParams,
  type PersonPreferences,
  type UpdatePersonPreferences
} from "@shape-of-you/contracts";

import { JsonSchemaPipe, JsonSchemaResponseInterceptor } from "../http/json-schema.js";
import { DailyAssessmentService } from "./daily-assessment.service.js";

const feedbackBodySchema = {
  ...CreateDailyRecommendationFeedbackSchema,
  $id: "CreateDailyRecommendationFeedbackBody",
  required: CreateDailyRecommendationFeedbackSchema.required.filter(
    (property) => property !== "snapshotId"
  ),
  properties: Object.fromEntries(
    Object.entries(CreateDailyRecommendationFeedbackSchema.properties)
      .filter(([property]) => property !== "snapshotId")
  )
} as const;

/** Authenticated Person preferences and API-owned daily assessment transport. */
@Controller("v1/daily-assessment")
export class DailyAssessmentController {
  public constructor(@Inject(DailyAssessmentService) private readonly service: DailyAssessmentService) {}

  @Get()
  @UseInterceptors(new JsonSchemaResponseInterceptor(DailyAssessmentResultSchema))
  public read(): Promise<DailyAssessmentResult> { return this.service.read(); }

  @Get(":snapshotId/feedback")
  @UseInterceptors(new JsonSchemaResponseInterceptor(DailyRecommendationFeedbackListSchema))
  public feedbackHistory(
    @Param(new JsonSchemaPipe<DailyRecommendationSnapshotIdParams>(DailyRecommendationSnapshotIdParamsSchema, true))
    params: DailyRecommendationSnapshotIdParams
  ): Promise<DailyRecommendationFeedbackList> {
    return this.service.listFeedback(params.snapshotId);
  }

  @Post(":snapshotId/feedback")
  @UseInterceptors(new JsonSchemaResponseInterceptor(DailyRecommendationFeedbackSchema))
  public async recordFeedback(
    @Param(new JsonSchemaPipe<DailyRecommendationSnapshotIdParams>(DailyRecommendationSnapshotIdParamsSchema, true))
    params: DailyRecommendationSnapshotIdParams,
    @Body(new JsonSchemaPipe<Omit<CreateDailyRecommendationFeedback, "snapshotId">>(
      feedbackBodySchema
    ))
    input: Omit<CreateDailyRecommendationFeedback, "snapshotId">,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<DailyRecommendationFeedback> {
    const result = await this.service.recordFeedback({ ...input, snapshotId: params.snapshotId });
    void reply.code(result.created ? 201 : 200);
    return result.feedback;
  }

  @Get("preferences")
  @UseInterceptors(new JsonSchemaResponseInterceptor(PersonPreferencesSchema))
  public preferences(): Promise<PersonPreferences> { return this.service.preferences(); }

  @Put("preferences")
  @UseInterceptors(new JsonSchemaResponseInterceptor(PersonPreferencesSchema))
  public updatePreferences(@Body(new JsonSchemaPipe<UpdatePersonPreferences>(UpdatePersonPreferencesSchema)) input: UpdatePersonPreferences): Promise<PersonPreferences> {
    return this.service.updatePreferences(input);
  }
}
