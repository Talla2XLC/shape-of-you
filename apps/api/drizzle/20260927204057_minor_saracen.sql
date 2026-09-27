ALTER TABLE "recovery_subjective_details" DROP CONSTRAINT "recovery_subjective_details_scales";--> statement-breakpoint
ALTER TABLE "recovery_subjective_details" ALTER COLUMN "energy" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recovery_subjective_details" ALTER COLUMN "fatigue" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recovery_subjective_details" ALTER COLUMN "muscle_soreness" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recovery_subjective_details" ALTER COLUMN "stress" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recovery_subjective_details" ALTER COLUMN "sleep_quality" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recovery_subjective_details" ALTER COLUMN "acute_illness" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recovery_subjective_details" ALTER COLUMN "injury_concern" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recovery_subjective_details" ADD COLUMN "signal" varchar(32);--> statement-breakpoint
ALTER TABLE "recovery_subjective_details" ADD CONSTRAINT "recovery_subjective_details_scales" CHECK (("recovery_subjective_details"."signal" IS NULL
          AND "recovery_subjective_details"."energy" IS NOT NULL AND "recovery_subjective_details"."fatigue" IS NOT NULL
          AND "recovery_subjective_details"."muscle_soreness" IS NOT NULL AND "recovery_subjective_details"."stress" IS NOT NULL
          AND "recovery_subjective_details"."sleep_quality" IS NOT NULL
          AND "recovery_subjective_details"."energy" BETWEEN 1 AND 5
          AND "recovery_subjective_details"."fatigue" BETWEEN 1 AND 5
          AND "recovery_subjective_details"."muscle_soreness" BETWEEN 1 AND 5
          AND "recovery_subjective_details"."stress" BETWEEN 1 AND 5
          AND "recovery_subjective_details"."sleep_quality" BETWEEN 1 AND 5
          AND "recovery_subjective_details"."acute_illness" IS NOT NULL
          AND "recovery_subjective_details"."injury_concern" IS NOT NULL)
          OR ("recovery_subjective_details"."signal" IS NOT NULL
          AND "recovery_subjective_details"."signal" IN ('feeling_well', 'fatigued', 'sore', 'acute_illness', 'injury_concern')
          AND "recovery_subjective_details"."energy" IS NULL AND "recovery_subjective_details"."fatigue" IS NULL
          AND "recovery_subjective_details"."muscle_soreness" IS NULL AND "recovery_subjective_details"."stress" IS NULL
          AND "recovery_subjective_details"."sleep_quality" IS NULL AND "recovery_subjective_details"."acute_illness" IS NULL
          AND "recovery_subjective_details"."injury_concern" IS NULL));