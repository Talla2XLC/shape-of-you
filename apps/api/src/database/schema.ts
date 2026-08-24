import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
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
  "import",
  "device"
]);
export const importDomain = pgEnum("import_domain", [
  "weight",
  "body",
  "nutrition",
  "training",
  "recovery"
]);
export const importMode = pgEnum("import_mode", ["apply", "reconcile"]);
export const importBatchStatus = pgEnum("import_batch_status", [
  "completed",
  "blocked"
]);
export const importRecordOutcome = pgEnum("import_record_outcome", [
  "created",
  "unchanged",
  "conflict",
  "invalid"
]);
export const weightImportRecordRole = pgEnum("weight_import_record_role", [
  "authority",
  "mirror",
  "target"
]);
export const weightTemporalPrecision = pgEnum("weight_temporal_precision", [
  "instant",
  "local_date"
]);
export const bodyMeasurementTemporalPrecision = pgEnum(
  "body_measurement_temporal_precision",
  ["instant", "local_date"]
);
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
export const mealTemporalPrecision = pgEnum("meal_temporal_precision", [
  "instant",
  "local_date"
]);
export const trainingLoadBasis = pgEnum("training_load_basis", [
  "external_weight",
  "body_weight",
  "assisted"
]);
export const recoveryObservationKind = pgEnum("recovery_observation_kind", [
  "sleep",
  "metric",
  "subjective"
]);
export const recoveryObservationQuality = pgEnum("recovery_observation_quality", [
  "reliable",
  "estimated",
  "poor"
]);
export const recoveryMetric = pgEnum("recovery_metric", [
  "hrv_rmssd",
  "resting_heart_rate"
]);
export const recoveryMetricUnit = pgEnum("recovery_metric_unit", ["ms", "bpm"]);
export const recoveryConnectionStatus = pgEnum("recovery_connection_status", [
  "active",
  "disconnected"
]);
export const recoveryConsentStatus = pgEnum("recovery_consent_status", [
  "active",
  "revoked"
]);
export const recoveryRetentionMode = pgEnum("recovery_retention_mode", [
  "indefinite",
  "until"
]);
export const recoveryRiskLevel = pgEnum("recovery_risk_level", [
  "low",
  "moderate",
  "high",
  "blocked"
]);
export const recoveryAssessmentDataQuality = pgEnum(
  "recovery_assessment_data_quality",
  ["insufficient", "limited", "sufficient"]
);
export const coachingRecommendationKind = pgEnum(
  "coaching_recommendation_kind",
  ["training_adjustment"]
);
export const coachingTrainingAdjustmentAction = pgEnum(
  "coaching_training_adjustment_action",
  ["hold", "target_weight", "repetition_range"]
);
export const coachingTrainingAdjustmentReason = pgEnum(
  "coaching_training_adjustment_reason",
  ["hard_stop", "low_confidence", "high_risk", "moderate_risk", "maintain"]
);
export const coachingDecisionOutcome = pgEnum("coaching_decision_outcome", [
  "accepted",
  "rejected"
]);
export const dayClosureStatus = pgEnum("day_closure_status", [
  "active",
  "superseded"
]);
export const dayClosureOperation = pgEnum("day_closure_operation", [
  "close",
  "reopen"
]);
export const dayClosureReferenceKind = pgEnum("day_closure_reference_kind", [
  "weight_measurement",
  "body_measurement_session",
  "meal",
  "workout_session",
  "recovery_observation",
  "recovery_assessment",
  "coaching_recommendation"
]);
export const intakeParsingStatus = pgEnum("intake_parsing_status", [
  "queued",
  "processing",
  "parsed",
  "failed"
]);
export const intakeItemKind = pgEnum("intake_item_kind", [
  "weight_measurement"
]);
export const intakeItemStatus = pgEnum("intake_item_status", [
  "needs_clarification",
  "awaiting_confirmation",
  "queued",
  "processing",
  "completed",
  "rejected",
  "failed"
]);
export const intakeJobKind = pgEnum("intake_job_kind", [
  "parse_request",
  "parse_clarification",
  "route_item"
]);
export const intakeJobStatus = pgEnum("intake_job_status", [
  "available",
  "leased",
  "completed",
  "dead"
]);
export const intakeTimelineEvent = pgEnum("intake_timeline_event", [
  "received",
  "parsing_started",
  "items_parsed",
  "clarification_requested",
  "clarification_submitted",
  "confirmed",
  "rejected",
  "routing_started",
  "completed",
  "retry_scheduled",
  "failed"
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

/** API-owned binding from one trusted external Identity subject to one User. */
export const identitySubjectMappings = pgTable(
  "identity_subject_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    issuer: varchar("issuer", { length: 512 }).notNull(),
    subject: varchar("subject", { length: 512 }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [
    unique("id_subj_map_iss_sub_uq").on(table.issuer, table.subject),
    unique("id_subj_map_user_iss_uq").on(table.userId, table.issuer),
    check("id_subj_map_issuer_nonempty", sql`length(btrim(${table.issuer})) > 0`),
    check("id_subj_map_subject_nonempty", sql`length(btrim(${table.subject})) > 0`)
  ]
);

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

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    domain: importDomain("domain").notNull(),
    mode: importMode("mode").notNull(),
    sourceSystem: varchar("source_system", { length: 64 }).notNull(),
    sourceContainerId: varchar("source_container_id", { length: 128 }).notNull(),
    sourceManifestChecksum: varchar("source_manifest_checksum", {
      length: 64
    }).notNull(),
    targetStateChecksum: varchar("target_state_checksum", {
      length: 64
    }).notNull(),
    status: importBatchStatus("status").notNull(),
    createdCount: integer("created_count").notNull(),
    unchangedCount: integer("unchanged_count").notNull(),
    conflictCount: integer("conflict_count").notNull(),
    invalidCount: integer("invalid_count").notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date"
    }).notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date"
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    unique("import_batches_id_person_uq").on(table.id, table.personId),
    uniqueIndex("import_batches_comparison_uq").on(
      table.personId,
      table.domain,
      table.mode,
      table.sourceSystem,
      table.sourceContainerId,
      table.sourceManifestChecksum,
      table.targetStateChecksum
    ),
    check(
      "import_batches_nonnegative_counts",
      sql`${table.createdCount} >= 0 AND ${table.unchangedCount} >= 0 AND ${table.conflictCount} >= 0 AND ${table.invalidCount} >= 0`
    ),
    check(
      "import_batches_status_outcomes",
      sql`(${table.status} = 'completed' AND ${table.conflictCount} = 0 AND ${table.invalidCount} = 0) OR (${table.status} = 'blocked' AND (${table.conflictCount} > 0 OR ${table.invalidCount} > 0))`
    ),
    check(
      "import_batches_completion_order",
      sql`${table.completedAt} >= ${table.startedAt}`
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
    foreignKey({
      name: "source_references_import_batch_same_person_fk",
      columns: [table.importBatchId, table.personId],
      foreignColumns: [importBatches.id, importBatches.personId]
    }),
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
    }),
    temporalPrecision: weightTemporalPrecision("temporal_precision")
      .default("instant")
      .notNull(),
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
      "weight_measurements_temporal_shape",
      sql`(${table.temporalPrecision} = 'instant' AND ${table.measuredAt} IS NOT NULL) OR (${table.temporalPrecision} = 'local_date' AND ${table.measuredAt} IS NULL)`
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

