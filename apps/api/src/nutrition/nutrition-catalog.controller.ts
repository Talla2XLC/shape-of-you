import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Res,
  UseInterceptors
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

import {
  BrandSchema,
  CatalogIdParamsSchema,
  CreateBrandSchema,
  CreateBrandVersionSchema,
  CreateFoodSchema,
  CreateFoodVersionSchema,
  CreateIngredientSchema,
  CreateIngredientVersionSchema,
  FoodOverlaySchema,
  FoodSchema,
  IngredientSchema,
  UpsertFoodOverlaySchema,
  type Brand,
  type CatalogIdParams,
  type CreateBrand,
  type CreateBrandVersion,
  type CreateFood,
  type CreateFoodVersion,
  type CreateIngredient,
  type CreateIngredientVersion,
  type Food,
  type FoodOverlay,
  type Ingredient,
  type UpsertFoodOverlay
} from "@shape-of-you/contracts";

import {
  JsonSchemaPipe,
  JsonSchemaResponseInterceptor
} from "../http/json-schema.js";
import { NutritionService } from "./nutrition.service.js";

/** HTTP transport for shared and Person-private Nutrition catalog entries. */
@Controller("v1/nutrition/catalog")
export class NutritionCatalogController {
  public constructor(
    @Inject(NutritionService)
    private readonly service: NutritionService
  ) {}

  /** Creates a Brand identity and its first immutable version. */
  @Post("brands")
  @UseInterceptors(new JsonSchemaResponseInterceptor(BrandSchema))
  public async createBrand(
    @Body(new JsonSchemaPipe<CreateBrand>(CreateBrandSchema))
    input: CreateBrand,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<Brand> {
    void reply.code(201);
    return this.service.createBrand(input);
  }

  /** Appends and activates an immutable Brand version. */
  @Post("brands/:id/versions")
  @UseInterceptors(new JsonSchemaResponseInterceptor(BrandSchema))
  public addBrandVersion(
    @Param(
      new JsonSchemaPipe<CatalogIdParams>(
        CatalogIdParamsSchema,
        true
      )
    )
    params: CatalogIdParams,
    @Body(
      new JsonSchemaPipe<CreateBrandVersion>(
        CreateBrandVersionSchema
      )
    )
    input: CreateBrandVersion
  ): Promise<Brand> {
    return this.service.addBrandVersion(params.id, input);
  }

  /** Reads one accessible Brand. */
  @Get("brands/:id")
  @UseInterceptors(new JsonSchemaResponseInterceptor(BrandSchema))
  public findBrand(
    @Param(
      new JsonSchemaPipe<CatalogIdParams>(
        CatalogIdParamsSchema,
        true
      )
    )
    params: CatalogIdParams
  ): Promise<Brand> {
    return this.service.findBrand(params.id);
  }

  /** Creates an Ingredient identity and its first immutable version. */
  @Post("ingredients")
  @UseInterceptors(new JsonSchemaResponseInterceptor(IngredientSchema))
  public async createIngredient(
    @Body(
      new JsonSchemaPipe<CreateIngredient>(CreateIngredientSchema)
    )
    input: CreateIngredient,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<Ingredient> {
    void reply.code(201);
    return this.service.createIngredient(input);
  }

  /** Appends and activates an immutable Ingredient version. */
  @Post("ingredients/:id/versions")
  @UseInterceptors(new JsonSchemaResponseInterceptor(IngredientSchema))
  public addIngredientVersion(
    @Param(
      new JsonSchemaPipe<CatalogIdParams>(
        CatalogIdParamsSchema,
        true
      )
    )
    params: CatalogIdParams,
    @Body(
      new JsonSchemaPipe<CreateIngredientVersion>(
        CreateIngredientVersionSchema
      )
    )
    input: CreateIngredientVersion
  ): Promise<Ingredient> {
    return this.service.addIngredientVersion(params.id, input);
  }

  /** Reads one accessible Ingredient. */
  @Get("ingredients/:id")
  @UseInterceptors(new JsonSchemaResponseInterceptor(IngredientSchema))
  public findIngredient(
    @Param(
      new JsonSchemaPipe<CatalogIdParams>(
        CatalogIdParamsSchema,
        true
      )
    )
    params: CatalogIdParams
  ): Promise<Ingredient> {
    return this.service.findIngredient(params.id);
  }

  /** Creates a Food identity and its first immutable version. */
  @Post("foods")
  @UseInterceptors(new JsonSchemaResponseInterceptor(FoodSchema))
  public async createFood(
    @Body(new JsonSchemaPipe<CreateFood>(CreateFoodSchema))
    input: CreateFood,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<Food> {
    void reply.code(201);
    return this.service.createFood(input);
  }

  /** Appends and activates an immutable Food version. */
  @Post("foods/:id/versions")
  @UseInterceptors(new JsonSchemaResponseInterceptor(FoodSchema))
  public addFoodVersion(
    @Param(
      new JsonSchemaPipe<CatalogIdParams>(
        CatalogIdParamsSchema,
        true
      )
    )
    params: CatalogIdParams,
    @Body(
      new JsonSchemaPipe<CreateFoodVersion>(
        CreateFoodVersionSchema
      )
    )
    input: CreateFoodVersion
  ): Promise<Food> {
    return this.service.addFoodVersion(params.id, input);
  }

  /** Reads one accessible Food and its current immutable composition. */
  @Get("foods/:id")
  @UseInterceptors(new JsonSchemaResponseInterceptor(FoodSchema))
  public findFood(
    @Param(
      new JsonSchemaPipe<CatalogIdParams>(
        CatalogIdParamsSchema,
        true
      )
    )
    params: CatalogIdParams
  ): Promise<Food> {
    return this.service.findFood(params.id);
  }

  /** Replaces the active Person's preferences for one accessible Food. */
  @Put("foods/:id/overlay")
  @UseInterceptors(new JsonSchemaResponseInterceptor(FoodOverlaySchema))
  public upsertFoodOverlay(
    @Param(
      new JsonSchemaPipe<CatalogIdParams>(
        CatalogIdParamsSchema,
        true
      )
    )
    params: CatalogIdParams,
    @Body(
      new JsonSchemaPipe<UpsertFoodOverlay>(
        UpsertFoodOverlaySchema
      )
    )
    input: UpsertFoodOverlay
  ): Promise<FoodOverlay> {
    return this.service.upsertFoodOverlay(params.id, input);
  }
}
