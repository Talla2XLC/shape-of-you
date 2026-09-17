CREATE TABLE "coaching_daily_assessment_assessment_evidence" (
	"recommendation_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	CONSTRAINT "coach_daily_assessment_evidence_pk" PRIMARY KEY("recommendation_id","assessment_id")
);
--> statement-breakpoint
ALTER TABLE "coaching_daily_assessment_assessment_evidence" ADD CONSTRAINT "coach_daily_assessment_evidence_recommendation_fk" FOREIGN KEY ("recommendation_id","person_id") REFERENCES "public"."coaching_recommendations"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_daily_assessment_assessment_evidence" ADD CONSTRAINT "coach_daily_assessment_evidence_assessment_fk" FOREIGN KEY ("assessment_id","person_id") REFERENCES "public"."recovery_assessments"("id","person_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "coaching_daily_assessment_details" detail
      CROSS JOIN LATERAL jsonb_array_elements_text(
        COALESCE(detail."used_facts" -> 'recoveryAssessmentIds', '[]'::jsonb)
      ) evidence(assessment_id)
      LEFT JOIN "recovery_assessments" assessment
        ON assessment."id" = evidence.assessment_id::uuid
       AND assessment."person_id" = detail."person_id"
     WHERE assessment."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'daily assessment Recovery evidence backfill found missing or cross-owner assessment IDs';
  END IF;
END
$$;--> statement-breakpoint
INSERT INTO "coaching_daily_assessment_assessment_evidence"
  ("recommendation_id", "person_id", "assessment_id")
SELECT detail."recommendation_id", detail."person_id", evidence.assessment_id::uuid
  FROM "coaching_daily_assessment_details" detail
  CROSS JOIN LATERAL jsonb_array_elements_text(
    COALESCE(detail."used_facts" -> 'recoveryAssessmentIds', '[]'::jsonb)
  ) evidence(assessment_id)
  JOIN "recovery_assessments" assessment
    ON assessment."id" = evidence.assessment_id::uuid
   AND assessment."person_id" = detail."person_id"
ON CONFLICT DO NOTHING;
