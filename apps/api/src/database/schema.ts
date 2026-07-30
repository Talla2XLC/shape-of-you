import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar
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
export const sourceChannel = pgEnum("weight_measurement_source", [
  "manual",
  "google_sheets",
  "import"
]);

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

/** Persisted SourceReference row returned by Drizzle queries. */
export type SourceReferenceRow = typeof sourceReferences.$inferSelect;
/** Insertable SourceReference row accepted by Drizzle mutations. */
export type NewSourceReferenceRow = typeof sourceReferences.$inferInsert;
/** Persisted WeightMeasurement row returned by Drizzle queries. */
export type WeightMeasurementRow = typeof weightMeasurements.$inferSelect;
/** Insertable WeightMeasurement row accepted by Drizzle mutations. */
export type NewWeightMeasurementRow = typeof weightMeasurements.$inferInsert;
