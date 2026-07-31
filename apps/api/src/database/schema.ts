import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn
} from "drizzle-orm/pg-core";

export const personKind = pgEnum("person_kind", ["real", "synthetic"]);
export const personStatus = pgEnum("person_status", ["active", "archived"]);
export const userStatus = pgEnum("user_status", ["active", "disabled"]);
export const personAccessRole = pgEnum("person_access_role", [
  "owner",
  "editor",
  "viewer",
  "coach"
]);
export const personAccessGrantStatus = pgEnum(
  "person_access_grant_status",
  ["active", "revoked"]
);
export const sourceChannel = pgEnum("source_channel", [
  "manual",
  "google_sheets",
  "import"
]);
export const bodyMeasurementMetric = pgEnum("body_measurement_metric", [
  "waist",
  "chest",
  "hips",
  "thigh",
  "biceps"
]);
export const bodyMeasurementUnit = pgEnum("body_measurement_unit", ["cm"]);
export const physicalGoalStatus = pgEnum("physical_goal_status", [
  "draft",
  "active",
  "completed",
  "cancelled"
]);
export const physicalGoalMetric = pgEnum("physical_goal_metric", [
  "weight",
  "body_fat_percentage",
  "lean_mass",
  "waist",
  "chest",
  "hips",
  "thigh",
  "biceps"
]);
export const physicalGoalMode = pgEnum("physical_goal_mode", [
  "directional",
  "exact",
  "range",
  "dynamic"
]);
export const physicalGoalDirection = pgEnum("physical_goal_direction", [
  "decrease",
  "maintain",
  "increase"
]);
export const physicalGoalUnit = pgEnum("physical_goal_unit", [
  "kg",
  "percent",
  "cm"
]);
export const catalogVisibility = pgEnum("catalog_visibility", [
  "shared",
  "private"
]);
export const nutritionUnit = pgEnum("nutrition_unit", [
  "g",
  "ml",
  "serving",
  "piece"
]);
export const catalogSourceRecordStatus = pgEnum(
  "catalog_source_record_status",
  ["staged", "matched", "rejected"]
);
export const mealKind = pgEnum("meal_kind", [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "other"
]);
export const trainingLoadBasis = pgEnum("training_load_basis", [
  "external_weight",
  "body_weight",
  "assisted"
]);

function physicalGoalVersionOwnershipColumns(): [
  AnyPgColumn,
  AnyPgColumn,
  AnyPgColumn
] {
  return [
    physicalGoalVersions.id,
    physicalGoalVersions.goalId,
    physicalGoalVersions.personId
  ];
}

function nutritionBrandVersionOwnershipColumns(): [
  AnyPgColumn,
  AnyPgColumn
] {
  return [nutritionBrandVersions.id, nutritionBrandVersions.brandId];
}

function nutritionIngredientVersionOwnershipColumns(): [
  AnyPgColumn,
  AnyPgColumn
] {
  return [
    nutritionIngredientVersions.id,
    nutritionIngredientVersions.ingredientId
  ];
}

function nutritionFoodVersionOwnershipColumns(): [
  AnyPgColumn,
  AnyPgColumn
] {
  return [nutritionFoodVersions.id, nutritionFoodVersions.foodId];
}

function trainingExerciseVersionOwnershipColumns(): [
  AnyPgColumn,
  AnyPgColumn
] {
  return [trainingExerciseVersions.id, trainingExerciseVersions.exerciseId];
}

function trainingProgramVersionOwnershipColumns(): [
  AnyPgColumn,
  AnyPgColumn,
  AnyPgColumn
] {
  return [
    trainingProgramVersions.id,
    trainingProgramVersions.programId,
    trainingProgramVersions.personId
  ];
}

export const persons = pgTable("persons", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: personKind("kind").default("real").notNull(),
  status: personStatus("status").default("active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull()
});

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  status: userStatus("status").default("active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull()
});

export const personAccessGrants = pgTable(
  "person_access_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: personAccessRole("role").notNull(),
    status: personAccessGrantStatus("status").default("active").notNull(),
    grantedAt: timestamp("granted_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      mode: "date"
    })
  },
  (table) => [
    uniqueIndex("person_access_grants_active_role_uq")
      .on(table.personId, table.userId, table.role)
      .where(sql`${table.status} = 'active'`),
    check(
      "person_access_grants_revocation_state",
      sql`(${table.status} = 'active' AND ${table.revokedAt} IS NULL) OR (${table.status} = 'revoked' AND ${table.revokedAt} IS NOT NULL)`
    )
  ]
);

export const sourceReferences = pgTable(
  "source_references",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    channel: sourceChannel("channel").notNull(),
    externalSystem: varchar("external_system", { length: 128 }),
    externalRecordId: varchar("external_record_id", { length: 512 }),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date"
    }),
    importBatchId: uuid("import_batch_id"),
    checksum: varchar("checksum", { length: 128 }),
    rawSnapshot: jsonb("raw_snapshot").$type<unknown>(),
    containsSensitiveData: boolean("contains_sensitive_data")
      .default(false)
      .notNull(),
    ingestedAt: timestamp("ingested_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    unique("source_references_id_person_uq").on(table.id, table.personId),
    check(
      "source_references_external_pair",
      sql`(${table.externalSystem} IS NULL) = (${table.externalRecordId} IS NULL)`
    )
  ]
);

