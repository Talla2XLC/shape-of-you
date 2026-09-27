ALTER TABLE "coaching_daily_assessment_details" DROP CONSTRAINT "coaching_daily_assessment_policy_payload";--> statement-breakpoint
ALTER TABLE "coaching_daily_assessment_details" ADD CONSTRAINT "coaching_daily_assessment_policy_payload" CHECK (("coaching_daily_assessment_details"."policy_version" = 'daily-assessment-v1'
            AND "coaching_daily_assessment_details"."personal_baseline" IS NULL
            AND "coaching_daily_assessment_details"."personal_baseline_calculation" IS NULL
            AND "coaching_daily_assessment_details"."movement" IS NULL)
        OR ("coaching_daily_assessment_details"."policy_version" = 'daily-assessment-v2'
            AND "coaching_daily_assessment_details"."personal_baseline" IS NOT NULL
            AND "coaching_daily_assessment_details"."personal_baseline_calculation" IS NOT NULL
            AND "coaching_daily_assessment_details"."movement" IS NULL)
        OR ("coaching_daily_assessment_details"."policy_version" in ('daily-assessment-v3', 'daily-assessment-v4', 'daily-assessment-v5', 'daily-assessment-v6')
            AND "coaching_daily_assessment_details"."personal_baseline" IS NOT NULL
            AND "coaching_daily_assessment_details"."personal_baseline_calculation" IS NOT NULL
            AND "coaching_daily_assessment_details"."movement" IS NOT NULL));