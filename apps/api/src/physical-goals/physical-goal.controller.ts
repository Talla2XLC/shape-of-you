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
  CreatePhysicalGoalSchema,
  CreatePhysicalGoalVersionSchema,
  ListPhysicalGoalsQuerySchema,
  PhysicalGoalHistorySchema,
  PhysicalGoalIdParamsSchema,
  PhysicalGoalListSchema,
  PhysicalGoalSchema,
  PhysicalGoalTransitionSchema,
  PhysicalGoalVersionParamsSchema,
  type CreatePhysicalGoal,
  type CreatePhysicalGoalVersion,
  type ListPhysicalGoalsQuery,
  type PhysicalGoal,
  type PhysicalGoalHistory,
  type PhysicalGoalIdParams,
  type PhysicalGoalList,
  type PhysicalGoalTransition,
  type PhysicalGoalVersionParams
} from "@shape-of-you/contracts";

import {
  JsonSchemaPipe,
  JsonSchemaResponseInterceptor
} from "../http/json-schema.js";
import { PhysicalGoalService } from "./physical-goal.service.js";

/** HTTP transport for versioned PhysicalGoal commands and queries. */
@Controller("v1/physical-goals")
export class PhysicalGoalController {
  public constructor(
    @Inject(PhysicalGoalService)
    private readonly service: PhysicalGoalService
  ) {}

  /** Creates a goal and its first immutable draft version. */
  @Post()
  @UseInterceptors(new JsonSchemaResponseInterceptor(PhysicalGoalSchema))
  public async create(
    @Body(
      new JsonSchemaPipe<CreatePhysicalGoal>(
        CreatePhysicalGoalSchema
      )
    )
    input: CreatePhysicalGoal,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<PhysicalGoal> {
    const result = await this.service.create(input);
    void reply.code(result.created ? 201 : 200);
    return result.goal;
  }

  /** Appends an immutable draft version. */
  @Post(":id/versions")
  @UseInterceptors(new JsonSchemaResponseInterceptor(PhysicalGoalSchema))
  public async addVersion(
    @Param(
      new JsonSchemaPipe<PhysicalGoalIdParams>(
        PhysicalGoalIdParamsSchema,
        true
      )
    )
    params: PhysicalGoalIdParams,
    @Body(
      new JsonSchemaPipe<CreatePhysicalGoalVersion>(
        CreatePhysicalGoalVersionSchema
      )
    )
    input: CreatePhysicalGoalVersion,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<PhysicalGoal> {
    const result = await this.service.addVersion(params.id, input);
    void reply.code(result.created ? 201 : 200);
    return result.goal;
  }

  /** Activates one version with an optimistic lock check. */
  @Post(":id/versions/:version/activate")
  @UseInterceptors(new JsonSchemaResponseInterceptor(PhysicalGoalSchema))
  public activate(
    @Param(
      new JsonSchemaPipe<PhysicalGoalVersionParams>(
        PhysicalGoalVersionParamsSchema,
        true
      )
    )
    params: PhysicalGoalVersionParams,
    @Body(
      new JsonSchemaPipe<PhysicalGoalTransition>(
        PhysicalGoalTransitionSchema
      )
    )
    input: PhysicalGoalTransition
  ): Promise<PhysicalGoal> {
    return this.service.activate(params.id, params.version, input);
  }

  /** Completes an active goal. */
  @Post(":id/complete")
  @UseInterceptors(new JsonSchemaResponseInterceptor(PhysicalGoalSchema))
  public complete(
    @Param(
      new JsonSchemaPipe<PhysicalGoalIdParams>(
        PhysicalGoalIdParamsSchema,
        true
      )
    )
    params: PhysicalGoalIdParams,
    @Body(
      new JsonSchemaPipe<PhysicalGoalTransition>(
        PhysicalGoalTransitionSchema
      )
    )
    input: PhysicalGoalTransition
  ): Promise<PhysicalGoal> {
    return this.service.complete(params.id, input);
  }

  /** Cancels a draft or active goal. */
  @Post(":id/cancel")
  @UseInterceptors(new JsonSchemaResponseInterceptor(PhysicalGoalSchema))
  public cancel(
    @Param(
      new JsonSchemaPipe<PhysicalGoalIdParams>(
        PhysicalGoalIdParamsSchema,
        true
      )
    )
    params: PhysicalGoalIdParams,
    @Body(
      new JsonSchemaPipe<PhysicalGoalTransition>(
        PhysicalGoalTransitionSchema
      )
    )
    input: PhysicalGoalTransition
  ): Promise<PhysicalGoal> {
    return this.service.cancel(params.id, input);
  }

  /** Returns the root plus every immutable version. */
  @Get(":id/history")
  @UseInterceptors(
    new JsonSchemaResponseInterceptor(PhysicalGoalHistorySchema)
  )
  public history(
    @Param(
      new JsonSchemaPipe<PhysicalGoalIdParams>(
        PhysicalGoalIdParamsSchema,
        true
      )
    )
    params: PhysicalGoalIdParams
  ): Promise<PhysicalGoalHistory> {
    return this.service.history(params.id);
  }

  /** Lists goals with an optional lifecycle filter. */
  @Get()
  @UseInterceptors(
    new JsonSchemaResponseInterceptor(PhysicalGoalListSchema)
  )
  public list(
    @Query(
      new JsonSchemaPipe<ListPhysicalGoalsQuery>(
        ListPhysicalGoalsQuerySchema,
        true
      )
    )
    query: ListPhysicalGoalsQuery
  ): Promise<PhysicalGoalList> {
    return this.service.list(query);
  }

  /** Reads one goal aggregate by UUID. */
  @Get(":id")
  @UseInterceptors(new JsonSchemaResponseInterceptor(PhysicalGoalSchema))
  public findById(
    @Param(
      new JsonSchemaPipe<PhysicalGoalIdParams>(
        PhysicalGoalIdParamsSchema,
        true
      )
    )
    params: PhysicalGoalIdParams
  ): Promise<PhysicalGoal> {
    return this.service.findById(params.id);
  }
}
