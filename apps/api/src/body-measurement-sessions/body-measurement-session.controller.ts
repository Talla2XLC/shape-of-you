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
  BodyMeasurementSessionHistorySchema,
  BodyMeasurementSessionIdParamsSchema,
  BodyMeasurementSessionListSchema,
  BodyMeasurementSessionSchema,
  CorrectBodyMeasurementSessionSchema,
  CreateBodyMeasurementSessionSchema,
  ListBodyMeasurementSessionsQuerySchema,
  type BodyMeasurementSession,
  type BodyMeasurementSessionHistory,
  type BodyMeasurementSessionIdParams,
  type BodyMeasurementSessionList,
  type CorrectBodyMeasurementSession,
  type CreateBodyMeasurementSession,
  type ListBodyMeasurementSessionsQuery
} from "@shape-of-you/contracts";

import {
  JsonSchemaPipe,
  JsonSchemaResponseInterceptor
} from "../http/json-schema.js";
import { BodyMeasurementSessionService } from "./body-measurement-session.service.js";

/** HTTP transport for immutable body measurement session commands and queries. */
@Controller("v1/body-measurement-sessions")
export class BodyMeasurementSessionController {
  public constructor(
    @Inject(BodyMeasurementSessionService)
    private readonly service: BodyMeasurementSessionService
  ) {}

  /** Creates a session or returns the existing deduplicated aggregate. */
  @Post()
  @UseInterceptors(
    new JsonSchemaResponseInterceptor(BodyMeasurementSessionSchema)
  )
  public async create(
    @Body(
      new JsonSchemaPipe<CreateBodyMeasurementSession>(
        CreateBodyMeasurementSessionSchema
      )
    )
    input: CreateBodyMeasurementSession,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<BodyMeasurementSession> {
    const result = await this.service.create(input);
    void reply.code(result.created ? 201 : 200);
    return result.session;
  }

  /** Appends a full replacement correction to a current session. */
  @Post(":id/corrections")
  @UseInterceptors(
    new JsonSchemaResponseInterceptor(BodyMeasurementSessionSchema)
  )
  public async correct(
    @Param(
      new JsonSchemaPipe<BodyMeasurementSessionIdParams>(
        BodyMeasurementSessionIdParamsSchema,
        true
      )
    )
    params: BodyMeasurementSessionIdParams,
    @Body(
      new JsonSchemaPipe<CorrectBodyMeasurementSession>(
        CorrectBodyMeasurementSessionSchema
      )
    )
    input: CorrectBodyMeasurementSession,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<BodyMeasurementSession> {
    const result = await this.service.correct(params.id, input);
    void reply.code(result.created ? 201 : 200);
    return result.session;
  }

  /** Returns the complete immutable correction chain. */
  @Get(":id/history")
  @UseInterceptors(
    new JsonSchemaResponseInterceptor(
      BodyMeasurementSessionHistorySchema
    )
  )
  public history(
    @Param(
      new JsonSchemaPipe<BodyMeasurementSessionIdParams>(
        BodyMeasurementSessionIdParamsSchema,
        true
      )
    )
    params: BodyMeasurementSessionIdParams
  ): Promise<BodyMeasurementSessionHistory> {
    return this.service.history(params.id);
  }

  /** Lists current sessions in stable descending order. */
  @Get()
  @UseInterceptors(
    new JsonSchemaResponseInterceptor(BodyMeasurementSessionListSchema)
  )
  public list(
    @Query(
      new JsonSchemaPipe<ListBodyMeasurementSessionsQuery>(
        ListBodyMeasurementSessionsQuerySchema,
        true
      )
    )
    query: ListBodyMeasurementSessionsQuery
  ): Promise<BodyMeasurementSessionList> {
    return this.service.list(query);
  }

  /** Reads one immutable session by UUID. */
  @Get(":id")
  @UseInterceptors(
    new JsonSchemaResponseInterceptor(BodyMeasurementSessionSchema)
  )
  public findById(
    @Param(
      new JsonSchemaPipe<BodyMeasurementSessionIdParams>(
        BodyMeasurementSessionIdParamsSchema,
        true
      )
    )
    params: BodyMeasurementSessionIdParams
  ): Promise<BodyMeasurementSession> {
    return this.service.findById(params.id);
  }
}