export const weightMeasurements = pgTable(
  "weight_measurements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    measuredAt: timestamp("measured_at", {
      withTimezone: true,
      mode: "date"
    }).notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    weightKg: numeric("weight_kg", { precision: 6, scale: 3 }).notNull(),
    source: sourceChannel("source").notNull(),
    sourceReferenceId: uuid("source_reference_id").notNull(),
    dedupeKey: varchar("dedupe_key", { length: 256 }).notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    supersedesId: uuid("supersedes_id"),
    correctionReason: varchar("correction_reason", { length: 512 }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    unique("weight_measurements_id_person_uq").on(table.id, table.personId),
    foreignKey({
      name: "weight_measurements_supersedes_same_person_fk",
      columns: [table.supersedesId, table.personId],
      foreignColumns: [table.id, table.personId]
    }),
    foreignKey({
      name: "weight_measurements_source_reference_same_person_fk",
      columns: [table.sourceReferenceId, table.personId],
      foreignColumns: [sourceReferences.id, sourceReferences.personId]
    }),
    uniqueIndex("weight_measurements_person_source_dedupe_uq").on(
      table.personId,
      table.source,
      table.dedupeKey
    ),
    uniqueIndex("weight_measurements_supersedes_uq")
      .on(table.supersedesId)
      .where(sql`${table.supersedesId} IS NOT NULL`),
    check(
      "weight_measurements_weight_kg_range",
      sql`${table.weightKg} >= 0.500 AND ${table.weightKg} <= 700.000`
    ),
    check(
      "weight_measurements_confidence_range",
      sql`${table.confidence} IS NULL OR (${table.confidence} >= 0 AND ${table.confidence} <= 1)`
    ),
    check(
      "weight_measurements_correction_shape",
      sql`(${table.supersedesId} IS NULL AND ${table.correctionReason} IS NULL) OR (${table.supersedesId} IS NOT NULL AND ${table.correctionReason} IS NOT NULL)`
    ),
    check(
      "weight_measurements_no_self_supersession",
      sql`${table.supersedesId} IS NULL OR ${table.supersedesId} <> ${table.id}`
    )
  ]
);

export const bodyMeasurementSessions = pgTable(
  "body_measurement_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    measuredAt: timestamp("measured_at", {
      withTimezone: true,
      mode: "date"
    }).notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    source: sourceChannel("source").notNull(),
    sourceReferenceId: uuid("source_reference_id").notNull(),
    dedupeKey: varchar("dedupe_key", { length: 256 }).notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    photoMediaId: uuid("photo_media_id"),
    note: text("note"),
    supersedesId: uuid("supersedes_id"),
    correctionReason: varchar("correction_reason", { length: 512 }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    unique("body_measurement_sessions_id_person_uq").on(
      table.id,
      table.personId
    ),
    foreignKey({
      name: "body_measurement_sessions_supersedes_same_person_fk",
      columns: [table.supersedesId, table.personId],
      foreignColumns: [table.id, table.personId]
    }),
    foreignKey({
      name: "body_measurement_sessions_source_reference_same_person_fk",
      columns: [table.sourceReferenceId, table.personId],
      foreignColumns: [sourceReferences.id, sourceReferences.personId]
    }),
    uniqueIndex("body_measurement_sessions_person_source_dedupe_uq").on(
      table.personId,
      table.source,
      table.dedupeKey
    ),
    uniqueIndex("body_measurement_sessions_supersedes_uq")
      .on(table.supersedesId)
      .where(sql`${table.supersedesId} IS NOT NULL`),
    check(
      "body_measurement_sessions_confidence_range",
      sql`${table.confidence} IS NULL OR (${table.confidence} >= 0 AND ${table.confidence} <= 1)`
    ),
    check(
      "body_measurement_sessions_correction_shape",
      sql`(${table.supersedesId} IS NULL AND ${table.correctionReason} IS NULL) OR (${table.supersedesId} IS NOT NULL AND ${table.correctionReason} IS NOT NULL)`
    ),
    check(
      "body_measurement_sessions_no_self_supersession",
      sql`${table.supersedesId} IS NULL OR ${table.supersedesId} <> ${table.id}`
    )
  ]
);

export const bodyMeasurementValues = pgTable(
  "body_measurement_values",
  {
    sessionId: uuid("session_id").notNull(),
    metric: bodyMeasurementMetric("metric").notNull(),
    value: numeric("value", { precision: 6, scale: 2 }).notNull(),
    unit: bodyMeasurementUnit("unit").default("cm").notNull()
  },
  (table) => [
    foreignKey({
      name: "body_values_session_fk",
      columns: [table.sessionId],
      foreignColumns: [bodyMeasurementSessions.id]
    }).onDelete("cascade"),
    unique("body_measurement_values_session_metric_uq").on(
      table.sessionId,
      table.metric
    ),
    check(
      "body_measurement_values_range",
      sql`${table.value} >= 1.00 AND ${table.value} <= 500.00`
    )
  ]
);

export const physicalGoals = pgTable(
  "physical_goals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    status: physicalGoalStatus("status").default("draft").notNull(),
    currentVersionId: uuid("current_version_id"),
    source: sourceChannel("source").notNull(),
    dedupeKey: varchar("dedupe_key", { length: 256 }).notNull(),
    lockVersion: integer("lock_version").default(0).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull(),
    activatedAt: timestamp("activated_at", {
      withTimezone: true,
      mode: "date"
    }),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date"
    }),
    cancelledAt: timestamp("cancelled_at", {
      withTimezone: true,
      mode: "date"
    })
  },
  (table) => [
    unique("physical_goals_id_person_uq").on(table.id, table.personId),
    foreignKey({
      name: "physical_goals_current_version_same_goal_person_fk",
      columns: [table.currentVersionId, table.id, table.personId],
      foreignColumns: physicalGoalVersionOwnershipColumns()
    }),
    uniqueIndex("physical_goals_person_source_dedupe_uq").on(
      table.personId,
      table.source,
      table.dedupeKey
    ),
    check(
      "physical_goals_lifecycle_timestamps",
      sql`(${table.status} = 'draft' AND ${table.activatedAt} IS NULL AND ${table.completedAt} IS NULL AND ${table.cancelledAt} IS NULL)
          OR (${table.status} = 'active' AND ${table.activatedAt} IS NOT NULL AND ${table.completedAt} IS NULL AND ${table.cancelledAt} IS NULL)
          OR (${table.status} = 'completed' AND ${table.completedAt} IS NOT NULL AND ${table.cancelledAt} IS NULL)
          OR (${table.status} = 'cancelled' AND ${table.cancelledAt} IS NOT NULL AND ${table.completedAt} IS NULL)`
    )
  ]
);

