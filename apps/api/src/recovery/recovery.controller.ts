import { Body, Controller, Get, Inject, Param, Post, Query, Res, UseInterceptors } from "@nestjs/common";
import type { FastifyReply } from "fastify";

import {
  CorrectRecoveryObservationSchema,
  CreateRecoveryAssessmentSchema,
  CreateRecoveryConnectionSchema,
  CreateRecoveryObservationSchema,
  GrantRecoveryConsentSchema,
  ListRecoveryAssessmentsQuerySchema,
  ListRecoveryObservationsQuerySchema,
  RecoveryAssessmentListSchema,
  RecoveryAssessmentSchema,
  RecoveryConnectionSchema,
  RecoveryConsentSchema,
  RecoveryIdParamsSchema,
  RecoveryObservationHistorySchema,
  RecoveryObservationListSchema,
  RecoveryObservationSchema,
  RevokeRecoveryConsentSchema,
  type CorrectRecoveryObservation,
  type CreateRecoveryAssessment,
  type CreateRecoveryConnection,
  type CreateRecoveryObservation,
  type GrantRecoveryConsent,
  type ListRecoveryAssessmentsQuery,
  type ListRecoveryObservationsQuery,
  type RecoveryAssessment,
  type RecoveryAssessmentList,
  type RecoveryConnection,
  type RecoveryConsent,
  type RecoveryIdParams,
  type RecoveryObservation,
  type RecoveryObservationHistory,
  type RecoveryObservationList,
  type RevokeRecoveryConsent
} from "@shape-of-you/contracts";

import { JsonSchemaPipe, JsonSchemaResponseInterceptor } from "../http/json-schema.js";
import { RecoveryService } from "./recovery.service.js";

/** HTTP transport for logical device connections and explicit consent. */
@Controller("v1/recovery")
export class RecoveryConnectionController {
  public constructor(@Inject(RecoveryService) private readonly service: RecoveryService) {}

  @Post("connections")
  @UseInterceptors(new JsonSchemaResponseInterceptor(RecoveryConnectionSchema))
  public async createConnection(
    @Body(new JsonSchemaPipe<CreateRecoveryConnection>(CreateRecoveryConnectionSchema)) input: CreateRecoveryConnection,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<RecoveryConnection> {
    void reply.code(201);
    return this.service.createConnection(input);
  }

  @Post("connections/:id/consents")
  @UseInterceptors(new JsonSchemaResponseInterceptor(RecoveryConsentSchema))
  public async grantConsent(
    @Param(new JsonSchemaPipe<RecoveryIdParams>(RecoveryIdParamsSchema, true)) params: RecoveryIdParams,
    @Body(new JsonSchemaPipe<GrantRecoveryConsent>(GrantRecoveryConsentSchema)) input: GrantRecoveryConsent,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<RecoveryConsent> {
    void reply.code(201);
    return this.service.grantConsent(params.id, input);
  }

  @Post("consents/:id/revoke")
  @UseInterceptors(new JsonSchemaResponseInterceptor(RecoveryConsentSchema))
  public revokeConsent(
    @Param(new JsonSchemaPipe<RecoveryIdParams>(RecoveryIdParamsSchema, true)) params: RecoveryIdParams,
    @Body(new JsonSchemaPipe<RevokeRecoveryConsent>(RevokeRecoveryConsentSchema)) input: RevokeRecoveryConsent
  ): Promise<RecoveryConsent> {
    return this.service.revokeConsent(params.id, input);
  }
}

/** HTTP transport for immutable typed Recovery observations. */
@Controller("v1/recovery/observations")
export class RecoveryObservationController {
  public constructor(@Inject(RecoveryService) private readonly service: RecoveryService) {}

  @Post()
  @UseInterceptors(new JsonSchemaResponseInterceptor(RecoveryObservationSchema))
  public async create(
    @Body(new JsonSchemaPipe<CreateRecoveryObservation>(CreateRecoveryObservationSchema)) input: CreateRecoveryObservation,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<RecoveryObservation> {
    const result = await this.service.createObservation(input);
    void reply.code(result.created ? 201 : 200);
    return result.observation;
  }

  @Get()
  @UseInterceptors(new JsonSchemaResponseInterceptor(RecoveryObservationListSchema))
  public list(
    @Query(new JsonSchemaPipe<ListRecoveryObservationsQuery>(ListRecoveryObservationsQuerySchema, true)) query: ListRecoveryObservationsQuery
  ): Promise<RecoveryObservationList> {
    return this.service.listObservations(query);
  }

  @Get(":id")
  @UseInterceptors(new JsonSchemaResponseInterceptor(RecoveryObservationSchema))
  public find(@Param(new JsonSchemaPipe<RecoveryIdParams>(RecoveryIdParamsSchema, true)) params: RecoveryIdParams): Promise<RecoveryObservation> {
    return this.service.findObservation(params.id);
  }

  @Post(":id/corrections")
  @UseInterceptors(new JsonSchemaResponseInterceptor(RecoveryObservationSchema))
  public async correct(
    @Param(new JsonSchemaPipe<RecoveryIdParams>(RecoveryIdParamsSchema, true)) params: RecoveryIdParams,
    @Body(new JsonSchemaPipe<CorrectRecoveryObservation>(CorrectRecoveryObservationSchema)) input: CorrectRecoveryObservation,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<RecoveryObservation> {
    const result = await this.service.correctObservation(params.id, input);
    void reply.code(result.created ? 201 : 200);
    return result.observation;
  }

  @Get(":id/history")
  @UseInterceptors(new JsonSchemaResponseInterceptor(RecoveryObservationHistorySchema))
  public history(@Param(new JsonSchemaPipe<RecoveryIdParams>(RecoveryIdParamsSchema, true)) params: RecoveryIdParams): Promise<RecoveryObservationHistory> {
    return this.service.observationHistory(params.id);
  }
}

/** HTTP transport for immutable policy-pinned Recovery assessments. */
@Controller("v1/recovery/assessments")
export class RecoveryAssessmentController {
  public constructor(@Inject(RecoveryService) private readonly service: RecoveryService) {}

  @Post()
  @UseInterceptors(new JsonSchemaResponseInterceptor(RecoveryAssessmentSchema))
  public async create(
    @Body(new JsonSchemaPipe<CreateRecoveryAssessment>(CreateRecoveryAssessmentSchema)) input: CreateRecoveryAssessment,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<RecoveryAssessment> {
    const result = await this.service.createAssessment(input);
    void reply.code(result.created ? 201 : 200);
    return result.assessment;
  }

  @Get()
  @UseInterceptors(new JsonSchemaResponseInterceptor(RecoveryAssessmentListSchema))
  public list(
    @Query(new JsonSchemaPipe<ListRecoveryAssessmentsQuery>(ListRecoveryAssessmentsQuerySchema, true)) query: ListRecoveryAssessmentsQuery
  ): Promise<RecoveryAssessmentList> {
    return this.service.listAssessments(query.limit ?? 50);
  }

  @Get(":id")
  @UseInterceptors(new JsonSchemaResponseInterceptor(RecoveryAssessmentSchema))
  public find(@Param(new JsonSchemaPipe<RecoveryIdParams>(RecoveryIdParamsSchema, true)) params: RecoveryIdParams): Promise<RecoveryAssessment> {
    return this.service.findAssessment(params.id);
  }
}