export const weightImportRecords = pgTable(
  "weight_import_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id").notNull(),
    personId: uuid("person_id").notNull(),
    role: weightImportRecordRole("role").notNull(),
    sourceSheetId: integer("source_sheet_id"),
    sourceLocator: varchar("source_locator", { length: 128 }).notNull(),
    sourceLocalDate: date("source_local_date", { mode: "string" }),
    sourceChecksum: varchar("source_checksum", { length: 64 }),
    normalizedLocalDate: date("normalized_local_date", { mode: "string" }),
    normalizedWeightKg: numeric("normalized_weight_kg", {
      precision: 6,
      scale: 3
    }),
    outcome: importRecordOutcome("outcome").notNull(),
    findingCode: varchar("finding_code", { length: 64 }).notNull(),
    targetMeasurementId: uuid("target_measurement_id"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "weight_import_records_batch_same_person_fk",
      columns: [table.batchId, table.personId],
      foreignColumns: [importBatches.id, importBatches.personId]
    }),
    foreignKey({
      name: "weight_import_records_target_same_person_fk",
      columns: [table.targetMeasurementId, table.personId],
      foreignColumns: [weightMeasurements.id, weightMeasurements.personId]
    }),
    uniqueIndex("weight_import_records_batch_locator_code_uq").on(
      table.batchId,
      table.role,
      table.sourceLocator,
      table.findingCode
    ),
    check(
      "weight_import_records_weight_range",
      sql`${table.normalizedWeightKg} IS NULL OR (${table.normalizedWeightKg} >= 0.500 AND ${table.normalizedWeightKg} <= 700.000)`
    ),
    check(
      "weight_import_records_valid_shape",
      sql`${table.outcome} IN ('conflict', 'invalid') OR (${table.normalizedLocalDate} IS NOT NULL AND ${table.normalizedWeightKg} IS NOT NULL AND ${table.sourceChecksum} IS NOT NULL)`
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
    }),
    temporalPrecision: bodyMeasurementTemporalPrecision("temporal_precision")
      .default("instant")
      .notNull(),
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
      "body_measurement_sessions_temporal_shape",
      sql`(${table.temporalPrecision} = 'instant' AND ${table.measuredAt} IS NOT NULL) OR (${table.temporalPrecision} = 'local_date' AND ${table.measuredAt} IS NULL)`
    ),
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

export const bodyImportRecords = pgTable(
  "body_import_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id").notNull(),
    personId: uuid("person_id").notNull(),
    sourceSheetId: integer("source_sheet_id"),
    sourceLocator: varchar("source_locator", { length: 128 }).notNull(),
    sourceMeasurementId: varchar("source_measurement_id", { length: 512 }),
    sourceLocalDate: date("source_local_date", { mode: "string" }),
    sourceChecksum: varchar("source_checksum", { length: 64 }),
    normalizedLocalDate: date("normalized_local_date", { mode: "string" }),
    normalizedNote: text("normalized_note"),
    normalizedSource: varchar("normalized_source", { length: 256 }),
    outcome: importRecordOutcome("outcome").notNull(),
    findingCode: varchar("finding_code", { length: 64 }).notNull(),
    targetSessionId: uuid("target_session_id"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "body_import_records_batch_same_person_fk",
      columns: [table.batchId, table.personId],
      foreignColumns: [importBatches.id, importBatches.personId]
    }),
    foreignKey({
      name: "body_import_records_target_same_person_fk",
      columns: [table.targetSessionId, table.personId],
      foreignColumns: [bodyMeasurementSessions.id, bodyMeasurementSessions.personId]
    }),
    uniqueIndex("body_import_records_batch_locator_code_uq").on(
      table.batchId,
      table.sourceLocator,
      table.findingCode
    ),
    check(
      "body_import_records_valid_shape",
      sql`${table.outcome} IN ('conflict', 'invalid') OR (${table.sourceMeasurementId} IS NOT NULL AND ${table.normalizedLocalDate} IS NOT NULL AND ${table.sourceChecksum} IS NOT NULL)`
    )
  ]
);

