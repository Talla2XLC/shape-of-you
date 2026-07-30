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
  CreateWeightMeasurementSchema,
  ListWeightMeasurementsQuerySchema,
  WeightMeasurementIdParamsSchema,
  WeightMeasurementListSchema,
  WeightMeasurementSchema,
  type CreateWeightMeasurement,
  type ListWeightMeasurementsQuery,
  type WeightMeasurement,
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
