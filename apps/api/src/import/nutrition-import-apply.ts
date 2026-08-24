import { createHash } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { SafeApplyImportReport } from "./contracts.js";
import type { FitnessTrackerNutritionSnapshot } from "./fitness-tracker-sheets-reader.js";
import {
  NutritionDryRunAdapter,
  type NutritionDryRunPrivateDetail,
  type NutritionImportAuditRecord,
  type NutritionImportCandidate,
  type NutritionImportTarget
} from "./nutrition-dry-run.js";
import {
  catalogSourceKey,
  mealExternalSystem,
  PostgresNutritionTargetReader,
  type NutritionSheetIds
} from "./postgres-nutrition-target-reader.js";
import {
  PostgresImportLifecycle,
  type PostgresApplyAdapter
} from "./postgres-import-lifecycle.js";

/** Atomic Nutrition apply implementation behind the shared importer lifecycle. */
export class NutritionImportApplyService {
  public constructor(
    private readonly pool: Pool,
    private readonly spreadsheetId: string,
    private readonly sheetIds: NutritionSheetIds
  ) {}

  /** Reclassifies under lock and atomically creates one linked Nutrition graph. */
  public async apply(
    personId: string,
    snapshot: FitnessTrackerNutritionSnapshot
  ): Promise<SafeApplyImportReport> {
    const targetReader = new PostgresNutritionTargetReader(
      this.pool,
      this.spreadsheetId,
      this.sheetIds
    );
    const classifier = new NutritionDryRunAdapter();
    const adapter: PostgresApplyAdapter<
      FitnessTrackerNutritionSnapshot,
      NutritionImportTarget,
      NutritionDryRunPrivateDetail
    > = {
      domain: "nutrition",
      readTarget: (client, ownerId) => targetReader.readTargetWithClient(client, ownerId),
      classify: (source, target) => classifier.classify(source, target),
      targetStateChecksum: checksumTarget,
      createFacts: (client, batchId, ownerId, source, detail) =>
        this.createFacts(client, batchId, ownerId, source, detail),
      persistAudit: (client, batchId, ownerId, detail) =>
        persistAudit(client, batchId, ownerId, detail.records)
    };
    return new PostgresImportLifecycle(this.pool).apply({
      personId,
      snapshot,
      sourceSystem: "google_sheets",
      sourceContainerId: this.spreadsheetId,
      sourceManifestChecksum: snapshot.manifestChecksum,
      adapter
    });
  }

  private async createFacts(
    client: PoolClient,
    batchId: string,
    personId: string,
    snapshot: FitnessTrackerNutritionSnapshot,
    detail: NutritionDryRunPrivateDetail
  ): Promise<NutritionDryRunPrivateDetail> {
    const created = new Map<string, string>();
    const candidates = detail.records
      .filter(({ outcome, candidate }) => outcome === "created" && candidate !== null)
      .map(({ candidate }) => candidate!);

    for (const candidate of candidates.filter(
      (item): item is Extract<NutritionImportCandidate, { kind: "brand" }> => item.kind === "brand"
    )) {
      created.set(recordKey(candidate), await createBrand(
        client, personId, this.spreadsheetId, this.sheetIds.brands, candidate
      ));
    }
    for (const candidate of candidates.filter(
      (item): item is Extract<NutritionImportCandidate, { kind: "ingredient" }> => item.kind === "ingredient"
    )) {
      created.set(recordKey(candidate), await createIngredient(
        client, personId, this.spreadsheetId, this.sheetIds.ingredients, candidate
      ));
    }
    for (const candidate of candidates.filter(
      (item): item is Extract<NutritionImportCandidate, { kind: "food" }> => item.kind === "food"
    )) {
      created.set(recordKey(candidate), await createFood(
        client, personId, this.spreadsheetId, this.sheetIds, candidate
      ));
    }
    for (const candidate of candidates.filter(
      (item): item is Extract<NutritionImportCandidate, { kind: "composition" }> => item.kind === "composition"
    )) {
      created.set(recordKey(candidate), await createComposition(
        client, personId, this.spreadsheetId, this.sheetIds, candidate
      ));
    }
    for (const candidate of candidates.filter(
      (item): item is Extract<NutritionImportCandidate, { kind: "meal" }> => item.kind === "meal"
    )) {
      created.set(recordKey(candidate), await createMeal(
        client,
        batchId,
        personId,
        snapshot.timeZone,
        this.spreadsheetId,
        this.sheetIds,
        candidate
      ));
    }
    return {
      ...detail,
      records: detail.records.map((record) => ({
        ...record,
        targetId: record.candidate
          ? created.get(recordKey(record.candidate)) ?? record.targetId
          : record.targetId
      }))
    };
  }
}