export const bodyImportRecordValues = pgTable(
  "body_import_record_values",
  {
    recordId: uuid("record_id").notNull(),
    metric: bodyMeasurementMetric("metric").notNull(),
    value: numeric("value", { precision: 6, scale: 2 }).notNull(),
    unit: bodyMeasurementUnit("unit").default("cm").notNull()
  },
  (table) => [
    foreignKey({
      name: "body_import_record_values_record_fk",
      columns: [table.recordId],
      foreignColumns: [bodyImportRecords.id]
    }).onDelete("cascade"),
    unique("body_import_record_values_record_metric_uq").on(
      table.recordId,
      table.metric
    ),
    check(
      "body_import_record_values_range",
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
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    sourceRecordId: uuid("source_record_id")
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
    foreignKey({
      name: "nutrition_food_composition_source_fk",
      columns: [table.sourceRecordId],
      foreignColumns: [nutritionCatalogSourceRecords.id]
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
    }),
    temporalPrecision: mealTemporalPrecision("temporal_precision")
      .default("instant")
      .notNull(),
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
      "meals_temporal_shape",
      sql`(${table.temporalPrecision} = 'instant' AND ${table.occurredAt} IS NOT NULL) OR (${table.temporalPrecision} = 'local_date' AND ${table.occurredAt} IS NULL)`
    ),
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

function nutritionImportBase() {
  return {
  id: uuid("id").defaultRandom().primaryKey(),
  batchId: uuid("batch_id").notNull(),
  personId: uuid("person_id").notNull(),
  sourceSheetId: integer("source_sheet_id"),
  sourceLocator: varchar("source_locator", { length: 128 }).notNull(),
  sourceRecordId: varchar("source_record_id", { length: 512 }),
  sourceChecksum: varchar("source_checksum", { length: 64 }),
  outcome: importRecordOutcome("outcome").notNull(),
  findingCode: varchar("finding_code", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull()
  } as const;
}

export const nutritionBrandImportRecords = pgTable(
  "nutrition_brand_import_records",
  {
    ...nutritionImportBase(),
    normalizedName: varchar("normalized_name", { length: 256 }),
    normalizedType: varchar("normalized_type", { length: 256 }),
    normalizedNote: text("normalized_note"),
    targetBrandId: uuid("target_brand_id")
  },
  (table) => [
    foreignKey({
      name: "nutrition_brand_import_batch_fk",
      columns: [table.batchId, table.personId],
      foreignColumns: [importBatches.id, importBatches.personId]
    }),
    foreignKey({
      name: "nutrition_brand_import_target_fk",
      columns: [table.targetBrandId],
      foreignColumns: [nutritionBrands.id]
    }),
    unique("nutrition_brand_import_record_uq").on(
      table.batchId,
      table.sourceLocator,
      table.findingCode
    )
  ]
);

export const nutritionIngredientImportRecords = pgTable(
  "nutrition_ingredient_import_records",
  {
    ...nutritionImportBase(),
    normalizedName: varchar("normalized_name", { length: 256 }),
    normalizedCategory: varchar("normalized_category", { length: 256 }),
    referenceQuantity: numeric("reference_quantity", { precision: 12, scale: 3 }),
    referenceUnit: nutritionUnit("reference_unit"),
    caloriesKcal: numeric("calories_kcal", { precision: 12, scale: 3 }),
    proteinG: numeric("protein_g", { precision: 12, scale: 3 }),
    fatG: numeric("fat_g", { precision: 12, scale: 3 }),
    carbsG: numeric("carbs_g", { precision: 12, scale: 3 }),
    targetIngredientId: uuid("target_ingredient_id")
  },
  (table) => [
    foreignKey({
      name: "nutrition_ingredient_import_batch_fk",
      columns: [table.batchId, table.personId],
      foreignColumns: [importBatches.id, importBatches.personId]
    }),
    foreignKey({
      name: "nutrition_ingredient_import_target_fk",
      columns: [table.targetIngredientId],
      foreignColumns: [nutritionIngredients.id]
    }),
    unique("nutrition_ingredient_import_record_uq").on(
      table.batchId,
      table.sourceLocator,
      table.findingCode
    )
  ]
);

export const nutritionFoodImportRecords = pgTable(
  "nutrition_food_import_records",
  {
    ...nutritionImportBase(),
    normalizedName: varchar("normalized_name", { length: 256 }),
    normalizedType: varchar("normalized_type", { length: 256 }),
    normalizedCategory: varchar("normalized_category", { length: 256 }),
    referenceQuantity: numeric("reference_quantity", { precision: 12, scale: 3 }),
    referenceUnit: nutritionUnit("reference_unit"),
    caloriesKcal: numeric("calories_kcal", { precision: 12, scale: 3 }),
    proteinG: numeric("protein_g", { precision: 12, scale: 3 }),
    fatG: numeric("fat_g", { precision: 12, scale: 3 }),
    carbsG: numeric("carbs_g", { precision: 12, scale: 3 }),
    brandSourceId: varchar("brand_source_id", { length: 512 }),
    targetFoodId: uuid("target_food_id")
  },
  (table) => [
    foreignKey({
      name: "nutrition_food_import_batch_fk",
      columns: [table.batchId, table.personId],
      foreignColumns: [importBatches.id, importBatches.personId]
    }),
    foreignKey({
      name: "nutrition_food_import_target_fk",
      columns: [table.targetFoodId],
      foreignColumns: [nutritionFoods.id]
    }),
    unique("nutrition_food_import_record_uq").on(
      table.batchId,
      table.sourceLocator,
      table.findingCode
    )
  ]
);

export const nutritionCompositionImportRecords = pgTable(
  "nutrition_composition_import_records",
  {
    ...nutritionImportBase(),
    foodSourceId: varchar("food_source_id", { length: 512 }),
    ingredientSourceId: varchar("ingredient_source_id", { length: 512 }),
    normalizedQuantity: numeric("normalized_quantity", { precision: 12, scale: 3 }),
    normalizedUnit: nutritionUnit("normalized_unit"),
    normalizedPreparation: varchar("normalized_preparation", { length: 256 }),
    normalizedRequired: boolean("normalized_required"),
    normalizedNote: text("normalized_note"),
    normalizedConfidence: numeric("normalized_confidence", { precision: 4, scale: 3 }),
    targetCompositionId: uuid("target_composition_id")
  },
  (table) => [
    foreignKey({
      name: "nutrition_composition_import_batch_fk",
      columns: [table.batchId, table.personId],
      foreignColumns: [importBatches.id, importBatches.personId]
    }),
    foreignKey({
      name: "nutrition_composition_import_target_fk",
      columns: [table.targetCompositionId],
      foreignColumns: [nutritionFoodVersionIngredients.id]
    }),
    unique("nutrition_composition_import_record_uq").on(
      table.batchId,
      table.sourceLocator,
      table.findingCode
    )
  ]
);

export const nutritionMealImportRecords = pgTable(
  "nutrition_meal_import_records",
  {
    ...nutritionImportBase(),
    normalizedLocalDate: date("normalized_local_date", { mode: "string" }),
    normalizedKind: mealKind("normalized_kind"),
    normalizedLabel: varchar("normalized_label", { length: 256 }),
    normalizedDescription: text("normalized_description"),
    normalizedNote: text("normalized_note"),
    caloriesKcal: numeric("calories_kcal", { precision: 12, scale: 3 }),
    proteinG: numeric("protein_g", { precision: 12, scale: 3 }),
    fatG: numeric("fat_g", { precision: 12, scale: 3 }),
    carbsG: numeric("carbs_g", { precision: 12, scale: 3 }),
    foodSourceId: varchar("food_source_id", { length: 512 }),
    normalizedConfidence: numeric("normalized_confidence", { precision: 4, scale: 3 }),
    targetMealId: uuid("target_meal_id")
  },
  (table) => [
    foreignKey({
      name: "nutrition_meal_import_batch_fk",
      columns: [table.batchId, table.personId],
      foreignColumns: [importBatches.id, importBatches.personId]
    }),
    foreignKey({
      name: "nutrition_meal_import_target_fk",
      columns: [table.targetMealId, table.personId],
      foreignColumns: [meals.id, meals.personId]
    }),
    unique("nutrition_meal_import_record_uq").on(
      table.batchId,
      table.sourceLocator,
      table.findingCode
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

export const recoveryProviders = pgTable(
  "recovery_providers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: varchar("key", { length: 128 }).notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [unique("recovery_providers_key_uq").on(table.key)]
);

export const recoveryDeviceModels = pgTable(
  "recovery_device_models",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerId: uuid("provider_id").notNull(),
    key: varchar("key", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "recovery_device_model_provider_fk",
      columns: [table.providerId],
      foreignColumns: [recoveryProviders.id]
    }),
    unique("recovery_device_models_provider_key_uq").on(
      table.providerId,
      table.key
    )
  ]
);

export const recoveryDeviceModelVersions = pgTable(
  "recovery_device_model_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    modelId: uuid("model_id").notNull(),
    version: integer("version").notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "recovery_device_model_version_model_fk",
      columns: [table.modelId],
      foreignColumns: [recoveryDeviceModels.id]
    }).onDelete("cascade"),
    unique("recovery_device_model_versions_model_version_uq").on(
      table.modelId,
      table.version
    ),
    unique("recovery_device_model_versions_id_model_uq").on(
      table.id,
      table.modelId
    ),
    check("recovery_device_model_versions_positive", sql`${table.version} > 0`)
  ]
);

export const recoveryDeviceCapabilities = pgTable(
  "recovery_device_capabilities",
  {
    modelVersionId: uuid("model_version_id").notNull(),
    kind: recoveryObservationKind("kind").notNull()
  },
  (table) => [
    foreignKey({
      name: "recovery_device_capability_version_fk",
      columns: [table.modelVersionId],
      foreignColumns: [recoveryDeviceModelVersions.id]
    }).onDelete("cascade"),
    unique("recovery_device_capabilities_version_kind_uq").on(
      table.modelVersionId,
      table.kind
    )
  ]
);

export const recoveryConnections = pgTable(
  "recovery_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id").notNull(),
    providerId: uuid("provider_id").notNull(),
    status: recoveryConnectionStatus("status").default("active").notNull(),
    dedupeKey: varchar("dedupe_key", { length: 256 }).notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true, mode: "date" })
  },
  (table) => [
    foreignKey({
      name: "recovery_connection_person_fk",
      columns: [table.personId],
      foreignColumns: [persons.id]
    }),
    foreignKey({
      name: "recovery_connection_provider_fk",
      columns: [table.providerId],
      foreignColumns: [recoveryProviders.id]
    }),
    unique("recovery_connections_id_person_uq").on(table.id, table.personId),
    unique("recovery_connections_person_dedupe_uq").on(
      table.personId,
      table.dedupeKey
    ),
    check(
      "recovery_connections_status_shape",
      sql`(${table.status} = 'active' AND ${table.disconnectedAt} IS NULL)
          OR (${table.status} = 'disconnected' AND ${table.disconnectedAt} IS NOT NULL)`
    )
  ]
);

