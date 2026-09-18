ALTER TABLE "coaching_daily_assessment_details" DROP CONSTRAINT "coaching_daily_assessment_policy_payload";--> statement-breakpoint
ALTER TABLE "recovery_metric_details" DROP CONSTRAINT "recovery_metric_details_shape";--> statement-breakpoint
ALTER TABLE "recovery_metric_details" ALTER COLUMN "metric" TYPE text USING "metric"::text;--> statement-breakpoint
ALTER TABLE "recovery_import_records" ALTER COLUMN "metric" TYPE text USING "metric"::text;--> statement-breakpoint
ALTER TABLE "recovery_metric_details" ALTER COLUMN "unit" TYPE text USING "unit"::text;--> statement-breakpoint
ALTER TABLE "recovery_import_records" ALTER COLUMN "metric_unit" TYPE text USING "metric_unit"::text;--> statement-breakpoint
DROP TYPE "public"."recovery_metric";--> statement-breakpoint
DROP TYPE "public"."recovery_metric_unit";--> statement-breakpoint
CREATE TYPE "public"."recovery_metric" AS ENUM('hrv_rmssd', 'resting_heart_rate', 'night_heart_rate', 'oxygen_saturation', 'minimum_oxygen_saturation', 'temperature_deviation', 'respiration_rate', 'body_battery', 'body_battery_min', 'body_battery_max', 'sleep_score', 'steps');--> statement-breakpoint
CREATE TYPE "public"."recovery_metric_unit" AS ENUM('ms', 'bpm', 'percent', 'celsius', 'breaths_per_minute', 'score', 'count');--> statement-breakpoint
ALTER TABLE "recovery_metric_details" ALTER COLUMN "metric" TYPE "public"."recovery_metric" USING "metric"::"public"."recovery_metric";--> statement-breakpoint
ALTER TABLE "recovery_import_records" ALTER COLUMN "metric" TYPE "public"."recovery_metric" USING "metric"::"public"."recovery_metric";--> statement-breakpoint
ALTER TABLE "recovery_metric_details" ALTER COLUMN "unit" TYPE "public"."recovery_metric_unit" USING "unit"::"public"."recovery_metric_unit";--> statement-breakpoint
ALTER TABLE "recovery_import_records" ALTER COLUMN "metric_unit" TYPE "public"."recovery_metric_unit" USING "metric_unit"::"public"."recovery_metric_unit";--> statement-breakpoint
ALTER TABLE "coaching_daily_assessment_details" ADD COLUMN "movement" jsonb;--> statement-breakpoint
ALTER TABLE "coaching_daily_assessment_details" ADD CONSTRAINT "coaching_daily_assessment_policy_payload" CHECK (("coaching_daily_assessment_details"."policy_version" = 'daily-assessment-v1'
            AND "coaching_daily_assessment_details"."personal_baseline" IS NULL
            AND "coaching_daily_assessment_details"."personal_baseline_calculation" IS NULL
            AND "coaching_daily_assessment_details"."movement" IS NULL)
        OR ("coaching_daily_assessment_details"."policy_version" = 'daily-assessment-v2'
            AND "coaching_daily_assessment_details"."personal_baseline" IS NOT NULL
            AND "coaching_daily_assessment_details"."personal_baseline_calculation" IS NOT NULL
            AND "coaching_daily_assessment_details"."movement" IS NULL)
        OR ("coaching_daily_assessment_details"."policy_version" = 'daily-assessment-v3'
            AND "coaching_daily_assessment_details"."personal_baseline" IS NOT NULL
            AND "coaching_daily_assessment_details"."personal_baseline_calculation" IS NOT NULL
            AND "coaching_daily_assessment_details"."movement" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "recovery_metric_details" ADD CONSTRAINT "recovery_metric_details_shape" CHECK ("recovery_metric_details"."value" >= -100 AND "recovery_metric_details"."value" <= 1000000
          AND (("recovery_metric_details"."metric" = 'hrv_rmssd' AND "recovery_metric_details"."value" > 0 AND "recovery_metric_details"."unit" = 'ms')
            OR ("recovery_metric_details"."metric" IN ('resting_heart_rate', 'night_heart_rate') AND "recovery_metric_details"."value" > 0 AND "recovery_metric_details"."unit" = 'bpm')
            OR ("recovery_metric_details"."metric" IN ('oxygen_saturation', 'minimum_oxygen_saturation') AND "recovery_metric_details"."value" >= 0 AND "recovery_metric_details"."value" <= 100 AND "recovery_metric_details"."unit" = 'percent')
            OR ("recovery_metric_details"."metric" = 'temperature_deviation' AND "recovery_metric_details"."value" >= -20 AND "recovery_metric_details"."value" <= 20 AND "recovery_metric_details"."unit" = 'celsius')
            OR ("recovery_metric_details"."metric" = 'respiration_rate' AND "recovery_metric_details"."value" > 0 AND "recovery_metric_details"."value" <= 100 AND "recovery_metric_details"."unit" = 'breaths_per_minute')
            OR ("recovery_metric_details"."metric" IN ('body_battery', 'body_battery_min', 'body_battery_max', 'sleep_score') AND "recovery_metric_details"."value" >= 0 AND "recovery_metric_details"."value" <= 100 AND "recovery_metric_details"."unit" = 'score')
            OR ("recovery_metric_details"."metric" = 'steps' AND "recovery_metric_details"."value" >= 0 AND "recovery_metric_details"."value" <= 1000000 AND trunc("recovery_metric_details"."value") = "recovery_metric_details"."value" AND "recovery_metric_details"."unit" = 'count')));
