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
  CorrectMealSchema,
  CreateMealSchema,
  DailyNutritionTotalsQuerySchema,
  DailyNutritionTotalsSchema,
  ListMealsQuerySchema,
  MealHistorySchema,
  MealIdParamsSchema,
  MealListSchema,
  MealSchema,
  type CorrectMeal,
  type CreateMeal,
  type DailyNutritionTotals,
  type DailyNutritionTotalsQuery,
  type ListMealsQuery,
  type Meal,
  type MealHistory,
  type MealIdParams,
  type MealList
} from "@shape-of-you/contracts";

import {
  JsonSchemaPipe,
  JsonSchemaResponseInterceptor
} from "../http/json-schema.js";
import { NutritionService } from "./nutrition.service.js";

/** HTTP transport for Person-owned immutable Meal facts and projections. */
@Controller("v1/nutrition")
export class MealController {
  public constructor(
    @Inject(NutritionService)
    private readonly service: NutritionService
  ) {}

  /** Creates one idempotent Meal fact with immutable item snapshots. */
  @Post("meals")
  @UseInterceptors(new JsonSchemaResponseInterceptor(MealSchema))
  public async create(
    @Body(new JsonSchemaPipe<CreateMeal>(CreateMealSchema))
    input: CreateMeal,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<Meal> {
    const result = await this.service.createMeal(input);
    void reply.code(result.created ? 201 : 200);
    return result.meal;
  }

  /** Lists current Meal facts, optionally restricted to one local date. */
  @Get("meals")
  @UseInterceptors(new JsonSchemaResponseInterceptor(MealListSchema))
  public list(
    @Query(
      new JsonSchemaPipe<ListMealsQuery>(
        ListMealsQuerySchema,
        true
      )
    )
    query: ListMealsQuery
  ): Promise<MealList> {
    return this.service.listMeals(query);
  }

  /** Reads one Meal fact by UUID. */
  @Get("meals/:id")
  @UseInterceptors(new JsonSchemaResponseInterceptor(MealSchema))
  public findById(
    @Param(
      new JsonSchemaPipe<MealIdParams>(MealIdParamsSchema, true)
    )
    params: MealIdParams
  ): Promise<Meal> {
    return this.service.findMeal(params.id);
  }

  /** Appends a full immutable correction and returns the replacement. */
  @Post("meals/:id/corrections")
  @UseInterceptors(new JsonSchemaResponseInterceptor(MealSchema))
  public async correct(
    @Param(
      new JsonSchemaPipe<MealIdParams>(MealIdParamsSchema, true)
    )
    params: MealIdParams,
    @Body(new JsonSchemaPipe<CorrectMeal>(CorrectMealSchema))
    input: CorrectMeal,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<Meal> {
    const result = await this.service.correctMeal(params.id, input);
    void reply.code(result.created ? 201 : 200);
    return result.meal;
  }

  /** Reads the append-only correction chain containing one Meal. */
  @Get("meals/:id/history")
  @UseInterceptors(new JsonSchemaResponseInterceptor(MealHistorySchema))
  public history(
    @Param(
      new JsonSchemaPipe<MealIdParams>(MealIdParamsSchema, true)
    )
    params: MealIdParams
  ): Promise<MealHistory> {
    return this.service.mealHistory(params.id);
  }

  /** Calculates totals from current Meal snapshots for one local date. */
  @Get("daily-totals")
  @UseInterceptors(
    new JsonSchemaResponseInterceptor(DailyNutritionTotalsSchema)
  )
  public dailyTotals(
    @Query(
      new JsonSchemaPipe<DailyNutritionTotalsQuery>(
        DailyNutritionTotalsQuerySchema,
        true
      )
    )
    query: DailyNutritionTotalsQuery
  ): Promise<DailyNutritionTotals> {
    return this.service.dailyTotals(query.localDate);
  }
}