export const recoveryDevices = pgTable(
  "recovery_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    modelVersionId: uuid("model_version_id").notNull(),
    label: varchar("label", { length: 256 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "recovery_device_connection_person_fk",
      columns: [table.connectionId, table.personId],
      foreignColumns: [recoveryConnections.id, recoveryConnections.personId]
    }).onDelete("cascade"),
    foreignKey({
      name: "recovery_device_model_version_fk",
      columns: [table.modelVersionId],
      foreignColumns: [recoveryDeviceModelVersions.id]
    }),
    unique("recovery_devices_id_person_uq").on(table.id, table.personId),
    unique("recovery_devices_connection_uq").on(table.connectionId)
  ]
);

export const recoveryConsents = pgTable(
  "recovery_consents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    purpose: varchar("purpose", { length: 512 }).notNull(),
    retentionMode: recoveryRetentionMode("retention_mode").notNull(),
    retainUntil: timestamp("retain_until", { withTimezone: true, mode: "date" }),
    status: recoveryConsentStatus("status").default("active").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revocationReason: varchar("revocation_reason", { length: 512 })
  },
  (table) => [
    foreignKey({
      name: "recovery_consent_connection_person_fk",
      columns: [table.connectionId, table.personId],
      foreignColumns: [recoveryConnections.id, recoveryConnections.personId]
    }).onDelete("cascade"),
    unique("recovery_consents_id_connection_person_uq").on(
      table.id,
      table.connectionId,
      table.personId
    ),
    check(
      "recovery_consents_retention_shape",
      sql`(${table.retentionMode} = 'indefinite' AND ${table.retainUntil} IS NULL)
          OR (${table.retentionMode} = 'until' AND ${table.retainUntil} IS NOT NULL)`
    ),
    check(
      "recovery_consents_status_shape",
      sql`(${table.status} = 'active' AND ${table.revokedAt} IS NULL AND ${table.revocationReason} IS NULL)
          OR (${table.status} = 'revoked' AND ${table.revokedAt} IS NOT NULL AND ${table.revocationReason} IS NOT NULL)`
    )
  ]
);

export const recoveryConsentKinds = pgTable(
  "recovery_consent_kinds",
  {
    consentId: uuid("consent_id").notNull(),
    kind: recoveryObservationKind("kind").notNull()
  },
  (table) => [
    foreignKey({
      name: "recovery_consent_kind_consent_fk",
      columns: [table.consentId],
      foreignColumns: [recoveryConsents.id]
    }).onDelete("cascade"),
    unique("recovery_consent_kinds_consent_kind_uq").on(
      table.consentId,
      table.kind
    )
  ]
);

