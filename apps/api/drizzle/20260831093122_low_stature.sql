ALTER TABLE "recovery_metric_details" DROP CONSTRAINT "recovery_metric_details_shape";--> statement-breakpoint
ALTER TABLE "recovery_metric_details" ALTER COLUMN "metric" TYPE text USING "metric"::text;--> statement-breakpoint
ALTER TABLE "recovery_import_records" ALTER COLUMN "metric" TYPE text USING "metric"::text;--> statement-breakpoint
DROP TYPE "public"."recovery_metric";--> statement-breakpoint
CREATE TYPE "public"."recovery_metric" AS ENUM('hrv_rmssd', 'resting_heart_rate', 'night_heart_rate', 'oxygen_saturation', 'minimum_oxygen_saturation', 'temperature_deviation', 'respiration_rate', 'body_battery', 'sleep_score');--> statement-breakpoint
ALTER TABLE "recovery_metric_details" ALTER COLUMN "metric" TYPE "public"."recovery_metric" USING "metric"::"public"."recovery_metric";--> statement-breakpoint
ALTER TABLE "recovery_import_records" ALTER COLUMN "metric" TYPE "public"."recovery_metric" USING "metric"::"public"."recovery_metric";--> statement-breakpoint
ALTER TABLE "recovery_metric_details" ADD CONSTRAINT "recovery_metric_details_shape" CHECK ("recovery_metric_details"."value" >= -100 AND "recovery_metric_details"."value" <= 1000
          AND (("recovery_metric_details"."metric" = 'hrv_rmssd' AND "recovery_metric_details"."value" > 0 AND "recovery_metric_details"."unit" = 'ms')
            OR ("recovery_metric_details"."metric" IN ('resting_heart_rate', 'night_heart_rate') AND "recovery_metric_details"."value" > 0 AND "recovery_metric_details"."unit" = 'bpm')
            OR ("recovery_metric_details"."metric" IN ('oxygen_saturation', 'minimum_oxygen_saturation') AND "recovery_metric_details"."value" >= 0 AND "recovery_metric_details"."value" <= 100 AND "recovery_metric_details"."unit" = 'percent')
            OR ("recovery_metric_details"."metric" = 'temperature_deviation' AND "recovery_metric_details"."value" >= -20 AND "recovery_metric_details"."value" <= 20 AND "recovery_metric_details"."unit" = 'celsius')
            OR ("recovery_metric_details"."metric" = 'respiration_rate' AND "recovery_metric_details"."value" > 0 AND "recovery_metric_details"."value" <= 100 AND "recovery_metric_details"."unit" = 'breaths_per_minute')
            OR ("recovery_metric_details"."metric" IN ('body_battery', 'sleep_score') AND "recovery_metric_details"."value" >= 0 AND "recovery_metric_details"."value" <= 100 AND "recovery_metric_details"."unit" = 'score')));
