import { sql } from "drizzle-orm";
import {
  check,
  date,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

export const weightMeasurementSource = pgEnum("weight_measurement_source", [
  "manual",
  "google_sheets",
  "import"
]);

export const weightMeasurements = pgTable(
  "weight_measurements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    measuredAt: timestamp("measured_at", {
      withTimezone: true,
      mode: "date"
    }).notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    weightKg: numeric("weight_kg", { precision: 6, scale: 3 }).notNull(),
    source: weightMeasurementSource("source").notNull(),
    sourceRecordId: varchar("source_record_id", { length: 512 }),
    dedupeKey: varchar("dedupe_key", { length: 256 }).notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    provenance: jsonb("provenance")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    uniqueIndex("weight_measurements_dedupe_key_uq").on(table.dedupeKey),
    check(
      "weight_measurements_weight_kg_range",
      sql`${table.weightKg} >= 0.500 AND ${table.weightKg} <= 700.000`
    ),
    check(
      "weight_measurements_confidence_range",
      sql`${table.confidence} IS NULL OR (${table.confidence} >= 0 AND ${table.confidence} <= 1)`
    )
  ]
);

/** Persisted WeightMeasurement row returned by Drizzle queries. */
export type WeightMeasurementRow =
  typeof weightMeasurements.$inferSelect;
/** Insertable WeightMeasurement row accepted by Drizzle mutations. */
export type NewWeightMeasurementRow =
  typeof weightMeasurements.$inferInsert;