export const recoveryObservations = pgTable(
  "recovery_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id").notNull(),
    kind: recoveryObservationKind("kind").notNull(),
    observedFrom: timestamp("observed_from", { withTimezone: true, mode: "date" }).notNull(),
    observedUntil: timestamp("observed_until", { withTimezone: true, mode: "date" }).notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    quality: recoveryObservationQuality("quality").notNull(),
    source: sourceChannel("source").notNull(),
    sourceReferenceId: uuid("source_reference_id").notNull(),
    connectionId: uuid("connection_id"),
    consentId: uuid("consent_id"),
    dedupeKey: varchar("dedupe_key", { length: 256 }).notNull(),
    supersedesId: uuid("supersedes_id"),
    correctionReason: varchar("correction_reason", { length: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [
    unique("recovery_observations_id_person_uq").on(table.id, table.personId),
    foreignKey({
      name: "recovery_observation_source_person_fk",
      columns: [table.sourceReferenceId, table.personId],
      foreignColumns: [sourceReferences.id, sourceReferences.personId]
    }),
    foreignKey({
      name: "recovery_observation_consent_connection_fk",
      columns: [table.consentId, table.connectionId, table.personId],
      foreignColumns: [recoveryConsents.id, recoveryConsents.connectionId, recoveryConsents.personId]
    }),
    foreignKey({
      name: "recovery_observation_supersedes_person_fk",
      columns: [table.supersedesId, table.personId],
      foreignColumns: [table.id, table.personId]
    }),
    uniqueIndex("recovery_observations_person_source_dedupe_uq").on(
      table.personId,
      table.source,
      table.dedupeKey
    ),
    uniqueIndex("recovery_observations_supersedes_uq")
      .on(table.supersedesId)
      .where(sql`${table.supersedesId} IS NOT NULL`),
    check("recovery_observations_time_order", sql`${table.observedUntil} >= ${table.observedFrom}`),
    check(
      "recovery_observations_device_shape",
      sql`(${table.source}::text = 'device' AND ${table.connectionId} IS NOT NULL AND ${table.consentId} IS NOT NULL)
          OR (${table.source}::text <> 'device' AND ${table.connectionId} IS NULL AND ${table.consentId} IS NULL)`
    ),
    check(
      "recovery_observations_correction_shape",
      sql`(${table.supersedesId} IS NULL AND ${table.correctionReason} IS NULL)
          OR (${table.supersedesId} IS NOT NULL AND ${table.correctionReason} IS NOT NULL)`
    ),
    check(
      "recovery_observations_no_self_supersession",
      sql`${table.supersedesId} IS NULL OR ${table.supersedesId} <> ${table.id}`
    )
  ]
);

export const recoverySleepDetails = pgTable(
  "recovery_sleep_details",
  {
    observationId: uuid("observation_id").primaryKey(),
    totalSleepMinutes: smallint("total_sleep_minutes").notNull(),
    sleepQuality: smallint("sleep_quality")
  },
  (table) => [
    foreignKey({
      name: "recovery_sleep_detail_observation_fk",
      columns: [table.observationId],
      foreignColumns: [recoveryObservations.id]
    }).onDelete("cascade"),
    check(
      "recovery_sleep_details_values",
      sql`${table.totalSleepMinutes} >= 0 AND ${table.totalSleepMinutes} <= 1440
          AND (${table.sleepQuality} IS NULL OR (${table.sleepQuality} >= 1 AND ${table.sleepQuality} <= 5))`
    )
  ]
);

export const recoveryMetricDetails = pgTable(
  "recovery_metric_details",
  {
    observationId: uuid("observation_id").primaryKey(),
    metric: recoveryMetric("metric").notNull(),
    value: numeric("value", { precision: 10, scale: 3 }).notNull(),
    unit: recoveryMetricUnit("unit").notNull()
  },
  (table) => [
    foreignKey({
      name: "recovery_metric_detail_observation_fk",
      columns: [table.observationId],
      foreignColumns: [recoveryObservations.id]
    }).onDelete("cascade"),
    check(
      "recovery_metric_details_shape",
      sql`${table.value} > 0 AND ${table.value} <= 1000
          AND ((${table.metric} = 'hrv_rmssd' AND ${table.unit} = 'ms')
            OR (${table.metric} = 'resting_heart_rate' AND ${table.unit} = 'bpm'))`
    )
  ]
);

export const recoverySubjectiveDetails = pgTable(
  "recovery_subjective_details",
  {
    observationId: uuid("observation_id").primaryKey(),
    energy: smallint("energy").notNull(),
    fatigue: smallint("fatigue").notNull(),
    muscleSoreness: smallint("muscle_soreness").notNull(),
    stress: smallint("stress").notNull(),
    sleepQuality: smallint("sleep_quality").notNull(),
    acuteIllness: boolean("acute_illness").notNull(),
    injuryConcern: boolean("injury_concern").notNull()
  },
  (table) => [
    foreignKey({
      name: "recovery_subjective_detail_observation_fk",
      columns: [table.observationId],
      foreignColumns: [recoveryObservations.id]
    }).onDelete("cascade"),
    check(
      "recovery_subjective_details_scales",
      sql`${table.energy} BETWEEN 1 AND 5
          AND ${table.fatigue} BETWEEN 1 AND 5
          AND ${table.muscleSoreness} BETWEEN 1 AND 5
          AND ${table.stress} BETWEEN 1 AND 5
          AND ${table.sleepQuality} BETWEEN 1 AND 5`
    )
  ]
);

export const recoveryAssessmentPolicies = pgTable(
  "recovery_assessment_policies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: varchar("key", { length: 128 }).notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [unique("recovery_assessment_policies_key_uq").on(table.key)]
);

export const recoveryAssessmentPolicyVersions = pgTable(
  "recovery_assessment_policy_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    policyId: uuid("policy_id").notNull(),
    version: integer("version").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" }).notNull(),
    effectiveUntil: timestamp("effective_until", { withTimezone: true, mode: "date" }),
    analysisWindowDays: smallint("analysis_window_days").notNull(),
    minimumObservations: smallint("minimum_observations").notNull(),
    sufficientObservations: smallint("sufficient_observations").notNull(),
    insufficientConfidenceCap: numeric("insufficient_confidence_cap", { precision: 4, scale: 3 }).notNull(),
    poorQualityConfidenceCap: numeric("poor_quality_confidence_cap", { precision: 4, scale: 3 }).notNull(),
    targetSleepMinutes: smallint("target_sleep_minutes").notNull(),
    fatigueWeight: numeric("fatigue_weight", { precision: 6, scale: 3 }).notNull(),
    sorenessWeight: numeric("soreness_weight", { precision: 6, scale: 3 }).notNull(),
    stressWeight: numeric("stress_weight", { precision: 6, scale: 3 }).notNull(),
    lowEnergyWeight: numeric("low_energy_weight", { precision: 6, scale: 3 }).notNull(),
    lowSleepQualityWeight: numeric("low_sleep_quality_weight", { precision: 6, scale: 3 }).notNull(),
    sleepDeficitWeight: numeric("sleep_deficit_weight", { precision: 6, scale: 3 }).notNull(),
    externalSetWeight: numeric("external_set_weight", { precision: 6, scale: 3 }).notNull(),
    bodyweightSetWeight: numeric("bodyweight_set_weight", { precision: 6, scale: 3 }).notNull(),
    assistedSetWeight: numeric("assisted_set_weight", { precision: 6, scale: 3 }).notNull(),
    moderateRiskThreshold: numeric("moderate_risk_threshold", { precision: 6, scale: 3 }).notNull(),
    highRiskThreshold: numeric("high_risk_threshold", { precision: 6, scale: 3 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "recovery_assessment_policy_version_policy_fk",
      columns: [table.policyId],
      foreignColumns: [recoveryAssessmentPolicies.id]
    }).onDelete("cascade"),
    unique("recovery_assessment_policy_versions_policy_version_uq").on(
      table.policyId,
      table.version
    ),
    check(
      "recovery_assessment_policy_versions_values",
      sql`${table.version} > 0
          AND ${table.analysisWindowDays} > 0
          AND ${table.minimumObservations} > 0
          AND ${table.sufficientObservations} >= ${table.minimumObservations}
          AND ${table.insufficientConfidenceCap} BETWEEN 0 AND 1
          AND ${table.poorQualityConfidenceCap} BETWEEN 0 AND 1
          AND ${table.targetSleepMinutes} > 0
          AND ${table.fatigueWeight} >= 0
          AND ${table.sorenessWeight} >= 0
          AND ${table.stressWeight} >= 0
          AND ${table.lowEnergyWeight} >= 0
          AND ${table.lowSleepQualityWeight} >= 0
          AND ${table.sleepDeficitWeight} >= 0
          AND ${table.externalSetWeight} >= 0
          AND ${table.bodyweightSetWeight} >= 0
          AND ${table.assistedSetWeight} >= 0
          AND ${table.moderateRiskThreshold} >= 0
          AND ${table.highRiskThreshold} > ${table.moderateRiskThreshold}
          AND (${table.effectiveUntil} IS NULL OR ${table.effectiveUntil} > ${table.effectiveFrom})`
    )
  ]
);

export const recoveryAssessments = pgTable(
  "recovery_assessments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id").notNull(),
    policyVersionId: uuid("policy_version_id").notNull(),
    asOf: timestamp("as_of", { withTimezone: true, mode: "date" }).notNull(),
    windowStart: timestamp("window_start", { withTimezone: true, mode: "date" }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true, mode: "date" }).notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    readinessScore: numeric("readiness_score", { precision: 6, scale: 3 }).notNull(),
    riskLevel: recoveryRiskLevel("risk_level").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    dataQuality: recoveryAssessmentDataQuality("data_quality").notNull(),
    hardStop: boolean("hard_stop").notNull(),
    evidenceChecksum: varchar("evidence_checksum", { length: 128 }).notNull(),
    calculationSnapshot: jsonb("calculation_snapshot").$type<Record<string, unknown>>().notNull(),
    dedupeKey: varchar("dedupe_key", { length: 256 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "recovery_assessment_person_fk",
      columns: [table.personId],
      foreignColumns: [persons.id]
    }),
    foreignKey({
      name: "recovery_assessment_policy_version_fk",
      columns: [table.policyVersionId],
      foreignColumns: [recoveryAssessmentPolicyVersions.id]
    }),
    unique("recovery_assessments_id_person_uq").on(table.id, table.personId),
    unique("recovery_assessments_person_dedupe_uq").on(table.personId, table.dedupeKey),
    unique("recovery_assessments_person_evidence_uq").on(
      table.personId,
      table.policyVersionId,
      table.evidenceChecksum
    ),
    check(
      "recovery_assessments_values",
      sql`${table.windowEnd} >= ${table.windowStart}
          AND ${table.readinessScore} BETWEEN 0 AND 100
          AND ${table.confidence} BETWEEN 0 AND 1
          AND (NOT ${table.hardStop} OR ${table.riskLevel} = 'blocked')`
    )
  ]
);

export const recoveryAssessmentObservationEvidence = pgTable(
  "recovery_assessment_observation_evidence",
  {
    assessmentId: uuid("assessment_id").notNull(),
    observationId: uuid("observation_id").notNull(),
    personId: uuid("person_id").notNull()
  },
  (table) => [
    foreignKey({
      name: "recovery_assessment_observation_assessment_fk",
      columns: [table.assessmentId, table.personId],
      foreignColumns: [recoveryAssessments.id, recoveryAssessments.personId]
    }).onDelete("cascade"),
    foreignKey({
      name: "recovery_assessment_observation_observation_fk",
      columns: [table.observationId, table.personId],
      foreignColumns: [recoveryObservations.id, recoveryObservations.personId]
    }),
    unique("recovery_assessment_observation_evidence_uq").on(
      table.assessmentId,
      table.observationId
    )
  ]
);