export const physicalGoalVersions = pgTable(
  "physical_goal_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    goalId: uuid("goal_id").notNull(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    version: integer("version").notNull(),
    intent: text("intent").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }),
    targetDate: date("target_date", { mode: "string" }),
    source: sourceChannel("source").notNull(),
    sourceReferenceId: uuid("source_reference_id").notNull(),
    dedupeKey: varchar("dedupe_key", { length: 256 }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    unique("physical_goal_versions_id_goal_person_uq").on(
      table.id,
      table.goalId,
      table.personId
    ),
    unique("physical_goal_versions_goal_version_uq").on(
      table.goalId,
      table.version
    ),
    uniqueIndex("physical_goal_versions_goal_source_dedupe_uq").on(
      table.goalId,
      table.source,
      table.dedupeKey
    ),
    foreignKey({
      name: "physical_goal_versions_same_goal_person_fk",
      columns: [table.goalId, table.personId],
      foreignColumns: [physicalGoals.id, physicalGoals.personId]
    }).onDelete("cascade"),
    foreignKey({
      name: "physical_goal_versions_source_reference_same_person_fk",
      columns: [table.sourceReferenceId, table.personId],
      foreignColumns: [sourceReferences.id, sourceReferences.personId]
    }),
    check(
      "physical_goal_versions_dates",
      sql`${table.targetDate} IS NULL OR ${table.effectiveFrom} IS NULL OR ${table.targetDate} >= ${table.effectiveFrom}`
    ),
    check(
      "physical_goal_versions_version_positive",
      sql`${table.version} > 0`
    )
  ]
);

export const physicalGoalCriteria = pgTable(
  "physical_goal_criteria",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    goalVersionId: uuid("goal_version_id").notNull(),
    position: smallint("position").notNull(),
    metric: physicalGoalMetric("metric").notNull(),
    mode: physicalGoalMode("mode").notNull(),
    direction: physicalGoalDirection("direction"),
    targetValue: numeric("target_value", { precision: 9, scale: 3 }),
    minimumValue: numeric("minimum_value", { precision: 9, scale: 3 }),
    maximumValue: numeric("maximum_value", { precision: 9, scale: 3 }),
    unit: physicalGoalUnit("unit").notNull()
  },
  (table) => [
    foreignKey({
      name: "goal_criteria_version_fk",
      columns: [table.goalVersionId],
      foreignColumns: [physicalGoalVersions.id]
    }).onDelete("cascade"),
    unique("physical_goal_criteria_version_position_uq").on(
      table.goalVersionId,
      table.position
    ),
    check(
      "physical_goal_criteria_position_positive",
      sql`${table.position} > 0`
    ),
    check(
      "physical_goal_criteria_metric_unit",
      sql`(${table.metric} IN ('weight', 'lean_mass') AND ${table.unit} = 'kg')
          OR (${table.metric} = 'body_fat_percentage' AND ${table.unit} = 'percent')
          OR (${table.metric} IN ('waist', 'chest', 'hips', 'thigh', 'biceps') AND ${table.unit} = 'cm')`
    ),
    check(
      "physical_goal_criteria_mode_shape",
      sql`(${table.mode} = 'directional' AND ${table.direction} IS NOT NULL AND ${table.targetValue} IS NULL AND ${table.minimumValue} IS NULL AND ${table.maximumValue} IS NULL)
          OR (${table.mode} = 'exact' AND ${table.direction} IS NULL AND ${table.targetValue} IS NOT NULL AND ${table.minimumValue} IS NULL AND ${table.maximumValue} IS NULL)
          OR (${table.mode} = 'range' AND ${table.direction} IS NULL AND ${table.targetValue} IS NULL AND ${table.minimumValue} IS NOT NULL AND ${table.maximumValue} IS NOT NULL AND ${table.minimumValue} <= ${table.maximumValue})
          OR (${table.mode} = 'dynamic' AND ${table.targetValue} IS NULL AND ${table.minimumValue} IS NULL AND ${table.maximumValue} IS NULL)`
    )
  ]
);

export const nutritionCatalogSources = pgTable(
  "nutrition_catalog_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: varchar("key", { length: 128 }).notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    licenseName: varchar("license_name", { length: 256 }),
    termsUrl: text("terms_url"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    unique("nutrition_catalog_sources_key_uq").on(table.key)
  ]
);

export const nutritionCatalogSourceRecords = pgTable(
  "nutrition_catalog_source_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id").notNull(),
    externalRecordId: varchar("external_record_id", {
      length: 512
    }).notNull(),
    fetchedAt: timestamp("fetched_at", {
      withTimezone: true,
      mode: "date"
    }).notNull(),
    checksum: varchar("checksum", { length: 128 }).notNull(),
    parserVersion: varchar("parser_version", { length: 128 }).notNull(),
    status: catalogSourceRecordStatus("status").default("staged").notNull(),
    rawSnapshot: jsonb("raw_snapshot").$type<unknown>(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "nutrition_source_record_source_fk",
      columns: [table.sourceId],
      foreignColumns: [nutritionCatalogSources.id]
    }),
    unique("nutrition_source_records_source_external_uq").on(
      table.sourceId,
      table.externalRecordId
    )
  ]
);

