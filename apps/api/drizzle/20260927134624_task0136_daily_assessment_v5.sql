ALTER TABLE "coaching_daily_assessment_details"
  DROP CONSTRAINT "coaching_daily_assessment_policy_payload";
--> statement-breakpoint
ALTER TABLE "coaching_daily_assessment_details"
  ADD CONSTRAINT "coaching_daily_assessment_policy_payload"
  CHECK (
    (policy_version = 'daily-assessment-v1'
      AND personal_baseline IS NULL
      AND personal_baseline_calculation IS NULL
      AND movement IS NULL)
    OR (policy_version = 'daily-assessment-v2'
      AND personal_baseline IS NOT NULL
      AND personal_baseline_calculation IS NOT NULL
      AND movement IS NULL)
    OR (policy_version IN ('daily-assessment-v3', 'daily-assessment-v4', 'daily-assessment-v5')
      AND personal_baseline IS NOT NULL
      AND personal_baseline_calculation IS NOT NULL
      AND movement IS NOT NULL)
  );
