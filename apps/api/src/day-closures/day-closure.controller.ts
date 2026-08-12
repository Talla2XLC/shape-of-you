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
  CloseDaySchema,
  DailyProjectionQuerySchema,
  DailyProjectionSchema,
  DayClosureHistorySchema,
  DayClosureSchema,
  ReopenDaySchema,
  type CloseDay,
  type DailyProjection,
  type DailyProjectionQuery,
  type DayClosure,
  type DayClosureHistory,
  type ReopenDay
} from "@shape-of-you/contracts";

import { JsonSchemaPipe, JsonSchemaResponseInterceptor } from "../http/json-schema.js";
import { DayClosureService } from "./day-closure.service.js";

/** HTTP transport for daily projection reads and explicit day lifecycle commands. */
@Controller("v1")
export class DayClosureController {
  public constructor(@Inject(DayClosureService) private readonly service: DayClosureService) {}

  /** Reads one live or closed Person-local daily projection. */
  @Get("day-projections")
  @UseInterceptors(new JsonSchemaResponseInterceptor(DailyProjectionSchema))
  public projection(
    @Query(new JsonSchemaPipe<DailyProjectionQuery>(DailyProjectionQuerySchema, true))
    query: DailyProjectionQuery
  ): Promise<DailyProjection> {
    return this.service.projection(query);
  }

  /** Creates a new immutable closure version for an open day. */
  @Post("day-closures")
  @UseInterceptors(new JsonSchemaResponseInterceptor(DayClosureSchema))
  public async close(
    @Body(new JsonSchemaPipe<CloseDay>(CloseDaySchema)) input: CloseDay,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<DayClosure> {
    const result = await this.service.close(input);
    void reply.code(result.created ? 201 : 200);
    return result.closure;
  }

  /** Supersedes the active closure without changing its immutable snapshot. */
  @Post("day-closures/:localDate/reopen")
  @UseInterceptors(new JsonSchemaResponseInterceptor(DayClosureSchema))
  public async reopen(
    @Param("localDate") localDate: string,
    @Body(new JsonSchemaPipe<ReopenDay>(ReopenDaySchema)) input: ReopenDay,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<DayClosure> {
    const result = await this.service.reopen(localDate, input);
    void reply.code(result.created ? 200 : 200);
    return result.closure;
  }

  /** Lists the append-only closure history for one Person-local date. */
  @Get("day-closures/history")
  @UseInterceptors(new JsonSchemaResponseInterceptor(DayClosureHistorySchema))
  public history(
    @Query(new JsonSchemaPipe<DailyProjectionQuery>(DailyProjectionQuerySchema, true))
    query: DailyProjectionQuery
  ): Promise<DayClosureHistory> {
    return this.service.history(query);
  }
}