export const nutritionBrands = pgTable(
  "nutrition_brands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    visibility: catalogVisibility("visibility").notNull(),
    ownerPersonId: uuid("owner_person_id"),
    currentVersionId: uuid("current_version_id"),
    lockVersion: integer("lock_version").default(0).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "nutrition_brand_owner_fk",
      columns: [table.ownerPersonId],
      foreignColumns: [persons.id]
    }),
    foreignKey({
      name: "nutrition_brand_current_version_fk",
      columns: [table.currentVersionId, table.id],
      foreignColumns: nutritionBrandVersionOwnershipColumns()
    }),
    check(
      "nutrition_brands_visibility_owner",
      sql`(${table.visibility} = 'shared' AND ${table.ownerPersonId} IS NULL)
          OR (${table.visibility} = 'private' AND ${table.ownerPersonId} IS NOT NULL)`
    )
  ]
);

export const nutritionBrandVersions = pgTable(
  "nutrition_brand_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brandId: uuid("brand_id").notNull(),
    version: integer("version").notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    type: varchar("type", { length: 256 }),
    note: text("note"),
    sourceRecordId: uuid("source_record_id"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "nutrition_brand_version_brand_fk",
      columns: [table.brandId],
      foreignColumns: [nutritionBrands.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "nutrition_brand_version_source_fk",
      columns: [table.sourceRecordId],
      foreignColumns: [nutritionCatalogSourceRecords.id]
    }),
    unique("nutrition_brand_versions_brand_version_uq").on(
      table.brandId,
      table.version
    ),
    unique("nutrition_brand_versions_id_brand_uq").on(
      table.id,
      table.brandId
    ),
    check(
      "nutrition_brand_versions_version_positive",
      sql`${table.version} > 0`
    )
  ]
);

export const nutritionIngredients = pgTable(
  "nutrition_ingredients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    visibility: catalogVisibility("visibility").notNull(),
    ownerPersonId: uuid("owner_person_id"),
    currentVersionId: uuid("current_version_id"),
    lockVersion: integer("lock_version").default(0).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "nutrition_ingredient_owner_fk",
      columns: [table.ownerPersonId],
      foreignColumns: [persons.id]
    }),
    foreignKey({
      name: "nutrition_ingredient_current_version_fk",
      columns: [table.currentVersionId, table.id],
      foreignColumns: nutritionIngredientVersionOwnershipColumns()
    }),
    check(
      "nutrition_ingredients_visibility_owner",
      sql`(${table.visibility} = 'shared' AND ${table.ownerPersonId} IS NULL)
          OR (${table.visibility} = 'private' AND ${table.ownerPersonId} IS NOT NULL)`
    )
  ]
);

export const nutritionIngredientVersions = pgTable(
  "nutrition_ingredient_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ingredientId: uuid("ingredient_id").notNull(),
    version: integer("version").notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    category: varchar("category", { length: 256 }),
    referenceQuantity: numeric("reference_quantity", {
      precision: 12,
      scale: 3
    }).notNull(),
    referenceUnit: nutritionUnit("reference_unit").notNull(),
    caloriesKcal: numeric("calories_kcal", {
      precision: 12,
      scale: 3
    }).notNull(),
    proteinG: numeric("protein_g", { precision: 12, scale: 3 }).notNull(),
    fatG: numeric("fat_g", { precision: 12, scale: 3 }).notNull(),
    carbsG: numeric("carbs_g", { precision: 12, scale: 3 }).notNull(),
    sourceRecordId: uuid("source_record_id"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "nutrition_ingredient_version_item_fk",
      columns: [table.ingredientId],
      foreignColumns: [nutritionIngredients.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "nutrition_ingredient_version_source_fk",
      columns: [table.sourceRecordId],
      foreignColumns: [nutritionCatalogSourceRecords.id]
    }),
    unique("nutrition_ingredient_versions_item_version_uq").on(
      table.ingredientId,
      table.version
    ),
    unique("nutrition_ingredient_versions_id_item_uq").on(
      table.id,
      table.ingredientId
    ),
    check(
      "nutrition_ingredient_versions_positive_values",
      sql`${table.version} > 0
          AND ${table.referenceQuantity} > 0
          AND ${table.caloriesKcal} >= 0
          AND ${table.proteinG} >= 0
          AND ${table.fatG} >= 0
          AND ${table.carbsG} >= 0`
    )
  ]
);

export const nutritionFoods = pgTable(
  "nutrition_foods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    visibility: catalogVisibility("visibility").notNull(),
    ownerPersonId: uuid("owner_person_id"),
    currentVersionId: uuid("current_version_id"),
    lockVersion: integer("lock_version").default(0).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "nutrition_food_owner_fk",
      columns: [table.ownerPersonId],
      foreignColumns: [persons.id]
    }),
    foreignKey({
      name: "nutrition_food_current_version_fk",
      columns: [table.currentVersionId, table.id],
      foreignColumns: nutritionFoodVersionOwnershipColumns()
    }),
    check(
      "nutrition_foods_visibility_owner",
      sql`(${table.visibility} = 'shared' AND ${table.ownerPersonId} IS NULL)
          OR (${table.visibility} = 'private' AND ${table.ownerPersonId} IS NOT NULL)`
    )
  ]
);

