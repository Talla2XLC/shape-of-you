import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UseInterceptors
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

import {
  CorrectWeightMeasurementSchema,
  CreateWeightMeasurementSchema,
  ListWeightMeasurementsQuerySchema,
  WeightMeasurementHistorySchema,
  WeightMeasurementIdParamsSchema,
  WeightMeasurementListSchema,
  WeightMeasurementSchema,
  type CorrectWeightMeasurement,
  type CreateWeightMeasurement,
  type ListWeightMeasurementsQuery,
  type WeightMeasurement,
  type WeightMeasurementHistory,
  type WeightMeasurementIdParams,
  type WeightMeasurementList
} from "@shape-of-you/contracts";

import {
  JsonSchemaPipe,
  JsonSchemaResponseInterceptor
} from "../http/json-schema.js";
import { WeightMeasurementService } from "./weight-measurement.service.js";

/** HTTP transport for immutable WeightMeasurement commands and queries. */
@Controller("v1/weight-measurements")
export class WeightMeasurementController {
  public constructor(
    @Inject(WeightMeasurementService)
    private readonly service: WeightMeasurementService
  ) {}

  /** Creates an immutable fact or returns the existing deduplicated fact. */
  @Post()
  @UseInterceptors(new JsonSchemaResponseInterceptor(WeightMeasurementSchema))
  public async create(
    @Body(new JsonSchemaPipe<CreateWeightMeasurement>(
      CreateWeightMeasurementSchema
    ))
    input: CreateWeightMeasurement,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<WeightMeasurement> {
    const result = await this.service.create(input);
    void reply.code(result.created ? 201 : 200);
    return result.measurement;
  }

  /** Appends an immutable correction to a current fact. */
  @Post(":id/corrections")
  @UseInterceptors(new JsonSchemaResponseInterceptor(WeightMeasurementSchema))
  public async correct(
    @Param(new JsonSchemaPipe<WeightMeasurementIdParams>(
      WeightMeasurementIdParamsSchema
    ))
    params: WeightMeasurementIdParams,
    @Body(new JsonSchemaPipe<CorrectWeightMeasurement>(
      CorrectWeightMeasurementSchema
    ))
    input: CorrectWeightMeasurement,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<WeightMeasurement> {
    const result = await this.service.correct(params.id, input);
    void reply.code(result.created ? 201 : 200);
    return result.measurement;
  }

  /** Returns the complete correction chain containing a fact. */
  @Get(":id/history")
  @UseInterceptors(
    new JsonSchemaResponseInterceptor(WeightMeasurementHistorySchema)
  )
  public history(
    @Param(new JsonSchemaPipe<WeightMeasurementIdParams>(
      WeightMeasurementIdParamsSchema
    ))
    params: WeightMeasurementIdParams
  ): Promise<WeightMeasurementHistory> {
    return this.service.history(params.id);
  }

  /** Lists immutable facts in stable descending keyset order. */
  @Get()
  @UseInterceptors(
    new JsonSchemaResponseInterceptor(WeightMeasurementListSchema)
  )
  public list(
    @Query(new JsonSchemaPipe<ListWeightMeasurementsQuery>(
      ListWeightMeasurementsQuerySchema
    ))
    query: ListWeightMeasurementsQuery
  ): Promise<WeightMeasurementList> {
    return this.service.list(query);
  }

  /** Reads one immutable fact by UUID. */
  @Get(":id")
  @UseInterceptors(new JsonSchemaResponseInterceptor(WeightMeasurementSchema))
  public findById(
    @Param(new JsonSchemaPipe<WeightMeasurementIdParams>(
      WeightMeasurementIdParamsSchema
    ))
    params: WeightMeasurementIdParams
  ): Promise<WeightMeasurement> {
    return this.service.findById(params.id);
  }
}
