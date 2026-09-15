CREATE TABLE "coaching_daily_assessment_recovery_evidence" (
	"recommendation_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	CONSTRAINT "coach_daily_recovery_evidence_pk" PRIMARY KEY("recommendation_id","observation_id")
);
--> statement-breakpoint
ALTER TABLE "coaching_daily_assessment_recovery_evidence" ADD CONSTRAINT "coach_daily_recovery_evidence_recommendation_fk" FOREIGN KEY ("recommendation_id","person_id") REFERENCES "public"."coaching_recommendations"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_daily_assessment_recovery_evidence" ADD CONSTRAINT "coach_daily_recovery_evidence_observation_fk" FOREIGN KEY ("observation_id","person_id") REFERENCES "public"."recovery_observations"("id","person_id") ON DELETE cascade ON UPDATE no action;