export const nutritionFoodVersions = pgTable(
  "nutrition_food_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    foodId: uuid("food_id").notNull(),
    version: integer("version").notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    type: varchar("type", { length: 256 }),
    category: varchar("category", { length: 256 }),
    referenceQuantity: numeric("reference_quantity", {
      precision: 12,
      scale: 3
    }).notNull(),
    referenceUnit: nutritionUnit("reference_unit").notNull(),
    caloriesKcal: numeric("calories_kcal", {
      precision: 12,
      scale: 3
    }).notNull(),
    proteinG: numeric("protein_g", { precision: 12, scale: 3 }).notNull(),
    fatG: numeric("fat_g", { precision: 12, scale: 3 }).notNull(),
    carbsG: numeric("carbs_g", { precision: 12, scale: 3 }).notNull(),
    brandVersionId: uuid("brand_version_id"),
    sourceRecordId: uuid("source_record_id"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "nutrition_food_version_food_fk",
      columns: [table.foodId],
      foreignColumns: [nutritionFoods.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "nutrition_food_version_brand_fk",
      columns: [table.brandVersionId],
      foreignColumns: [nutritionBrandVersions.id]
    }),
    foreignKey({
      name: "nutrition_food_version_source_fk",
      columns: [table.sourceRecordId],
      foreignColumns: [nutritionCatalogSourceRecords.id]
    }),
    unique("nutrition_food_versions_food_version_uq").on(
      table.foodId,
      table.version
    ),
    unique("nutrition_food_versions_id_food_uq").on(
      table.id,
      table.foodId
    ),
    check(
      "nutrition_food_versions_positive_values",
      sql`${table.version} > 0
          AND ${table.referenceQuantity} > 0
          AND ${table.caloriesKcal} >= 0
          AND ${table.proteinG} >= 0
          AND ${table.fatG} >= 0
          AND ${table.carbsG} >= 0`
    )
  ]
);

export const nutritionFoodVersionIngredients = pgTable(
  "nutrition_food_version_ingredients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    foodVersionId: uuid("food_version_id").notNull(),
    position: smallint("position").notNull(),
    ingredientVersionId: uuid("ingredient_version_id").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unit: nutritionUnit("unit").notNull(),
    preparation: varchar("preparation", { length: 256 }),
    required: boolean("required").default(true).notNull(),
    note: text("note"),
    confidence: numeric("confidence", { precision: 4, scale: 3 })
  },
  (table) => [
    foreignKey({
      name: "nutrition_food_composition_food_fk",
      columns: [table.foodVersionId],
      foreignColumns: [nutritionFoodVersions.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "nutrition_food_composition_ingredient_fk",
      columns: [table.ingredientVersionId],
      foreignColumns: [nutritionIngredientVersions.id]
    }),
    unique("nutrition_food_composition_position_uq").on(
      table.foodVersionId,
      table.position
    ),
    unique("nutrition_food_composition_ingredient_uq").on(
      table.foodVersionId,
      table.ingredientVersionId
    ),
    check(
      "nutrition_food_composition_values",
      sql`${table.position} > 0
          AND ${table.quantity} > 0
          AND (${table.confidence} IS NULL
               OR (${table.confidence} >= 0 AND ${table.confidence} <= 1))`
    )
  ]
);

export const nutritionFoodOverlays = pgTable(
  "nutrition_food_overlays",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id").notNull(),
    foodId: uuid("food_id").notNull(),
    alias: varchar("alias", { length: 256 }),
    favorite: boolean("favorite").default(false).notNull(),
    hidden: boolean("hidden").default(false).notNull(),
    preferredQuantity: numeric("preferred_quantity", {
      precision: 12,
      scale: 3
    }),
    preferredUnit: nutritionUnit("preferred_unit"),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "nutrition_food_overlay_person_fk",
      columns: [table.personId],
      foreignColumns: [persons.id]
    }),
    foreignKey({
      name: "nutrition_food_overlay_food_fk",
      columns: [table.foodId],
      foreignColumns: [nutritionFoods.id]
    }),
    unique("nutrition_food_overlays_person_food_uq").on(
      table.personId,
      table.foodId
    ),
    check(
      "nutrition_food_overlays_preferred_shape",
      sql`(${table.preferredQuantity} IS NULL AND ${table.preferredUnit} IS NULL)
          OR (${table.preferredQuantity} > 0 AND ${table.preferredUnit} IS NOT NULL)`
    )
  ]
);

export const meals = pgTable(
  "meals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date"
    }).notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    kind: mealKind("kind").notNull(),
    description: text("description"),
    note: text("note"),
    photoMediaId: uuid("photo_media_id"),
    source: sourceChannel("source").notNull(),
    sourceReferenceId: uuid("source_reference_id").notNull(),
    dedupeKey: varchar("dedupe_key", { length: 256 }).notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    supersedesId: uuid("supersedes_id"),
    correctionReason: varchar("correction_reason", { length: 512 }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    unique("meals_id_person_uq").on(table.id, table.personId),
    foreignKey({
      name: "meals_supersedes_same_person_fk",
      columns: [table.supersedesId, table.personId],
      foreignColumns: [table.id, table.personId]
    }),
    foreignKey({
      name: "meals_source_reference_same_person_fk",
      columns: [table.sourceReferenceId, table.personId],
      foreignColumns: [sourceReferences.id, sourceReferences.personId]
    }),
    uniqueIndex("meals_person_source_dedupe_uq").on(
      table.personId,
      table.source,
      table.dedupeKey
    ),
    uniqueIndex("meals_supersedes_uq")
      .on(table.supersedesId)
      .where(sql`${table.supersedesId} IS NOT NULL`),
    check(
      "meals_confidence_range",
      sql`${table.confidence} IS NULL
          OR (${table.confidence} >= 0 AND ${table.confidence} <= 1)`
    ),
    check(
      "meals_correction_shape",
      sql`(${table.supersedesId} IS NULL AND ${table.correctionReason} IS NULL)
          OR (${table.supersedesId} IS NOT NULL AND ${table.correctionReason} IS NOT NULL)`
    ),
    check(
      "meals_no_self_supersession",
      sql`${table.supersedesId} IS NULL OR ${table.supersedesId} <> ${table.id}`
    )
  ]
);

