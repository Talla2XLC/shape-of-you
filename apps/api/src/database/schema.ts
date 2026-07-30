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
