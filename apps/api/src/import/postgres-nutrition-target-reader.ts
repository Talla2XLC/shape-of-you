import type { Pool, PoolClient } from "pg";

import type { ImportTargetReader } from "./contracts.js";
import {
  nutritionBrandSemanticChecksum,
  nutritionMealSemanticChecksum,
  type NutritionImportTarget,
  type NutritionImportRecordKind
} from "./nutrition-dry-run.js";

/** Numeric sheet identities required to reconstruct Nutrition source identities. */
export interface NutritionSheetIds {
  readonly brands: number;
  readonly ingredients: number;
  readonly foods: number;
  readonly foodIngredients: number;
  readonly meals: number;
  readonly dailyLog: number;
}

interface TargetRow {
  readonly id: string;
  readonly source_key: string;
  readonly checksum: string | null;
  readonly semantic_checksum?: string | null;
  readonly source_sheet_id?: number;
  readonly source_provenance_accepted?: boolean;
}

interface MealTargetRow extends TargetRow {
  readonly local_date: string;
  readonly kind: "breakfast" | "lunch" | "dinner" | "snack" | "other";
  readonly description: string | null;
  readonly note: string | null;
  readonly confidence: string | null;
  readonly label: string;
  readonly calories_kcal: string | null;
  readonly protein_g: string | null;
  readonly fat_g: string | null;
  readonly carbs_g: string | null;
}