export const mealItems = pgTable(
  "meal_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    mealId: uuid("meal_id").notNull(),
    position: smallint("position").notNull(),
    foodVersionId: uuid("food_version_id"),
    label: varchar("label", { length: 256 }).notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unit: nutritionUnit("unit").notNull(),
    caloriesKcal: numeric("calories_kcal", {
      precision: 12,
      scale: 3
    }).notNull(),
    proteinG: numeric("protein_g", { precision: 12, scale: 3 }).notNull(),
    fatG: numeric("fat_g", { precision: 12, scale: 3 }).notNull(),
    carbsG: numeric("carbs_g", { precision: 12, scale: 3 }).notNull()
  },
  (table) => [
    foreignKey({
      name: "meal_item_meal_fk",
      columns: [table.mealId],
      foreignColumns: [meals.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "meal_item_food_version_fk",
      columns: [table.foodVersionId],
      foreignColumns: [nutritionFoodVersions.id]
    }),
    unique("meal_items_meal_position_uq").on(
      table.mealId,
      table.position
    ),
    check(
      "meal_items_positive_values",
      sql`${table.position} > 0
          AND ${table.quantity} > 0
          AND ${table.caloriesKcal} >= 0
          AND ${table.proteinG} >= 0
          AND ${table.fatG} >= 0
          AND ${table.carbsG} >= 0`
    )
  ]
);

export const trainingExerciseCatalogSources = pgTable(
  "training_exercise_catalog_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: varchar("key", { length: 128 }).notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    licenseName: varchar("license_name", { length: 256 }),
    termsUrl: text("terms_url"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [unique("training_exercise_sources_key_uq").on(table.key)]
);

export const trainingExerciseCatalogSourceRecords = pgTable(
  "training_exercise_catalog_source_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id").notNull(),
    externalRecordId: varchar("external_record_id", {
      length: 512
    }).notNull(),
    fetchedAt: timestamp("fetched_at", {
      withTimezone: true,
      mode: "date"
    }).notNull(),
    checksum: varchar("checksum", { length: 128 }).notNull(),
    parserVersion: varchar("parser_version", { length: 128 }).notNull(),
    status: catalogSourceRecordStatus("status").default("staged").notNull(),
    rawSnapshot: jsonb("raw_snapshot").$type<unknown>(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "training_exercise_source_record_source_fk",
      columns: [table.sourceId],
      foreignColumns: [trainingExerciseCatalogSources.id]
    }),
    unique("training_exercise_source_records_external_uq").on(
      table.sourceId,
      table.externalRecordId
    )
  ]
);

export const trainingExercises = pgTable(
  "training_exercises",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    visibility: catalogVisibility("visibility").notNull(),
    ownerPersonId: uuid("owner_person_id"),
    currentVersionId: uuid("current_version_id"),
    lockVersion: integer("lock_version").default(0).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "training_exercise_owner_fk",
      columns: [table.ownerPersonId],
      foreignColumns: [persons.id]
    }),
    foreignKey({
      name: "training_exercise_current_version_fk",
      columns: [table.currentVersionId, table.id],
      foreignColumns: trainingExerciseVersionOwnershipColumns()
    }),
    check(
      "training_exercises_visibility_owner",
      sql`(${table.visibility} = 'shared' AND ${table.ownerPersonId} IS NULL)
          OR (${table.visibility} = 'private' AND ${table.ownerPersonId} IS NOT NULL)`
    )
  ]
);

export const trainingExerciseVersions = pgTable(
  "training_exercise_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    exerciseId: uuid("exercise_id").notNull(),
    version: integer("version").notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    category: varchar("category", { length: 256 }),
    movementPattern: varchar("movement_pattern", { length: 256 }),
    equipment: varchar("equipment", { length: 256 }),
    instructions: text("instructions"),
    note: text("note"),
    sourceRecordId: uuid("source_record_id"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "training_exercise_version_exercise_fk",
      columns: [table.exerciseId],
      foreignColumns: [trainingExercises.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "training_exercise_version_source_fk",
      columns: [table.sourceRecordId],
      foreignColumns: [trainingExerciseCatalogSourceRecords.id]
    }),
    unique("training_exercise_versions_exercise_version_uq").on(
      table.exerciseId,
      table.version
    ),
    unique("training_exercise_versions_id_exercise_uq").on(
      table.id,
      table.exerciseId
    ),
    check(
      "training_exercise_versions_version_positive",
      sql`${table.version} > 0`
    )
  ]
);

export const trainingExerciseOverlays = pgTable(
  "training_exercise_overlays",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id").notNull(),
    exerciseId: uuid("exercise_id").notNull(),
    alias: varchar("alias", { length: 256 }),
    available: boolean("available").default(true).notNull(),
    note: text("note"),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "training_exercise_overlay_person_fk",
      columns: [table.personId],
      foreignColumns: [persons.id]
    }),
    foreignKey({
      name: "training_exercise_overlay_exercise_fk",
      columns: [table.exerciseId],
      foreignColumns: [trainingExercises.id]
    }),
    unique("training_exercise_overlays_person_exercise_uq").on(
      table.personId,
      table.exerciseId
    )
  ]
);

export const trainingPrograms = pgTable(
  "training_programs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id").notNull(),
    currentVersionId: uuid("current_version_id"),
    activeVersionId: uuid("active_version_id"),
    lockVersion: integer("lock_version").default(0).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "training_program_person_fk",
      columns: [table.personId],
      foreignColumns: [persons.id]
    }),
    foreignKey({
      name: "training_program_current_version_fk",
      columns: [table.currentVersionId, table.id, table.personId],
      foreignColumns: trainingProgramVersionOwnershipColumns()
    }),
    foreignKey({
      name: "training_program_active_version_fk",
      columns: [table.activeVersionId, table.id, table.personId],
      foreignColumns: trainingProgramVersionOwnershipColumns()
    }),
    unique("training_programs_id_person_uq").on(table.id, table.personId),
    uniqueIndex("training_programs_person_active_uq")
      .on(table.personId)
      .where(sql`${table.activeVersionId} IS NOT NULL`)
  ]
);

