import { Inject, Injectable } from "@nestjs/common";

import type {
  Brand,
  CorrectMeal,
  CreateBrand,
  CreateBrandVersion,
  CreateFood,
  CreateFoodVersion,
  CreateIngredient,
  CreateIngredientVersion,
  CreateMeal,
  DailyNutritionTotals,
  Food,
  FoodOverlay,
  Ingredient,
  ListMealsQuery,
  Meal,
  MealHistory,
  MealList,
  UpsertFoodOverlay
} from "@shape-of-you/contracts";

import type { PersonContext } from "../application/person-context.js";
import {
  NUTRITION_STORE,
  PERSON_CONTEXT
} from "../application/tokens.js";
import { NotFoundError } from "../domain/errors.js";
import type {
  CreateMealResult,
  NutritionStore
} from "../storage/nutrition-repository.js";

/** Application boundary for the layered Nutrition catalog and Meal facts. */
@Injectable()
export class NutritionService {
  public constructor(
    @Inject(NUTRITION_STORE)
    private readonly store: NutritionStore,
    @Inject(PERSON_CONTEXT)
    private readonly personContext: PersonContext
  ) {}

  /** Creates a shared or Person-private Brand with its first version. */
  public createBrand(input: CreateBrand): Promise<Brand> {
    return this.store.createBrand(this.personContext.getPersonId(), input);
  }

  /** Appends and activates one immutable Brand version. */
  public addBrandVersion(
    id: string,
    input: CreateBrandVersion
  ): Promise<Brand> {
    return this.store.appendBrandVersion(
      this.personContext.getPersonId(),
      id,
      input
    );
  }

  /** Reads an accessible Brand or reports a uniform not-found result. */
  public async findBrand(id: string): Promise<Brand> {
    const brand = await this.store.findBrand(
      this.personContext.getPersonId(),
      id
    );
    if (!brand) {
      throw new NotFoundError("Nutrition Brand was not found");
    }
    return brand;
  }

  /** Creates a shared or Person-private Ingredient with its first version. */
  public createIngredient(input: CreateIngredient): Promise<Ingredient> {
    return this.store.createIngredient(
      this.personContext.getPersonId(),
      input
    );
  }

  /** Appends and activates one immutable Ingredient version. */
  public addIngredientVersion(
    id: string,
    input: CreateIngredientVersion
  ): Promise<Ingredient> {
    return this.store.appendIngredientVersion(
      this.personContext.getPersonId(),
      id,
      input
    );
  }

  /** Reads an accessible Ingredient or reports a uniform not-found result. */
  public async findIngredient(id: string): Promise<Ingredient> {
    const ingredient = await this.store.findIngredient(
      this.personContext.getPersonId(),
      id
    );
    if (!ingredient) {
      throw new NotFoundError("Nutrition Ingredient was not found");
    }
    return ingredient;
  }

  /** Creates a shared or Person-private Food with immutable composition. */
  public createFood(input: CreateFood): Promise<Food> {
    return this.store.createFood(this.personContext.getPersonId(), input);
  }

  /** Appends and activates one immutable Food version. */
  public addFoodVersion(
    id: string,
    input: CreateFoodVersion
  ): Promise<Food> {
    return this.store.appendFoodVersion(
      this.personContext.getPersonId(),
      id,
      input
    );
  }

  /** Reads an accessible Food or reports a uniform not-found result. */
  public async findFood(id: string): Promise<Food> {
    const food = await this.store.findFood(
      this.personContext.getPersonId(),
      id
    );
    if (!food) {
      throw new NotFoundError("Nutrition Food was not found");
    }
    return food;
  }

  /** Replaces the active Person's preferences for one accessible Food. */
  public upsertFoodOverlay(
    id: string,
    input: UpsertFoodOverlay
  ): Promise<FoodOverlay> {
    return this.store.upsertFoodOverlay(
      this.personContext.getPersonId(),
      id,
      input
    );
  }

  /** Creates one idempotent Person-owned Meal fact. */
  public createMeal(input: CreateMeal): Promise<CreateMealResult> {
    return this.store.createMeal(this.personContext.getPersonId(), input);
  }

  /** Appends an idempotent full replacement for one Meal. */
  public correctMeal(
    id: string,
    input: CorrectMeal
  ): Promise<CreateMealResult> {
    return this.store.correctMeal(
      this.personContext.getPersonId(),
      id,
      input
    );
  }

  /** Reads one Person-owned Meal or reports a uniform not-found result. */
  public async findMeal(id: string): Promise<Meal> {
    const meal = await this.store.findMeal(
      this.personContext.getPersonId(),
      id
    );
    if (!meal) {
      throw new NotFoundError("Meal was not found");
    }
    return meal;
  }

  /** Lists current Person-owned Meal facts using keyset pagination. */
  public listMeals(query: ListMealsQuery): Promise<MealList> {
    return this.store.listMeals(
      this.personContext.getPersonId(),
      query.limit ?? 50,
      query.cursor,
      query.localDate
    );
  }

  /** Reads all current meals for a single local date for a coordinating projection. */
  public listMealsForLocalDate(localDate: string): Promise<readonly Meal[]> {
    return this.store.listMealsForLocalDate(this.personContext.getPersonId(), localDate);
  }

  /** Reads the append-only correction chain containing one Meal. */
  public async mealHistory(id: string): Promise<MealHistory> {
    const history = await this.store.mealHistory(
      this.personContext.getPersonId(),
      id
    );
    if (!history) {
      throw new NotFoundError("Meal was not found");
    }
    return history;
  }

  /** Calculates daily nutrition totals from current Meal snapshots only. */
  public dailyTotals(localDate: string): Promise<DailyNutritionTotals> {
    return this.store.dailyTotals(
      this.personContext.getPersonId(),
      localDate
    );
  }
}