export const recoveryAssessmentTrainingEvidence = pgTable(
  "recovery_assessment_training_evidence",
  {
    assessmentId: uuid("assessment_id").notNull(),
    workoutSessionId: uuid("workout_session_id").notNull(),
    personId: uuid("person_id").notNull()
  },
  (table) => [
    foreignKey({
      name: "recovery_assessment_training_assessment_fk",
      columns: [table.assessmentId, table.personId],
      foreignColumns: [recoveryAssessments.id, recoveryAssessments.personId]
    }).onDelete("cascade"),
    foreignKey({
      name: "recovery_assessment_training_session_fk",
      columns: [table.workoutSessionId, table.personId],
      foreignColumns: [workoutSessions.id, workoutSessions.personId]
    }),
    unique("recovery_assessment_training_evidence_uq").on(
      table.assessmentId,
      table.workoutSessionId
    )
  ]
);

export const coachingPolicies = pgTable(
  "coaching_policies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: varchar("key", { length: 128 }).notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [unique("coaching_policies_key_uq").on(table.key)]
);

export const coachingPolicyVersions = pgTable(
  "coaching_policy_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    policyId: uuid("policy_id").notNull(),
    version: integer("version").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" }).notNull(),
    effectiveUntil: timestamp("effective_until", { withTimezone: true, mode: "date" }),
    recommendationTtlMinutes: integer("recommendation_ttl_minutes").notNull(),
    minimumConfidence: numeric("minimum_confidence", { precision: 4, scale: 3 }).notNull(),
    highRiskLoadFactor: numeric("high_risk_load_factor", { precision: 4, scale: 3 }).notNull(),
    repetitionReduction: smallint("repetition_reduction").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "coaching_policy_version_policy_fk",
      columns: [table.policyId],
      foreignColumns: [coachingPolicies.id]
    }).onDelete("cascade"),
    unique("coaching_policy_versions_policy_version_uq").on(table.policyId, table.version),
    check(
      "coaching_policy_versions_values",
      sql`${table.version} > 0
          AND ${table.recommendationTtlMinutes} > 0
          AND ${table.minimumConfidence} BETWEEN 0 AND 1
          AND ${table.highRiskLoadFactor} > 0
          AND ${table.highRiskLoadFactor} < 1
          AND ${table.repetitionReduction} > 0
          AND (${table.effectiveUntil} IS NULL OR ${table.effectiveUntil} > ${table.effectiveFrom})`
    )
  ]
);

export const coachingRecommendations = pgTable(
  "coaching_recommendations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id").notNull(),
    kind: coachingRecommendationKind("kind").notNull(),
    policyVersionId: uuid("policy_version_id").notNull(),
    asOf: timestamp("as_of", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    evidenceChecksum: varchar("evidence_checksum", { length: 128 }).notNull(),
    explanation: varchar("explanation", { length: 2048 }).notNull(),
    dedupeKey: varchar("dedupe_key", { length: 256 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "coaching_recommendation_person_fk",
      columns: [table.personId],
      foreignColumns: [persons.id]
    }),
    foreignKey({
      name: "coaching_recommendation_policy_version_fk",
      columns: [table.policyVersionId],
      foreignColumns: [coachingPolicyVersions.id]
    }),
    unique("coaching_recommendations_id_person_uq").on(table.id, table.personId),
    unique("coaching_recommendations_person_dedupe_uq").on(table.personId, table.dedupeKey),
    unique("coaching_recommendations_person_evidence_uq").on(
      table.personId,
      table.policyVersionId,
      table.evidenceChecksum
    ),
    check("coaching_recommendations_expiry", sql`${table.expiresAt} > ${table.asOf}`)
  ]
);

export const coachingTrainingAdjustmentDetails = pgTable(
  "coaching_training_adjustment_details",
  {
    recommendationId: uuid("recommendation_id").primaryKey(),
    personId: uuid("person_id").notNull(),
    programId: uuid("program_id").notNull(),
    programVersionId: uuid("program_version_id").notNull(),
    prescriptionId: uuid("prescription_id").notNull(),
    workoutPosition: smallint("workout_position").notNull(),
    prescriptionPosition: smallint("prescription_position").notNull(),
    exerciseId: uuid("exercise_id").notNull(),
    exerciseVersionId: uuid("exercise_version_id").notNull(),
    action: coachingTrainingAdjustmentAction("action").notNull(),
    reasonCode: coachingTrainingAdjustmentReason("reason_code").notNull(),
    currentTargetWeightKg: numeric("current_target_weight_kg", { precision: 12, scale: 3 }),
    suggestedTargetWeightKg: numeric("suggested_target_weight_kg", { precision: 12, scale: 3 }),
    currentRepsMin: integer("current_reps_min").notNull(),
    currentRepsMax: integer("current_reps_max").notNull(),
    suggestedRepsMin: integer("suggested_reps_min"),
    suggestedRepsMax: integer("suggested_reps_max")
  },
  (table) => [
    foreignKey({
      name: "coaching_training_adjustment_recommendation_fk",
      columns: [table.recommendationId, table.personId],
      foreignColumns: [coachingRecommendations.id, coachingRecommendations.personId]
    }).onDelete("cascade"),
    foreignKey({
      name: "coaching_training_adjustment_program_version_fk",
      columns: [table.programVersionId, table.programId, table.personId],
      foreignColumns: [trainingProgramVersions.id, trainingProgramVersions.programId, trainingProgramVersions.personId]
    }),
    foreignKey({
      name: "coaching_training_adjustment_prescription_fk",
      columns: [table.prescriptionId],
      foreignColumns: [trainingProgramPrescriptions.id]
    }),
    check(
      "coaching_training_adjustment_values",
      sql`${table.workoutPosition} > 0
          AND ${table.prescriptionPosition} > 0
          AND ${table.currentRepsMin} > 0
          AND ${table.currentRepsMax} >= ${table.currentRepsMin}
          AND (${table.currentTargetWeightKg} IS NULL OR ${table.currentTargetWeightKg} >= 0)
          AND (
            (${table.action} = 'hold'
              AND ${table.suggestedTargetWeightKg} IS NULL
              AND ${table.suggestedRepsMin} IS NULL
              AND ${table.suggestedRepsMax} IS NULL)
            OR (${table.action} = 'target_weight'
              AND ${table.currentTargetWeightKg} IS NOT NULL
              AND ${table.suggestedTargetWeightKg} IS NOT NULL
              AND ${table.suggestedTargetWeightKg} >= 0
              AND ${table.suggestedTargetWeightKg} <> ${table.currentTargetWeightKg}
              AND ${table.suggestedRepsMin} IS NULL
              AND ${table.suggestedRepsMax} IS NULL)
            OR (${table.action} = 'repetition_range'
              AND ${table.suggestedTargetWeightKg} IS NULL
              AND ${table.suggestedRepsMin} > 0
              AND ${table.suggestedRepsMax} >= ${table.suggestedRepsMin}
              AND (${table.suggestedRepsMin} <> ${table.currentRepsMin}
                OR ${table.suggestedRepsMax} <> ${table.currentRepsMax}))
          )`
    )
  ]
);