export const trainingProgramVersions = pgTable(
  "training_program_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    programId: uuid("program_id").notNull(),
    personId: uuid("person_id").notNull(),
    version: integer("version").notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "training_program_version_program_fk",
      columns: [table.programId, table.personId],
      foreignColumns: [trainingPrograms.id, trainingPrograms.personId]
    }).onDelete("cascade"),
    unique("training_program_versions_program_version_uq").on(
      table.programId,
      table.version
    ),
    unique("training_program_versions_id_program_person_uq").on(
      table.id,
      table.programId,
      table.personId
    ),
    unique("training_program_versions_id_person_uq").on(
      table.id,
      table.personId
    ),
    check(
      "training_program_versions_version_positive",
      sql`${table.version} > 0`
    )
  ]
);

export const trainingProgramWorkouts = pgTable(
  "training_program_workouts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    programVersionId: uuid("program_version_id").notNull(),
    position: smallint("position").notNull(),
    name: varchar("name", { length: 256 }).notNull()
  },
  (table) => [
    foreignKey({
      name: "training_program_workout_version_fk",
      columns: [table.programVersionId],
      foreignColumns: [trainingProgramVersions.id]
    }).onDelete("cascade"),
    unique("training_program_workouts_version_position_uq").on(
      table.programVersionId,
      table.position
    ),
    check(
      "training_program_workouts_position_positive",
      sql`${table.position} > 0`
    )
  ]
);

export const trainingProgramPrescriptions = pgTable(
  "training_program_prescriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workoutId: uuid("workout_id").notNull(),
    position: smallint("position").notNull(),
    exerciseId: uuid("exercise_id").notNull(),
    exerciseVersionId: uuid("exercise_version_id").notNull(),
    loadBasis: trainingLoadBasis("load_basis").notNull(),
    targetWeightKg: numeric("target_weight_kg", {
      precision: 12,
      scale: 3
    }),
    targetSets: smallint("target_sets").notNull(),
    targetRepsMin: integer("target_reps_min").notNull(),
    targetRepsMax: integer("target_reps_max").notNull(),
    targetRir: numeric("target_rir", { precision: 4, scale: 1 }),
    progressionIncrementKg: numeric("progression_increment_kg", {
      precision: 12,
      scale: 3
    }),
    note: text("note")
  },
  (table) => [
    foreignKey({
      name: "training_program_prescription_workout_fk",
      columns: [table.workoutId],
      foreignColumns: [trainingProgramWorkouts.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "training_program_prescription_exercise_fk",
      columns: [table.exerciseVersionId, table.exerciseId],
      foreignColumns: trainingExerciseVersionOwnershipColumns()
    }),
    unique("training_program_prescriptions_workout_position_uq").on(
      table.workoutId,
      table.position
    ),
    check(
      "training_program_prescriptions_values",
      sql`${table.position} > 0
          AND (${table.targetWeightKg} IS NULL OR ${table.targetWeightKg} >= 0)
          AND ${table.targetSets} > 0
          AND ${table.targetRepsMin} > 0
          AND ${table.targetRepsMax} >= ${table.targetRepsMin}
          AND (${table.targetRir} IS NULL OR ${table.targetRir} >= 0)
          AND (${table.progressionIncrementKg} IS NULL OR ${table.progressionIncrementKg} > 0)`
    )
  ]
);

export const workoutSessions = pgTable(
  "workout_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date"
    }).notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    programVersionId: uuid("program_version_id"),
    workoutName: varchar("workout_name", { length: 256 }).notNull(),
    feeling: varchar("feeling", { length: 256 }),
    note: text("note"),
    source: sourceChannel("source").notNull(),
    sourceReferenceId: uuid("source_reference_id").notNull(),
    dedupeKey: varchar("dedupe_key", { length: 256 }).notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    supersedesId: uuid("supersedes_id"),
    correctionReason: varchar("correction_reason", { length: 512 }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "workout_session_person_fk",
      columns: [table.personId],
      foreignColumns: [persons.id]
    }),
    foreignKey({
      name: "workout_session_program_version_person_fk",
      columns: [table.programVersionId, table.personId],
      foreignColumns: [trainingProgramVersions.id, trainingProgramVersions.personId]
    }),
    foreignKey({
      name: "workout_session_source_reference_person_fk",
      columns: [table.sourceReferenceId, table.personId],
      foreignColumns: [sourceReferences.id, sourceReferences.personId]
    }),
    foreignKey({
      name: "workout_session_supersedes_person_fk",
      columns: [table.supersedesId, table.personId],
      foreignColumns: [table.id, table.personId]
    }),
    unique("workout_sessions_id_person_uq").on(table.id, table.personId),
    uniqueIndex("workout_sessions_person_source_dedupe_uq").on(
      table.personId,
      table.source,
      table.dedupeKey
    ),
    uniqueIndex("workout_sessions_supersedes_uq")
      .on(table.supersedesId)
      .where(sql`${table.supersedesId} IS NOT NULL`),
    check(
      "workout_sessions_confidence_range",
      sql`${table.confidence} IS NULL
          OR (${table.confidence} >= 0 AND ${table.confidence} <= 1)`
    ),
    check(
      "workout_sessions_correction_shape",
      sql`(${table.supersedesId} IS NULL AND ${table.correctionReason} IS NULL)
          OR (${table.supersedesId} IS NOT NULL AND ${table.correctionReason} IS NOT NULL)`
    ),
    check(
      "workout_sessions_no_self_supersession",
      sql`${table.supersedesId} IS NULL OR ${table.supersedesId} <> ${table.id}`
    )
  ]
);