/** Read-only PostgreSQL projection for Nutrition reconciliation. */
export class PostgresNutritionTargetReader
  implements ImportTargetReader<NutritionImportTarget>
{
  public constructor(
    private readonly pool: Pool,
    private readonly spreadsheetId: string,
    private readonly sheetIds: NutritionSheetIds
  ) {}

  /** Reads every imported Nutrition identity owned by one Person. */
  public readTarget(personId: string): Promise<readonly NutritionImportTarget[]> {
    return this.withClient((client) => this.readTargetWithClient(client, personId));
  }

  /** Transaction-aware target read used by the atomic apply lifecycle. */
  public async readTargetWithClient(
    client: PoolClient,
    personId: string
  ): Promise<readonly NutritionImportTarget[]> {
    const brands = await this.catalogRows(client, personId, "brand");
    const ingredients = await this.catalogRows(client, personId, "ingredient");
    const foods = await this.catalogRows(client, personId, "food");
    const compositions = await this.catalogRows(client, personId, "composition");
    const meals = await client.query<MealTargetRow>(
        `select m.id, sr.external_record_id as source_key, sr.checksum,
                m.local_date::text, m.kind, m.description, m.note, m.confidence,
                mi.label, mi.calories_kcal, mi.protein_g, mi.fat_g, mi.carbs_g
           from meals m
           join source_references sr on sr.id = m.source_reference_id
           join meal_items mi on mi.meal_id = m.id
          where m.person_id = $1
            and m.source = 'google_sheets'
            and sr.external_system = $2`,
        [personId, mealExternalSystem(this.spreadsheetId, this.sheetIds.meals)]
      );
    return [
      ...mapRows("brand", brands.rows, this.spreadsheetId, this.sheetIds.brands),
      ...mapRows("ingredient", ingredients.rows, this.spreadsheetId, this.sheetIds.ingredients),
      ...mapRows("food", foods.rows, this.spreadsheetId, this.sheetIds.foods),
      ...mapRows("composition", compositions.rows, this.spreadsheetId, this.sheetIds.foodIngredients),
      ...meals.rows.map((row) => ({
        id: row.id,
        kind: "meal" as const,
        sourceIdentity: {
          spreadsheetId: this.spreadsheetId,
          sheetId: this.sheetIds.meals,
          sourceKey: row.source_key
        },
        checksum: row.checksum,
        semanticChecksum: nutritionMealSemanticChecksum({
          localDate: row.local_date,
          mealKind: row.kind,
          label: row.label,
          description: row.description,
          note: row.note,
          nutrients: {
            caloriesKcal: numeric(row.calories_kcal),
            proteinG: numeric(row.protein_g),
            fatG: numeric(row.fat_g),
            carbsG: numeric(row.carbs_g)
          },
          confidence: numeric(row.confidence)
        })
      }))
    ];
  }

  private catalogRows(
    client: PoolClient,
    personId: string,
    kind: Exclude<NutritionImportRecordKind, "meal">
  ): Promise<{ rows: TargetRow[] }> {
    const config = kind === "brand"
      ? { root: "nutrition_brands", version: "nutrition_brand_versions", rootId: "brand_id", source: this.sheetIds.brands }
      : kind === "ingredient"
        ? { root: "nutrition_ingredients", version: "nutrition_ingredient_versions", rootId: "ingredient_id", source: this.sheetIds.ingredients }
        : kind === "food"
          ? { root: "nutrition_foods", version: "nutrition_food_versions", rootId: "food_id", source: this.sheetIds.foods }
          : { root: "nutrition_foods", version: "nutrition_food_version_ingredients", rootId: "food_version_id", source: this.sheetIds.foodIngredients };
    if (kind === "composition") {
      return this.compositionRows(client, personId);
    }
    const query = kind === "brand"
      ? `select root.id, r.external_record_id as source_key, r.checksum,
                version.name, version.type, version.note,
                split_part(s.key, ':', 3)::int as source_sheet_id
           from ${config.root} root
           join ${config.version} version on version.id = root.current_version_id
           join nutrition_catalog_source_records r on r.id = version.source_record_id
           join nutrition_catalog_sources s on s.id = r.source_id
          where root.visibility = 'private' and root.owner_person_id = $1
            and split_part(s.key, ':', 1) = 'fitness_tracker'
            and split_part(s.key, ':', 2) = $2
            and split_part(s.key, ':', 3) ~ '^[0-9]+$'
            and split_part(s.key, ':', 4) = $3`
      : `select root.id, r.external_record_id as source_key, r.checksum,
                split_part(s.key, ':', 3)::int as source_sheet_id
           from ${config.root} root
           join ${config.version} version on version.id = root.current_version_id
           join nutrition_catalog_source_records r on r.id = version.source_record_id
           join nutrition_catalog_sources s on s.id = r.source_id
          where root.visibility = 'private' and root.owner_person_id = $1
            and split_part(s.key, ':', 1) = 'fitness_tracker'
            and split_part(s.key, ':', 2) = $2
            and split_part(s.key, ':', 3) ~ '^[0-9]+$'
            and split_part(s.key, ':', 4) = $3`;
    return client.query<TargetRow & {
      readonly name?: string;
      readonly type?: string | null;
      readonly note?: string | null;
    }>(query, [
      personId,
      this.spreadsheetId,
      kind
    ]).then((result) => ({
      rows: result.rows.map((row) => kind === "brand"
        ? {
            ...row,
            semantic_checksum: nutritionBrandSemanticChecksum({
              name: row.name!,
              type: row.type ?? null,
              note: row.note ?? null
            })
          }
        : row)
    }));
  }

  private async compositionRows(
    client: PoolClient,
    personId: string
  ): Promise<{ rows: TargetRow[] }> {
    const capability = await client.query<{ available: boolean }>(
      `select exists (
         select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = 'nutrition_food_version_ingredients'
            and column_name = 'source_record_id'
       ) as available`
    );
    if (!capability.rows[0]?.available) return { rows: [] };
    return client.query<TargetRow>(
      `select c.id, r.external_record_id as source_key, r.checksum,
              split_part(s.key, ':', 3)::int as source_sheet_id
         from nutrition_food_version_ingredients c
         join nutrition_food_versions v on v.id = c.food_version_id
         join nutrition_foods f on f.current_version_id = v.id
         join nutrition_catalog_source_records r on r.id = c.source_record_id
         join nutrition_catalog_sources s on s.id = r.source_id
        where f.visibility = 'private' and f.owner_person_id = $1
          and split_part(s.key, ':', 1) = 'fitness_tracker'
          and split_part(s.key, ':', 2) = $2
          and split_part(s.key, ':', 3) ~ '^[0-9]+$'
          and split_part(s.key, ':', 4) = 'composition'`,
      [
        personId,
        this.spreadsheetId
      ]
    );
  }

  private async withClient<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await work(client);
    } finally {
      client.release();
    }
  }
}

/** Stable catalog-source key used by target reads and apply writes. */
export function catalogSourceKey(
  spreadsheetId: string,
  sheetId: number,
  kind: string
): string {
  return `fitness_tracker:${spreadsheetId}:${sheetId}:${kind}`;
}

/** Exact source-reference system for imported Meals. */
export function mealExternalSystem(spreadsheetId: string, sheetId: number): string {
  return `google_sheets:${spreadsheetId}:${sheetId}`;
}

function mapRows(
  kind: NutritionImportRecordKind,
  rows: readonly TargetRow[],
  spreadsheetId: string,
  sheetId: number
): NutritionImportTarget[] {
  return rows.map((row) => ({
    id: row.id,
    kind,
    sourceIdentity: {
      spreadsheetId,
      sheetId: row.source_sheet_id ?? sheetId,
      sourceKey: row.source_key
    },
    checksum: row.checksum,
    semanticChecksum: row.semantic_checksum ?? null
  }));
}

function numeric(value: string | null): number | null {
  return value === null ? null : Number(value);
}