export const coachingRecommendationRecoveryEvidence = pgTable(
  "coaching_recommendation_recovery_evidence",
  {
    recommendationId: uuid("recommendation_id").notNull(),
    personId: uuid("person_id").notNull(),
    recoveryAssessmentId: uuid("recovery_assessment_id").notNull()
  },
  (table) => [
    foreignKey({
      name: "coaching_recovery_evidence_recommendation_fk",
      columns: [table.recommendationId, table.personId],
      foreignColumns: [coachingRecommendations.id, coachingRecommendations.personId]
    }).onDelete("cascade"),
    foreignKey({
      name: "coaching_recovery_evidence_assessment_fk",
      columns: [table.recoveryAssessmentId, table.personId],
      foreignColumns: [recoveryAssessments.id, recoveryAssessments.personId]
    }),
    unique("coaching_recovery_evidence_recommendation_uq").on(table.recommendationId)
  ]
);

export const coachingRecommendationTrainingSessionEvidence = pgTable(
  "coaching_recommendation_training_session_evidence",
  {
    recommendationId: uuid("recommendation_id").notNull(),
    personId: uuid("person_id").notNull(),
    workoutSessionId: uuid("workout_session_id").notNull()
  },
  (table) => [
    foreignKey({
      name: "coaching_training_evidence_recommendation_fk",
      columns: [table.recommendationId, table.personId],
      foreignColumns: [coachingRecommendations.id, coachingRecommendations.personId]
    }).onDelete("cascade"),
    foreignKey({
      name: "coaching_training_evidence_session_fk",
      columns: [table.workoutSessionId, table.personId],
      foreignColumns: [workoutSessions.id, workoutSessions.personId]
    }),
    unique("coaching_training_evidence_uq").on(table.recommendationId, table.workoutSessionId)
  ]
);

export const coachingRecommendationDecisions = pgTable(
  "coaching_recommendation_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recommendationId: uuid("recommendation_id").notNull(),
    personId: uuid("person_id").notNull(),
    actorPersonId: uuid("actor_person_id").notNull(),
    outcome: coachingDecisionOutcome("outcome").notNull(),
    reason: varchar("reason", { length: 512 }).notNull(),
    dedupeKey: varchar("dedupe_key", { length: 256 }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "coaching_decision_recommendation_fk",
      columns: [table.recommendationId, table.personId],
      foreignColumns: [coachingRecommendations.id, coachingRecommendations.personId]
    }).onDelete("cascade"),
    foreignKey({
      name: "coaching_decision_actor_fk",
      columns: [table.actorPersonId],
      foreignColumns: [persons.id]
    }),
    unique("coaching_decisions_recommendation_uq").on(table.recommendationId),
    unique("coaching_decisions_person_dedupe_uq").on(table.personId, table.dedupeKey),
    check("coaching_decisions_actor_is_owner", sql`${table.actorPersonId} = ${table.personId}`)
  ]
);

/** Append-only Person-local coordination snapshot; it never owns domain facts. */
export const dayClosures = pgTable(
  "day_closures",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id").notNull().references(() => persons.id),
    closedByPersonId: uuid("closed_by_person_id").notNull().references(() => persons.id),
    source: sourceChannel("source").notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    version: integer("version").notNull(),
    status: dayClosureStatus("status").default("active").notNull(),
    policyVersion: varchar("policy_version", { length: 128 }).notNull(),
    snapshot: jsonb("snapshot").$type<unknown>().notNull(),
    stateFingerprint: varchar("state_fingerprint", { length: 128 }).notNull(),
    supersedesId: uuid("supersedes_id"),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    reopenedAt: timestamp("reopened_at", { withTimezone: true, mode: "date" }),
    reopenReason: varchar("reopen_reason", { length: 512 })
  },
  (table) => [
    unique("day_closures_id_person_uq").on(table.id, table.personId),
    foreignKey({
      name: "day_closures_supersedes_fk",
      columns: [table.supersedesId, table.personId],
      foreignColumns: [table.id, table.personId]
    }),
    unique("day_closures_person_date_version_uq").on(
      table.personId,
      table.localDate,
      table.version
    ),
    uniqueIndex("day_closures_active_date_uq")
      .on(table.personId, table.localDate)
      .where(sql`${table.status} = 'active'`),
    check("day_closures_version_positive", sql`${table.version} > 0`),
    check("day_closures_actor_is_owner", sql`${table.closedByPersonId} = ${table.personId}`),
    check(
      "day_closures_reopen_shape",
      sql`(${table.status} = 'active' AND ${table.reopenedAt} IS NULL AND ${table.reopenReason} IS NULL)
          OR (${table.status} = 'superseded' AND ${table.reopenedAt} IS NOT NULL AND ${table.reopenReason} IS NOT NULL)`
    ),
    check(
      "day_closures_no_self_supersede",
      sql`${table.supersedesId} IS NULL OR ${table.supersedesId} <> ${table.id}`
    )
  ]
);

/** Idempotency ledger for explicit close/reopen commands. */
export const dayClosureOperations = pgTable(
  "day_closure_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id").notNull().references(() => persons.id),
    actorPersonId: uuid("actor_person_id").notNull().references(() => persons.id),
    source: sourceChannel("source").notNull(),
    operation: dayClosureOperation("operation").notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 256 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 128 }).notNull(),
    closureId: uuid("closure_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "day_closure_ops_closure_person_fk",
      columns: [table.closureId, table.personId],
      foreignColumns: [dayClosures.id, dayClosures.personId]
    }),
    unique("day_closure_ops_person_op_key_uq").on(
      table.personId,
      table.operation,
      table.idempotencyKey
    ),
    check("day_closure_ops_actor_is_owner", sql`${table.actorPersonId} = ${table.personId}`)
  ]
);

/** Typed manifest of immutable facts and decisions included in a closure. */
export const dayClosureReferences = pgTable(
  "day_closure_references",
  {
    closureId: uuid("closure_id").notNull(),
    kind: dayClosureReferenceKind("kind").notNull(),
    referenceId: uuid("reference_id").notNull()
  },
  (table) => [
    foreignKey({
      name: "day_closure_refs_closure_fk",
      columns: [table.closureId],
      foreignColumns: [dayClosures.id]
    }).onDelete("cascade"),
    unique("day_closure_refs_closure_kind_id_uq").on(
      table.closureId,
      table.kind,
      table.referenceId
    )
  ]
);

export const intakeRequests = pgTable(
  "intake_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    source: sourceChannel("source").notNull(),
    sourceReferenceId: uuid("source_reference_id").notNull(),
    originalText: text("original_text").notNull(),
    locale: varchar("locale", { length: 35 }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 256 }).notNull(),
    parsingStatus: intakeParsingStatus("parsing_status")
      .default("queued")
      .notNull(),
    failureCode: varchar("failure_code", { length: 128 }),
    receivedAt: timestamp("received_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    unique("intake_requests_id_person_uq").on(table.id, table.personId),
    foreignKey({
      name: "intake_requests_source_person_fk",
      columns: [table.sourceReferenceId, table.personId],
      foreignColumns: [sourceReferences.id, sourceReferences.personId]
    }),
    unique("intake_requests_person_source_dedupe_uq").on(
      table.personId,
      table.source,
      table.idempotencyKey
    ),
    check(
      "intake_requests_failure_state",
      sql`(${table.parsingStatus} = 'failed') = (${table.failureCode} IS NOT NULL)`
    )
  ]
);