function checksumTarget(target: readonly NutritionImportTarget[]): string {
  return digest([...target]
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      identity: row.sourceIdentity,
      checksum: row.checksum
    }))
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)));
}

async function createBrand(
  client: PoolClient,
  personId: string,
  spreadsheetId: string,
  sheetId: number,
  candidate: Extract<NutritionImportCandidate, { kind: "brand" }>
): Promise<string> {
  const sourceRecordId = await catalogRecord(client, spreadsheetId, sheetId, "brand", candidate);
  const root = await client.query<{ id: string }>(
    `insert into nutrition_brands (visibility, owner_person_id)
     values ('private', $1) returning id`,
    [personId]
  );
  const version = await client.query<{ id: string }>(
    `insert into nutrition_brand_versions
       (brand_id, version, name, type, note, source_record_id)
     values ($1, 1, $2, $3, $4, $5) returning id`,
    [root.rows[0]!.id, candidate.name, candidate.type, candidate.note, sourceRecordId]
  );
  await client.query(
    "update nutrition_brands set current_version_id = $1 where id = $2",
    [version.rows[0]!.id, root.rows[0]!.id]
  );
  return root.rows[0]!.id;
}

async function createIngredient(
  client: PoolClient,
  personId: string,
  spreadsheetId: string,
  sheetId: number,
  candidate: Extract<NutritionImportCandidate, { kind: "ingredient" }>
): Promise<string> {
  const sourceRecordId = await catalogRecord(client, spreadsheetId, sheetId, "ingredient", candidate);
  const root = await client.query<{ id: string }>(
    `insert into nutrition_ingredients (visibility, owner_person_id)
     values ('private', $1) returning id`,
    [personId]
  );
  const n = candidate.nutrients;
  const version = await client.query<{ id: string }>(
    `insert into nutrition_ingredient_versions
       (ingredient_id, version, name, category, reference_quantity, reference_unit,
        calories_kcal, protein_g, fat_g, carbs_g, source_record_id)
     values ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [root.rows[0]!.id, candidate.name, candidate.category, candidate.referenceQuantity,
      candidate.referenceUnit, n.caloriesKcal, n.proteinG, n.fatG, n.carbsG, sourceRecordId]
  );
  await client.query(
    "update nutrition_ingredients set current_version_id = $1 where id = $2",
    [version.rows[0]!.id, root.rows[0]!.id]
  );
  return root.rows[0]!.id;
}

async function createFood(
  client: PoolClient,
  personId: string,
  spreadsheetId: string,
  sheetIds: NutritionSheetIds,
  candidate: Extract<NutritionImportCandidate, { kind: "food" }>
): Promise<string> {
  const sourceRecordId = await catalogRecord(client, spreadsheetId, sheetIds.foods, "food", candidate);
  const brandVersionId = candidate.brandSourceKey
    ? await catalogVersionId(client, personId, spreadsheetId, sheetIds.brands, "brand", candidate.brandSourceKey)
    : null;
  const root = await client.query<{ id: string }>(
    `insert into nutrition_foods (visibility, owner_person_id)
     values ('private', $1) returning id`,
    [personId]
  );
  const n = candidate.nutrients;
  const version = await client.query<{ id: string }>(
    `insert into nutrition_food_versions
       (food_id, version, name, type, category, reference_quantity, reference_unit,
        calories_kcal, protein_g, fat_g, carbs_g, brand_version_id, source_record_id)
     values ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
    [root.rows[0]!.id, candidate.name, candidate.type, candidate.category,
      candidate.referenceQuantity, candidate.referenceUnit, n.caloriesKcal,
      n.proteinG, n.fatG, n.carbsG, brandVersionId, sourceRecordId]
  );
  await client.query(
    "update nutrition_foods set current_version_id = $1 where id = $2",
    [version.rows[0]!.id, root.rows[0]!.id]
  );
  return root.rows[0]!.id;
}

