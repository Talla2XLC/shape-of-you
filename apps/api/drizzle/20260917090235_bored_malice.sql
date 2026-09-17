CREATE TABLE "coaching_daily_assessment_training_evidence" (
	"recommendation_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	CONSTRAINT "coach_daily_training_evidence_pk" PRIMARY KEY("recommendation_id","activity_id")
);
--> statement-breakpoint
ALTER TABLE "coaching_daily_assessment_details" ADD COLUMN "personal_baseline" jsonb;--> statement-breakpoint
ALTER TABLE "coaching_daily_assessment_details" ADD COLUMN "personal_baseline_calculation" jsonb;--> statement-breakpoint
ALTER TABLE "integration_activity_facts" ADD COLUMN "training_load_basis" varchar(64);--> statement-breakpoint
ALTER TABLE "integration_activity_facts" ADD COLUMN "training_load_basis_version" varchar(128);--> statement-breakpoint
UPDATE "integration_activity_facts"
   SET "training_load_basis" = 'relative_training_stress',
       "training_load_basis_version" = 'intervals-icu-icu-training-load-v1'
 WHERE "source_provider" = 'intervals_icu'
   AND "training_load" IS NOT NULL
   AND "training_load_basis" IS NULL
   AND "training_load_basis_version" IS NULL;--> statement-breakpoint
ALTER TABLE "integration_activity_facts" ADD CONSTRAINT "integration_activity_id_person_uq" UNIQUE("id","person_id");--> statement-breakpoint
ALTER TABLE "coaching_daily_assessment_training_evidence" ADD CONSTRAINT "coach_daily_training_evidence_recommendation_fk" FOREIGN KEY ("recommendation_id","person_id") REFERENCES "public"."coaching_recommendations"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_daily_assessment_training_evidence" ADD CONSTRAINT "coach_daily_training_evidence_activity_fk" FOREIGN KEY ("activity_id","person_id") REFERENCES "public"."integration_activity_facts"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "coaching_daily_assessment_details" detail
      CROSS JOIN LATERAL jsonb_array_elements_text(
        COALESCE(detail."used_facts" -> 'externalActivityIds', '[]'::jsonb)
      ) evidence(activity_id)
      LEFT JOIN "integration_activity_facts" activity
        ON activity."id" = evidence.activity_id::uuid
       AND activity."person_id" = detail."person_id"
     WHERE activity."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'daily assessment training evidence backfill found missing or cross-owner activity IDs';
  END IF;
END
$$;--> statement-breakpoint
INSERT INTO "coaching_daily_assessment_training_evidence"
  ("recommendation_id", "person_id", "activity_id")
SELECT detail."recommendation_id", detail."person_id", evidence.activity_id::uuid
  FROM "coaching_daily_assessment_details" detail
  CROSS JOIN LATERAL jsonb_array_elements_text(
    COALESCE(detail."used_facts" -> 'externalActivityIds', '[]'::jsonb)
  ) evidence(activity_id)
  JOIN "integration_activity_facts" activity
    ON activity."id" = evidence.activity_id::uuid
   AND activity."person_id" = detail."person_id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "coaching_daily_assessment_details" ADD CONSTRAINT "coaching_daily_assessment_policy_payload" CHECK (("coaching_daily_assessment_details"."policy_version" = 'daily-assessment-v1'
            AND "coaching_daily_assessment_details"."personal_baseline" IS NULL
            AND "coaching_daily_assessment_details"."personal_baseline_calculation" IS NULL)
        OR ("coaching_daily_assessment_details"."policy_version" = 'daily-assessment-v2'
            AND "coaching_daily_assessment_details"."personal_baseline" IS NOT NULL
            AND "coaching_daily_assessment_details"."personal_baseline_calculation" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "integration_activity_facts" ADD CONSTRAINT "integration_activity_load_semantics_shape" CHECK (("integration_activity_facts"."training_load_basis" IS NULL AND "integration_activity_facts"."training_load_basis_version" IS NULL)
        OR ("integration_activity_facts"."training_load_basis" IS NOT NULL AND "integration_activity_facts"."training_load_basis_version" IS NOT NULL));