export const performedExercises = pgTable(
  "performed_exercises",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id").notNull(),
    position: smallint("position").notNull(),
    exerciseId: uuid("exercise_id").notNull(),
    exerciseVersionId: uuid("exercise_version_id").notNull(),
    exerciseLabel: varchar("exercise_label", { length: 256 }).notNull(),
    loadBasis: trainingLoadBasis("load_basis").notNull(),
    feeling: varchar("feeling", { length: 256 }),
    note: text("note")
  },
  (table) => [
    foreignKey({
      name: "performed_exercise_session_fk",
      columns: [table.sessionId],
      foreignColumns: [workoutSessions.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "performed_exercise_version_fk",
      columns: [table.exerciseVersionId, table.exerciseId],
      foreignColumns: trainingExerciseVersionOwnershipColumns()
    }),
    unique("performed_exercises_session_position_uq").on(
      table.sessionId,
      table.position
    ),
    check("performed_exercises_position_positive", sql`${table.position} > 0`)
  ]
);

export const performedSets = pgTable(
  "performed_sets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    performedExerciseId: uuid("performed_exercise_id").notNull(),
    position: smallint("position").notNull(),
    weightKg: numeric("weight_kg", { precision: 12, scale: 3 }),
    reps: integer("reps").notNull(),
    rir: numeric("rir", { precision: 4, scale: 1 })
  },
  (table) => [
    foreignKey({
      name: "performed_set_exercise_fk",
      columns: [table.performedExerciseId],
      foreignColumns: [performedExercises.id]
    }).onDelete("cascade"),
    unique("performed_sets_exercise_position_uq").on(
      table.performedExerciseId,
      table.position
    ),
    check(
      "performed_sets_values",
      sql`${table.position} > 0
          AND (${table.weightKg} IS NULL OR ${table.weightKg} >= 0)
          AND ${table.reps} > 0
          AND (${table.rir} IS NULL OR ${table.rir} >= 0)`
    )
  ]
);

/** Persisted SourceReference row returned by Drizzle queries. */
export type SourceReferenceRow = typeof sourceReferences.$inferSelect;
/** Insertable SourceReference row accepted by Drizzle mutations. */
export type NewSourceReferenceRow = typeof sourceReferences.$inferInsert;
/** Persisted WeightMeasurement row returned by Drizzle queries. */
export type WeightMeasurementRow = typeof weightMeasurements.$inferSelect;
/** Insertable WeightMeasurement row accepted by Drizzle mutations. */
export type NewWeightMeasurementRow = typeof weightMeasurements.$inferInsert;
/** Persisted BodyMeasurementSession root returned by Drizzle queries. */
export type BodyMeasurementSessionRow =
  typeof bodyMeasurementSessions.$inferSelect;
/** Insertable BodyMeasurementSession root accepted by Drizzle mutations. */
export type NewBodyMeasurementSessionRow =
  typeof bodyMeasurementSessions.$inferInsert;
/** Persisted typed value owned by a BodyMeasurementSession. */
export type BodyMeasurementValueRow =
  typeof bodyMeasurementValues.$inferSelect;
/** Persisted PhysicalGoal aggregate root. */
export type PhysicalGoalRow = typeof physicalGoals.$inferSelect;
/** Persisted immutable PhysicalGoal version. */
export type PhysicalGoalVersionRow =
  typeof physicalGoalVersions.$inferSelect;
/** Persisted typed criterion owned by a PhysicalGoal version. */
export type PhysicalGoalCriterionRow =
  typeof physicalGoalCriteria.$inferSelect;
/** Persisted shared or private Nutrition Brand identity. */
export type NutritionBrandRow = typeof nutritionBrands.$inferSelect;
/** Persisted immutable Nutrition Brand version. */
export type NutritionBrandVersionRow =
  typeof nutritionBrandVersions.$inferSelect;
/** Persisted shared or private Nutrition Ingredient identity. */
export type NutritionIngredientRow =
  typeof nutritionIngredients.$inferSelect;
/** Persisted immutable Nutrition Ingredient version. */
export type NutritionIngredientVersionRow =
  typeof nutritionIngredientVersions.$inferSelect;
/** Persisted shared or private Nutrition Food identity. */
export type NutritionFoodRow = typeof nutritionFoods.$inferSelect;
/** Persisted immutable Nutrition Food version. */
export type NutritionFoodVersionRow =
  typeof nutritionFoodVersions.$inferSelect;
/** Persisted immutable Food composition row. */
export type NutritionFoodCompositionRow =
  typeof nutritionFoodVersionIngredients.$inferSelect;
/** Persisted Person-owned Food overlay. */
export type NutritionFoodOverlayRow =
  typeof nutritionFoodOverlays.$inferSelect;
/** Persisted Person-owned Meal fact. */
export type MealRow = typeof meals.$inferSelect;
/** Persisted immutable Meal snapshot item. */
export type MealItemRow = typeof mealItems.$inferSelect;
/** Persisted shared or Person-private Exercise identity. */
export type TrainingExerciseRow = typeof trainingExercises.$inferSelect;
/** Persisted immutable Exercise revision. */
export type TrainingExerciseVersionRow =
  typeof trainingExerciseVersions.$inferSelect;
/** Persisted Person-owned Exercise overlay. */
export type TrainingExerciseOverlayRow =
  typeof trainingExerciseOverlays.$inferSelect;
/** Persisted Person-owned TrainingProgram root. */
export type TrainingProgramRow = typeof trainingPrograms.$inferSelect;
/** Persisted immutable TrainingProgram version. */
export type TrainingProgramVersionRow =
  typeof trainingProgramVersions.$inferSelect;
/** Persisted ordered workout in one program version. */
export type TrainingProgramWorkoutRow =
  typeof trainingProgramWorkouts.$inferSelect;
/** Persisted exercise prescription in one program workout. */
export type TrainingProgramPrescriptionRow =
  typeof trainingProgramPrescriptions.$inferSelect;
/** Persisted immutable WorkoutSession fact. */
export type WorkoutSessionRow = typeof workoutSessions.$inferSelect;
/** Persisted immutable performed exercise snapshot. */
export type PerformedExerciseRow = typeof performedExercises.$inferSelect;
/** Persisted immutable individual performed set. */
export type PerformedSetRow = typeof performedSets.$inferSelect;