async function createComposition(
  client: PoolClient,
  personId: string,
  spreadsheetId: string,
  sheetIds: NutritionSheetIds,
  candidate: Extract<NutritionImportCandidate, { kind: "composition" }>
): Promise<string> {
  const sourceRecordId = await catalogRecord(
    client,
    spreadsheetId,
    sheetIds.foodIngredients,
    "composition",
    candidate
  );
  const foodVersionId = await catalogVersionId(
    client, personId, spreadsheetId, sheetIds.foods, "food", candidate.foodSourceKey
  );
  const ingredientVersionId = await catalogVersionId(
    client,
    personId,
    spreadsheetId,
    sheetIds.ingredients,
    "ingredient",
    candidate.ingredientSourceKey
  );
  const position = await client.query<{ position: number }>(
    `select coalesce(max(position), 0) + 1 as position
       from nutrition_food_version_ingredients where food_version_id = $1`,
    [foodVersionId]
  );
  const inserted = await client.query<{ id: string }>(
    `insert into nutrition_food_version_ingredients
       (food_version_id, position, ingredient_version_id, quantity, unit,
        preparation, required, note, confidence, source_record_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [foodVersionId, position.rows[0]!.position, ingredientVersionId,
      candidate.quantity, candidate.unit, candidate.preparation,
      candidate.required, candidate.note, candidate.confidence, sourceRecordId]
  );
  return inserted.rows[0]!.id;
}

async function createMeal(
  client: PoolClient,
  batchId: string,
  personId: string,
  timezone: string,
  spreadsheetId: string,
  sheetIds: NutritionSheetIds,
  candidate: Extract<NutritionImportCandidate, { kind: "meal" }>
): Promise<string> {
  const source = await client.query<{ id: string }>(
    `insert into source_references
       (person_id, channel, external_system, external_record_id,
        import_batch_id, checksum, contains_sensitive_data)
     values ($1, 'google_sheets', $2, $3, $4, $5, true) returning id`,
    [personId, mealExternalSystem(spreadsheetId, sheetIds.meals),
      candidate.sourceIdentity.sourceKey, batchId, candidate.checksum]
  );
  const dedupeKey = `fitness-tracker:nutrition:meal:${digest(candidate.sourceIdentity)}`;
  const meal = await client.query<{ id: string }>(
    `insert into meals
       (person_id, occurred_at, temporal_precision, local_date, timezone, kind,
        description, note, source, source_reference_id, dedupe_key, confidence)
     values ($1, null, 'local_date', $2, $3, $4, $5, $6,
       'google_sheets', $7, $8, $9) returning id`,
    [personId, candidate.localDate, timezone, candidate.mealKind,
      candidate.description, candidate.note, source.rows[0]!.id, dedupeKey,
      candidate.confidence]
  );
  const foodVersionId = candidate.foodSourceKey
    ? await catalogVersionId(
        client, personId, spreadsheetId, sheetIds.foods, "food", candidate.foodSourceKey
      )
    : null;
  const n = candidate.nutrients;
  await client.query(
    `insert into meal_items
       (meal_id, position, food_version_id, label, quantity, unit,
        calories_kcal, protein_g, fat_g, carbs_g)
     values ($1, 1, $2, $3, 1, 'serving', $4, $5, $6, $7)`,
    [meal.rows[0]!.id, foodVersionId, candidate.label, n.caloriesKcal,
      n.proteinG, n.fatG, n.carbsG]
  );
  return meal.rows[0]!.id;
}

async function catalogRecord(
  client: PoolClient,
  spreadsheetId: string,
  sheetId: number,
  kind: Exclude<NutritionImportCandidate["kind"], "meal">,
  candidate: NutritionImportCandidate
): Promise<string> {
  const key = catalogSourceKey(spreadsheetId, sheetId, kind);
  const source = await client.query<{ id: string }>(
    `insert into nutrition_catalog_sources (key, name)
     values ($1, $2) on conflict (key) do update set name = excluded.name
     returning id`,
    [key, `Fitness Tracker ${kind}`]
  );
  const record = await client.query<{ id: string }>(
    `insert into nutrition_catalog_source_records
       (source_id, external_record_id, fetched_at, checksum, parser_version, status)
     values ($1, $2, statement_timestamp(), $3, 'fitness-tracker-nutrition-v1', 'matched')
     on conflict (source_id, external_record_id) do nothing returning id`,
    [source.rows[0]!.id, candidate.sourceIdentity.sourceKey, candidate.checksum]
  );
  if (record.rows[0]) return record.rows[0].id;
  const existing = await client.query<{ id: string; checksum: string }>(
    `select id, checksum from nutrition_catalog_source_records
      where source_id = $1 and external_record_id = $2`,
    [source.rows[0]!.id, candidate.sourceIdentity.sourceKey]
  );
  if (!existing.rows[0] || existing.rows[0].checksum !== candidate.checksum) {
    throw new Error("Nutrition catalog source identity changed during apply");
  }
  return existing.rows[0].id;
}

async function catalogVersionId(
  client: PoolClient,
  personId: string,
  spreadsheetId: string,
  sheetId: number,
  kind: "brand" | "ingredient" | "food",
  sourceKey: string
): Promise<string> {
  const config = kind === "brand"
    ? { root: "nutrition_brands", version: "nutrition_brand_versions" }
    : kind === "ingredient"
      ? { root: "nutrition_ingredients", version: "nutrition_ingredient_versions" }
      : { root: "nutrition_foods", version: "nutrition_food_versions" };
  const result = await client.query<{ id: string }>(
    `select version.id
       from ${config.root} root
       join ${config.version} version on version.id = root.current_version_id
       join nutrition_catalog_source_records record on record.id = version.source_record_id
       join nutrition_catalog_sources source on source.id = record.source_id
      where root.visibility = 'private' and root.owner_person_id = $1
        and source.key = $2 and record.external_record_id = $3`,
    [personId, catalogSourceKey(spreadsheetId, sheetId, kind), sourceKey]
  );
  if (!result.rows[0]) throw new Error(`Nutrition ${kind} reference was not resolved`);
  return result.rows[0].id;
}

async function persistAudit(
  client: PoolClient,
  batchId: string,
  personId: string,
  records: readonly NutritionImportAuditRecord[]
): Promise<void> {
  for (const record of records) {
    const base = [batchId, personId, record.sourceSheetId, record.sourceLocator,
      record.sourceRecordId, record.sourceChecksum, record.outcome,
      record.findingCode];
    const candidate = record.candidate;
    if (record.kind === "brand") {
      const value = candidate?.kind === "brand" ? candidate : null;
      await client.query(
        `insert into nutrition_brand_import_records
           (batch_id, person_id, source_sheet_id, source_locator, source_record_id,
            source_checksum, outcome, finding_code, normalized_name,
            normalized_type, normalized_note, target_brand_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (batch_id, source_locator, finding_code) do nothing`,
        [...base, value?.name ?? null, value?.type ?? null, value?.note ?? null, record.targetId]
      );
    } else if (record.kind === "ingredient") {
      const value = candidate?.kind === "ingredient" ? candidate : null;
      await client.query(
        `insert into nutrition_ingredient_import_records
           (batch_id, person_id, source_sheet_id, source_locator, source_record_id,
            source_checksum, outcome, finding_code, normalized_name,
            normalized_category, reference_quantity, reference_unit,
            calories_kcal, protein_g, fat_g, carbs_g, target_ingredient_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         on conflict (batch_id, source_locator, finding_code) do nothing`,
        [...base, value?.name ?? null, value?.category ?? null,
          value?.referenceQuantity ?? null, value?.referenceUnit ?? null,
          value?.nutrients.caloriesKcal ?? null, value?.nutrients.proteinG ?? null,
          value?.nutrients.fatG ?? null, value?.nutrients.carbsG ?? null, record.targetId]
      );
    } else if (record.kind === "food") {
      const value = candidate?.kind === "food" ? candidate : null;
      await client.query(
        `insert into nutrition_food_import_records
           (batch_id, person_id, source_sheet_id, source_locator, source_record_id,
            source_checksum, outcome, finding_code, normalized_name,
            normalized_type, normalized_category, reference_quantity,
            reference_unit, calories_kcal, protein_g, fat_g, carbs_g,
            brand_source_id, target_food_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         on conflict (batch_id, source_locator, finding_code) do nothing`,
        [...base, value?.name ?? null, value?.type ?? null, value?.category ?? null,
          value?.referenceQuantity ?? null, value?.referenceUnit ?? null,
          value?.nutrients.caloriesKcal ?? null, value?.nutrients.proteinG ?? null,
          value?.nutrients.fatG ?? null, value?.nutrients.carbsG ?? null,
          value?.brandSourceKey ?? null, record.targetId]
      );
    } else if (record.kind === "composition") {
      const value = candidate?.kind === "composition" ? candidate : null;
      await client.query(
        `insert into nutrition_composition_import_records
           (batch_id, person_id, source_sheet_id, source_locator, source_record_id,
            source_checksum, outcome, finding_code, food_source_id,
            ingredient_source_id, normalized_quantity, normalized_unit,
            normalized_preparation, normalized_required, normalized_note,
            normalized_confidence, target_composition_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         on conflict (batch_id, source_locator, finding_code) do nothing`,
        [...base, value?.foodSourceKey ?? null, value?.ingredientSourceKey ?? null,
          value?.quantity ?? null, value?.unit ?? null, value?.preparation ?? null,
          value?.required ?? null, value?.note ?? null, value?.confidence ?? null,
          record.targetId]
      );
    } else {
      const value = candidate?.kind === "meal" ? candidate : null;
      await client.query(
        `insert into nutrition_meal_import_records
           (batch_id, person_id, source_sheet_id, source_locator, source_record_id,
            source_checksum, outcome, finding_code, normalized_local_date,
            normalized_kind, normalized_label, normalized_description,
            normalized_note, calories_kcal, protein_g, fat_g, carbs_g,
            food_source_id, normalized_confidence, target_meal_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         on conflict (batch_id, source_locator, finding_code) do nothing`,
        [...base, value?.localDate ?? null, value?.mealKind ?? null,
          value?.label ?? null, value?.description ?? null, value?.note ?? null,
          value?.nutrients.caloriesKcal ?? null, value?.nutrients.proteinG ?? null,
          value?.nutrients.fatG ?? null, value?.nutrients.carbsG ?? null,
          value?.foodSourceKey ?? null, value?.confidence ?? null, record.targetId]
      );
    }
  }
}

function recordKey(candidate: NutritionImportCandidate): string {
  return `${candidate.kind}:${candidate.sourceIdentity.sourceKey}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
