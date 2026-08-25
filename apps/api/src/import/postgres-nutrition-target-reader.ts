import type { Pool, PoolClient } from "pg";

import type { ImportTargetReader } from "./contracts.js";
import type { NutritionImportTarget, NutritionImportRecordKind } from "./nutrition-dry-run.js";

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
    const meals = await client.query<TargetRow>(
        `select m.id, sr.external_record_id as source_key, sr.checksum
           from meals m
           join source_references sr on sr.id = m.source_reference_id
          where m.person_id = $1
            and m.source = 'google_sheets'
            and sr.external_system = $2`,
        [personId, mealExternalSystem(this.spreadsheetId, this.sheetIds.meals)]
      );
    const closures = await this.dayClosureRows(client, personId);
    return [
      ...mapRows("brand", brands.rows, this.spreadsheetId, this.sheetIds.brands),
      ...mapRows("ingredient", ingredients.rows, this.spreadsheetId, this.sheetIds.ingredients),
      ...mapRows("food", foods.rows, this.spreadsheetId, this.sheetIds.foods),
      ...mapRows("composition", compositions.rows, this.spreadsheetId, this.sheetIds.foodIngredients),
      ...mapRows("meal", meals.rows, this.spreadsheetId, this.sheetIds.meals),
      ...mapRows("day_closure", closures.rows, this.spreadsheetId, this.sheetIds.dailyLog)
    ];
  }

  private catalogRows(
    client: PoolClient,
    personId: string,
    kind: Exclude<NutritionImportRecordKind, "meal" | "day_closure">
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
    const query =
      `select root.id, r.external_record_id as source_key, r.checksum
           from ${config.root} root
           join ${config.version} version on version.id = root.current_version_id
           join nutrition_catalog_source_records r on r.id = version.source_record_id
           join nutrition_catalog_sources s on s.id = r.source_id
          where root.visibility = 'private' and root.owner_person_id = $1 and s.key = $2`;
    return client.query<TargetRow>(query, [
      personId,
      catalogSourceKey(this.spreadsheetId, config.source, kind)
    ]);
  }

  private async dayClosureRows(
    client: PoolClient,
    personId: string
  ): Promise<{ rows: TargetRow[] }> {
    const capability = await client.query<{ available: boolean }>(
      `select to_regclass('public.nutrition_day_closure_import_records') is not null as available`
    );
    if (!capability.rows[0]?.available) return { rows: [] };
    return client.query<TargetRow>(
      `with imported as (
         select distinct on (r.source_record_id)
           r.target_closure_id as id, r.source_record_id as source_key,
           r.source_checksum as checksum
          from nutrition_day_closure_import_records r
          join day_closures c on c.id = r.target_closure_id and c.person_id = r.person_id
         where r.person_id = $1 and r.target_closure_id is not null
         order by r.source_record_id, r.created_at desc
       )
       select * from imported
       union all
       select c.id, c.local_date::text as source_key, null::varchar as checksum
         from day_closures c
        where c.person_id = $1 and c.status = 'active'
          and not exists (select 1 from imported i where i.id = c.id)`,
      [personId]
    );
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
      `select c.id, r.external_record_id as source_key, r.checksum
         from nutrition_food_version_ingredients c
         join nutrition_food_versions v on v.id = c.food_version_id
         join nutrition_foods f on f.current_version_id = v.id
         join nutrition_catalog_source_records r on r.id = c.source_record_id
         join nutrition_catalog_sources s on s.id = r.source_id
        where f.visibility = 'private' and f.owner_person_id = $1 and s.key = $2`,
      [
        personId,
        catalogSourceKey(
          this.spreadsheetId,
          this.sheetIds.foodIngredients,
          "composition"
        )
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
    sourceIdentity: { spreadsheetId, sheetId, sourceKey: row.source_key },
    checksum: row.checksum
  }));
}