export const intakeItems = pgTable(
  "intake_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id").notNull(),
    personId: uuid("person_id").notNull(),
    position: smallint("position").notNull(),
    kind: intakeItemKind("kind").notNull(),
    status: intakeItemStatus("status").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    clarificationQuestion: varchar("clarification_question", { length: 2_000 }),
    clarificationAnswer: varchar("clarification_answer", { length: 2_000 }),
    clarificationIdempotencyKey: varchar("clarification_idempotency_key", {
      length: 256
    }),
    decisionIdempotencyKey: varchar("decision_idempotency_key", { length: 256 }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    unique("intake_items_id_person_uq").on(table.id, table.personId),
    foreignKey({
      name: "intake_items_request_person_fk",
      columns: [table.requestId, table.personId],
      foreignColumns: [intakeRequests.id, intakeRequests.personId]
    }).onDelete("cascade"),
    unique("intake_items_request_position_uq").on(
      table.requestId,
      table.position
    ),
    index("intake_items_request_status_idx").on(
      table.requestId,
      table.status
    ),
    check("intake_items_position_nonnegative", sql`${table.position} >= 0`),
    check(
      "intake_items_confidence_range",
      sql`${table.confidence} IS NULL OR (${table.confidence} >= 0 AND ${table.confidence} <= 1)`
    ),
    check(
      "intake_items_clarification_shape",
      sql`(${table.status} = 'needs_clarification') = (${table.clarificationQuestion} IS NOT NULL)`
    )
  ]
);

export const intakeWeightDetails = pgTable(
  "intake_weight_details",
  {
    itemId: uuid("item_id").primaryKey(),
    personId: uuid("person_id").notNull(),
    measuredAt: timestamp("measured_at", {
      withTimezone: true,
      mode: "date"
    }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    weightKg: numeric("weight_kg", { precision: 6, scale: 3 }).notNull(),
    dedupeKey: varchar("dedupe_key", { length: 256 }).notNull(),
    measurementId: uuid("measurement_id")
  },
  (table) => [
    foreignKey({
      name: "intake_weight_detail_item_person_fk",
      columns: [table.itemId, table.personId],
      foreignColumns: [intakeItems.id, intakeItems.personId]
    }).onDelete("cascade"),
    foreignKey({
      name: "intake_weight_detail_measurement_person_fk",
      columns: [table.measurementId, table.personId],
      foreignColumns: [weightMeasurements.id, weightMeasurements.personId]
    }),
    check(
      "intake_weight_details_weight_range",
      sql`${table.weightKg} >= 0.500 AND ${table.weightKg} <= 700.000`
    )
  ]
);

export const intakeJobs = pgTable(
  "intake_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id").notNull(),
    requestId: uuid("request_id").notNull(),
    itemId: uuid("item_id"),
    kind: intakeJobKind("kind").notNull(),
    jobKey: varchar("job_key", { length: 256 }).notNull(),
    status: intakeJobStatus("status").default("available").notNull(),
    availableAt: timestamp("available_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull(),
    leasedUntil: timestamp("leased_until", {
      withTimezone: true,
      mode: "date"
    }),
    leaseToken: uuid("lease_token"),
    attempts: smallint("attempts").default(0).notNull(),
    maxAttempts: smallint("max_attempts").default(5).notNull(),
    errorCode: varchar("error_code", { length: 128 }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date"
    })
  },
  (table) => [
    foreignKey({
      name: "intake_jobs_request_person_fk",
      columns: [table.requestId, table.personId],
      foreignColumns: [intakeRequests.id, intakeRequests.personId]
    }).onDelete("cascade"),
    foreignKey({
      name: "intake_jobs_item_person_fk",
      columns: [table.itemId, table.personId],
      foreignColumns: [intakeItems.id, intakeItems.personId]
    }).onDelete("cascade"),
    unique("intake_jobs_person_key_uq").on(table.personId, table.jobKey),
    index("intake_jobs_available_idx").on(
      table.status,
      table.availableAt,
      table.createdAt
    ),
    check(
      "intake_jobs_attempt_limits",
      sql`${table.attempts} >= 0 AND ${table.maxAttempts} > 0 AND ${table.attempts} <= ${table.maxAttempts}`
    ),
    check(
      "intake_jobs_lease_shape",
      sql`(${table.status} = 'leased') = (${table.leasedUntil} IS NOT NULL AND ${table.leaseToken} IS NOT NULL)`
    ),
    check(
      "intake_jobs_completion_shape",
      sql`(${table.status} = 'completed') = (${table.completedAt} IS NOT NULL)`
    ),
    check(
      "intake_jobs_item_shape",
      sql`(${table.kind} = 'parse_request' AND ${table.itemId} IS NULL) OR (${table.kind} <> 'parse_request' AND ${table.itemId} IS NOT NULL)`
    )
  ]
);

export const intakeTimelineEntries = pgTable(
  "intake_timeline_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id").notNull(),
    requestId: uuid("request_id").notNull(),
    itemId: uuid("item_id"),
    event: intakeTimelineEvent("event").notNull(),
    detailCode: varchar("detail_code", { length: 128 }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    index("intake_timeline_request_created_idx").on(
      table.requestId,
      table.createdAt
    ),
    foreignKey({
      name: "intake_timeline_request_person_fk",
      columns: [table.requestId, table.personId],
      foreignColumns: [intakeRequests.id, intakeRequests.personId]
    }).onDelete("cascade"),
    foreignKey({
      name: "intake_timeline_item_person_fk",
      columns: [table.itemId, table.personId],
      foreignColumns: [intakeItems.id, intakeItems.personId]
    }).onDelete("cascade")
  ]
);

/** Persisted SourceReference row returned by Drizzle queries. */
export type SourceReferenceRow = typeof sourceReferences.$inferSelect;
/** Persisted versioned Person-local closure coordination artifact. */
export type DayClosureRow = typeof dayClosures.$inferSelect;
/** Persisted idempotency record for a closure operation. */
export type DayClosureOperationRow = typeof dayClosureOperations.$inferSelect;
/** Insertable SourceReference row accepted by Drizzle mutations. */
export type NewSourceReferenceRow = typeof sourceReferences.$inferInsert;
/** Persisted WeightMeasurement row returned by Drizzle queries. */
export type WeightMeasurementRow = typeof weightMeasurements.$inferSelect;
/** Insertable WeightMeasurement row accepted by Drizzle mutations. */
export type NewWeightMeasurementRow = typeof weightMeasurements.$inferInsert;
/** Persisted common import execution audit row. */
export type ImportBatchRow = typeof importBatches.$inferSelect;
/** Persisted typed Weight reconciliation finding. */
export type WeightImportRecordRow = typeof weightImportRecords.$inferSelect;
/** Persisted person-owned natural-language intake request. */
export type IntakeRequestRow = typeof intakeRequests.$inferSelect;
/** Persisted independently actionable intake item. */
export type IntakeItemRow = typeof intakeItems.$inferSelect;
/** Persisted typed proposed WeightMeasurement command. */
export type IntakeWeightDetailRow = typeof intakeWeightDetails.$inferSelect;
/** Persisted durable Intake work item. */
export type IntakeJobRow = typeof intakeJobs.$inferSelect;
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
/** Persisted immutable Recovery observation root. */
export type RecoveryObservationRow = typeof recoveryObservations.$inferSelect;
/** Persisted immutable Recovery assessment. */
export type RecoveryAssessmentRow = typeof recoveryAssessments.$inferSelect;
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
