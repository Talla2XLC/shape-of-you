import { Body, Controller, Get, Inject, Param, Post, Query, Res, UseInterceptors } from "@nestjs/common";
import type { FastifyReply } from "fastify";

import {
  CorrectDailyContextNoteSchema,
  CreateDailyContextNoteSchema,
  DailyContextNoteHistorySchema,
  DailyContextNoteIdParamsSchema,
  DailyContextNoteListSchema,
  DailyContextNoteSchema,
  ListDailyContextNotesQuerySchema,
  type CorrectDailyContextNote,
  type CreateDailyContextNote,
  type DailyContextNote,
  type DailyContextNoteHistory,
  type DailyContextNoteIdParams,
  type DailyContextNoteList,
  type ListDailyContextNotesQuery
} from "@shape-of-you/contracts";

import { JsonSchemaPipe, JsonSchemaResponseInterceptor } from "../http/json-schema.js";
import { DailyContextNoteService } from "./daily-context-note.service.js";

/** HTTP transport for narrow append-only Person-local context notes. */
@Controller("v1/daily-context-notes")
export class DailyContextNoteController {
  public constructor(
    @Inject(DailyContextNoteService) private readonly service: DailyContextNoteService
  ) {}

  /** Creates an immutable note or returns its idempotent result. */
  @Post()
  @UseInterceptors(new JsonSchemaResponseInterceptor(DailyContextNoteSchema))
  public async create(
    @Body(new JsonSchemaPipe<CreateDailyContextNote>(CreateDailyContextNoteSchema))
    input: CreateDailyContextNote,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<DailyContextNote> {
    const result = await this.service.create(input);
    void reply.code(result.created ? 201 : 200);
    return result.note;
  }

  /** Appends an immutable note correction. */
  @Post(":id/corrections")
  @UseInterceptors(new JsonSchemaResponseInterceptor(DailyContextNoteSchema))
  public async correct(
    @Param(new JsonSchemaPipe<DailyContextNoteIdParams>(DailyContextNoteIdParamsSchema, true))
    params: DailyContextNoteIdParams,
    @Body(new JsonSchemaPipe<CorrectDailyContextNote>(CorrectDailyContextNoteSchema))
    input: CorrectDailyContextNote,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<DailyContextNote> {
    const result = await this.service.correct(params.id, input);
    void reply.code(result.created ? 201 : 200);
    return result.note;
  }

  /** Lists current notes for one exact Person-local date. */
  @Get()
  @UseInterceptors(new JsonSchemaResponseInterceptor(DailyContextNoteListSchema))
  public list(
    @Query(new JsonSchemaPipe<ListDailyContextNotesQuery>(ListDailyContextNotesQuerySchema, true))
    query: ListDailyContextNotesQuery
  ): Promise<DailyContextNoteList> {
    return this.service.list(query);
  }

  /** Returns the complete append-only correction history. */
  @Get(":id/history")
  @UseInterceptors(new JsonSchemaResponseInterceptor(DailyContextNoteHistorySchema))
  public history(
    @Param(new JsonSchemaPipe<DailyContextNoteIdParams>(DailyContextNoteIdParamsSchema, true))
    params: DailyContextNoteIdParams
  ): Promise<DailyContextNoteHistory> {
    return this.service.history(params.id);
  }
}
