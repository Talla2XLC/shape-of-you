import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseInterceptors
} from "@nestjs/common";

import {
  ClarifyIntakeItemSchema,
  CreateIntakeRequestSchema,
  DecideIntakeItemSchema,
  IntakeItemParamsSchema,
  IntakeRequestIdParamsSchema,
  IntakeRequestSchema,
  type ClarifyIntakeItem,
  type CreateIntakeRequest,
  type DecideIntakeItem,
  type IntakeItemParams,
  type IntakeRequest,
  type IntakeRequestIdParams
} from "@shape-of-you/contracts";

import {
  JsonSchemaPipe,
  JsonSchemaResponseInterceptor
} from "../http/json-schema.js";
import { IntakeService } from "./intake.service.js";

/** HTTP transport for asynchronous natural-language Intake. */
@Controller("v1/intake/requests")
export class IntakeController {
  public constructor(
    @Inject(IntakeService) private readonly service: IntakeService
  ) {}

  /** Durably accepts a message and returns its queued projection. */
  @Post()
  @HttpCode(202)
  @UseInterceptors(new JsonSchemaResponseInterceptor(IntakeRequestSchema))
  public create(
    @Body(new JsonSchemaPipe<CreateIntakeRequest>(CreateIntakeRequestSchema))
    input: CreateIntakeRequest
  ): Promise<IntakeRequest> {
    return this.service.create(input);
  }

  /** Reads current parsing and per-item progress. */
  @Get(":id")
  @UseInterceptors(new JsonSchemaResponseInterceptor(IntakeRequestSchema))
  public find(
    @Param(new JsonSchemaPipe<IntakeRequestIdParams>(
      IntakeRequestIdParamsSchema,
      true
    ))
    params: IntakeRequestIdParams
  ): Promise<IntakeRequest> {
    return this.service.find(params.id);
  }

  /** Submits a user answer and schedules item re-parsing. */
  @Post(":id/items/:itemId/clarification")
  @HttpCode(202)
  @UseInterceptors(new JsonSchemaResponseInterceptor(IntakeRequestSchema))
  public clarify(
    @Param(new JsonSchemaPipe<IntakeItemParams>(IntakeItemParamsSchema, true))
    params: IntakeItemParams,
    @Body(new JsonSchemaPipe<ClarifyIntakeItem>(ClarifyIntakeItemSchema))
    input: ClarifyIntakeItem
  ): Promise<IntakeRequest> {
    return this.service.clarify(params.id, params.itemId, input);
  }

  /** Confirms or rejects one parsed item independently. */
  @Post(":id/items/:itemId/decision")
  @HttpCode(202)
  @UseInterceptors(new JsonSchemaResponseInterceptor(IntakeRequestSchema))
  public decide(
    @Param(new JsonSchemaPipe<IntakeItemParams>(IntakeItemParamsSchema, true))
    params: IntakeItemParams,
    @Body(new JsonSchemaPipe<DecideIntakeItem>(DecideIntakeItemSchema))
    input: DecideIntakeItem
  ): Promise<IntakeRequest> {
    return this.service.decide(params.id, params.itemId, input);
  }
}
