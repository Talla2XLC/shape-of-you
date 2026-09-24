ALTER TYPE "public"."recovery_metric" ADD VALUE 'garmin_post_activity_recovery_time' BEFORE 'steps';--> statement-breakpoint
ALTER TYPE "public"."recovery_metric_unit" ADD VALUE 'minute';--> statement-breakpoint
ALTER TABLE "recovery_metric_details" DROP CONSTRAINT "recovery_metric_details_shape";--> statement-breakpoint
ALTER TABLE "recovery_metric_details" ADD CONSTRAINT "recovery_metric_details_shape" CHECK ("recovery_metric_details"."value" >= -100 AND "recovery_metric_details"."value" <= 1000000
          AND (("recovery_metric_details"."metric" = 'hrv_rmssd' AND "recovery_metric_details"."value" > 0 AND "recovery_metric_details"."unit" = 'ms')
            OR ("recovery_metric_details"."metric" IN ('resting_heart_rate', 'night_heart_rate') AND "recovery_metric_details"."value" > 0 AND "recovery_metric_details"."unit" = 'bpm')
            OR ("recovery_metric_details"."metric" IN ('oxygen_saturation', 'minimum_oxygen_saturation') AND "recovery_metric_details"."value" >= 0 AND "recovery_metric_details"."value" <= 100 AND "recovery_metric_details"."unit" = 'percent')
            OR ("recovery_metric_details"."metric" = 'temperature_deviation' AND "recovery_metric_details"."value" >= -20 AND "recovery_metric_details"."value" <= 20 AND "recovery_metric_details"."unit" = 'celsius')
            OR ("recovery_metric_details"."metric" = 'respiration_rate' AND "recovery_metric_details"."value" > 0 AND "recovery_metric_details"."value" <= 100 AND "recovery_metric_details"."unit" = 'breaths_per_minute')
            OR ("recovery_metric_details"."metric" IN ('body_battery', 'body_battery_min', 'body_battery_max', 'sleep_score') AND "recovery_metric_details"."value" >= 0 AND "recovery_metric_details"."value" <= 100 AND "recovery_metric_details"."unit" = 'score')
            OR ("recovery_metric_details"."metric" = 'steps' AND "recovery_metric_details"."value" >= 0 AND "recovery_metric_details"."value" <= 1000000 AND trunc("recovery_metric_details"."value") = "recovery_metric_details"."value" AND "recovery_metric_details"."unit" = 'count')
            OR ("recovery_metric_details"."metric"::text = 'garmin_post_activity_recovery_time' AND "recovery_metric_details"."value" >= 0 AND "recovery_metric_details"."value" <= 65534 AND trunc("recovery_metric_details"."value") = "recovery_metric_details"."value" AND "recovery_metric_details"."unit"::text = 'minute')));
