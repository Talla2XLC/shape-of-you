CREATE TYPE "public"."recovery_assessment_data_quality" AS ENUM('insufficient', 'limited', 'sufficient');--> statement-breakpoint
CREATE TYPE "public"."recovery_connection_status" AS ENUM('active', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."recovery_consent_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."recovery_metric" AS ENUM('hrv_rmssd', 'resting_heart_rate');--> statement-breakpoint
CREATE TYPE "public"."recovery_metric_unit" AS ENUM('ms', 'bpm');--> statement-breakpoint
CREATE TYPE "public"."recovery_observation_kind" AS ENUM('sleep', 'metric', 'subjective');--> statement-breakpoint
CREATE TYPE "public"."recovery_observation_quality" AS ENUM('reliable', 'estimated', 'poor');--> statement-breakpoint
CREATE TYPE "public"."recovery_retention_mode" AS ENUM('indefinite', 'until');--> statement-breakpoint
CREATE TYPE "public"."recovery_risk_level" AS ENUM('low', 'moderate', 'high', 'blocked');--> statement-breakpoint
ALTER TYPE "public"."source_channel" ADD VALUE 'device';--> statement-breakpoint
CREATE TABLE "recovery_assessment_observation_evidence" (
	"assessment_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	CONSTRAINT "recovery_assessment_observation_evidence_uq" UNIQUE("assessment_id","observation_id")
);
--> statement-breakpoint
CREATE TABLE "recovery_assessment_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(128) NOT NULL,
	"name" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_assessment_policies_key_uq" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "recovery_assessment_policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_until" timestamp with time zone,
	"analysis_window_days" smallint NOT NULL,
	"minimum_observations" smallint NOT NULL,
	"sufficient_observations" smallint NOT NULL,
	"insufficient_confidence_cap" numeric(4, 3) NOT NULL,
	"poor_quality_confidence_cap" numeric(4, 3) NOT NULL,
	"target_sleep_minutes" smallint NOT NULL,
	"fatigue_weight" numeric(6, 3) NOT NULL,
	"soreness_weight" numeric(6, 3) NOT NULL,
	"stress_weight" numeric(6, 3) NOT NULL,
	"low_energy_weight" numeric(6, 3) NOT NULL,
	"low_sleep_quality_weight" numeric(6, 3) NOT NULL,
	"sleep_deficit_weight" numeric(6, 3) NOT NULL,
	"external_set_weight" numeric(6, 3) NOT NULL,
	"bodyweight_set_weight" numeric(6, 3) NOT NULL,
	"assisted_set_weight" numeric(6, 3) NOT NULL,
	"moderate_risk_threshold" numeric(6, 3) NOT NULL,
	"high_risk_threshold" numeric(6, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_assessment_policy_versions_policy_version_uq" UNIQUE("policy_id","version"),
	CONSTRAINT "recovery_assessment_policy_versions_values" CHECK ("recovery_assessment_policy_versions"."version" > 0
          AND "recovery_assessment_policy_versions"."analysis_window_days" > 0
          AND "recovery_assessment_policy_versions"."minimum_observations" > 0
          AND "recovery_assessment_policy_versions"."sufficient_observations" >= "recovery_assessment_policy_versions"."minimum_observations"
          AND "recovery_assessment_policy_versions"."insufficient_confidence_cap" BETWEEN 0 AND 1
          AND "recovery_assessment_policy_versions"."poor_quality_confidence_cap" BETWEEN 0 AND 1
          AND "recovery_assessment_policy_versions"."target_sleep_minutes" > 0
          AND "recovery_assessment_policy_versions"."fatigue_weight" >= 0
          AND "recovery_assessment_policy_versions"."soreness_weight" >= 0
          AND "recovery_assessment_policy_versions"."stress_weight" >= 0
          AND "recovery_assessment_policy_versions"."low_energy_weight" >= 0
          AND "recovery_assessment_policy_versions"."low_sleep_quality_weight" >= 0
          AND "recovery_assessment_policy_versions"."sleep_deficit_weight" >= 0
          AND "recovery_assessment_policy_versions"."external_set_weight" >= 0
          AND "recovery_assessment_policy_versions"."bodyweight_set_weight" >= 0
          AND "recovery_assessment_policy_versions"."assisted_set_weight" >= 0
          AND "recovery_assessment_policy_versions"."moderate_risk_threshold" >= 0
          AND "recovery_assessment_policy_versions"."high_risk_threshold" > "recovery_assessment_policy_versions"."moderate_risk_threshold"
          AND ("recovery_assessment_policy_versions"."effective_until" IS NULL OR "recovery_assessment_policy_versions"."effective_until" > "recovery_assessment_policy_versions"."effective_from"))
);
--> statement-breakpoint
CREATE TABLE "recovery_assessment_training_evidence" (
	"assessment_id" uuid NOT NULL,
	"workout_session_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	CONSTRAINT "recovery_assessment_training_evidence_uq" UNIQUE("assessment_id","workout_session_id")
);
--> statement-breakpoint
CREATE TABLE "recovery_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"readiness_score" numeric(6, 3) NOT NULL,
	"risk_level" "recovery_risk_level" NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"data_quality" "recovery_assessment_data_quality" NOT NULL,
	"hard_stop" boolean NOT NULL,
	"evidence_checksum" varchar(128) NOT NULL,
	"calculation_snapshot" jsonb NOT NULL,
	"dedupe_key" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_assessments_id_person_uq" UNIQUE("id","person_id"),
	CONSTRAINT "recovery_assessments_person_dedupe_uq" UNIQUE("person_id","dedupe_key"),
	CONSTRAINT "recovery_assessments_person_evidence_uq" UNIQUE("person_id","policy_version_id","evidence_checksum"),
	CONSTRAINT "recovery_assessments_values" CHECK ("recovery_assessments"."window_end" >= "recovery_assessments"."window_start"
          AND "recovery_assessments"."readiness_score" BETWEEN 0 AND 100
          AND "recovery_assessments"."confidence" BETWEEN 0 AND 1
          AND (NOT "recovery_assessments"."hard_stop" OR "recovery_assessments"."risk_level" = 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "recovery_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"status" "recovery_connection_status" DEFAULT 'active' NOT NULL,
	"dedupe_key" varchar(256) NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	CONSTRAINT "recovery_connections_id_person_uq" UNIQUE("id","person_id"),
	CONSTRAINT "recovery_connections_person_dedupe_uq" UNIQUE("person_id","dedupe_key"),
	CONSTRAINT "recovery_connections_status_shape" CHECK (("recovery_connections"."status" = 'active' AND "recovery_connections"."disconnected_at" IS NULL)
          OR ("recovery_connections"."status" = 'disconnected' AND "recovery_connections"."disconnected_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "recovery_consent_kinds" (
	"consent_id" uuid NOT NULL,
	"kind" "recovery_observation_kind" NOT NULL,
	CONSTRAINT "recovery_consent_kinds_consent_kind_uq" UNIQUE("consent_id","kind")
);
--> statement-breakpoint
CREATE TABLE "recovery_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"purpose" varchar(512) NOT NULL,
	"retention_mode" "recovery_retention_mode" NOT NULL,
	"retain_until" timestamp with time zone,
	"status" "recovery_consent_status" DEFAULT 'active' NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revocation_reason" varchar(512),
	CONSTRAINT "recovery_consents_id_connection_person_uq" UNIQUE("id","connection_id","person_id"),
	CONSTRAINT "recovery_consents_retention_shape" CHECK (("recovery_consents"."retention_mode" = 'indefinite' AND "recovery_consents"."retain_until" IS NULL)
          OR ("recovery_consents"."retention_mode" = 'until' AND "recovery_consents"."retain_until" IS NOT NULL)),
	CONSTRAINT "recovery_consents_status_shape" CHECK (("recovery_consents"."status" = 'active' AND "recovery_consents"."revoked_at" IS NULL AND "recovery_consents"."revocation_reason" IS NULL)
          OR ("recovery_consents"."status" = 'revoked' AND "recovery_consents"."revoked_at" IS NOT NULL AND "recovery_consents"."revocation_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "recovery_device_capabilities" (
	"model_version_id" uuid NOT NULL,
	"kind" "recovery_observation_kind" NOT NULL,
	CONSTRAINT "recovery_device_capabilities_version_kind_uq" UNIQUE("model_version_id","kind")
);
--> statement-breakpoint
CREATE TABLE "recovery_device_model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_device_model_versions_model_version_uq" UNIQUE("model_id","version"),
	CONSTRAINT "recovery_device_model_versions_id_model_uq" UNIQUE("id","model_id"),
	CONSTRAINT "recovery_device_model_versions_positive" CHECK ("recovery_device_model_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "recovery_device_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"key" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_device_models_provider_key_uq" UNIQUE("provider_id","key")
);
--> statement-breakpoint
CREATE TABLE "recovery_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"model_version_id" uuid NOT NULL,
	"label" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_devices_id_person_uq" UNIQUE("id","person_id"),
	CONSTRAINT "recovery_devices_connection_uq" UNIQUE("connection_id")
);
--> statement-breakpoint
CREATE TABLE "recovery_metric_details" (
	"observation_id" uuid PRIMARY KEY NOT NULL,
	"metric" "recovery_metric" NOT NULL,
	"value" numeric(10, 3) NOT NULL,
	"unit" "recovery_metric_unit" NOT NULL,
	CONSTRAINT "recovery_metric_details_shape" CHECK ("recovery_metric_details"."value" > 0 AND "recovery_metric_details"."value" <= 1000
          AND (("recovery_metric_details"."metric" = 'hrv_rmssd' AND "recovery_metric_details"."unit" = 'ms')
            OR ("recovery_metric_details"."metric" = 'resting_heart_rate' AND "recovery_metric_details"."unit" = 'bpm')))
);
--> statement-breakpoint
CREATE TABLE "recovery_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "recovery_observation_kind" NOT NULL,
	"observed_from" timestamp with time zone NOT NULL,
	"observed_until" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"quality" "recovery_observation_quality" NOT NULL,
	"source" "source_channel" NOT NULL,
	"source_reference_id" uuid NOT NULL,
	"connection_id" uuid,
	"consent_id" uuid,
	"dedupe_key" varchar(256) NOT NULL,
	"supersedes_id" uuid,
	"correction_reason" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_observations_id_person_uq" UNIQUE("id","person_id"),
	CONSTRAINT "recovery_observations_time_order" CHECK ("recovery_observations"."observed_until" >= "recovery_observations"."observed_from"),
	CONSTRAINT "recovery_observations_device_shape" CHECK (("recovery_observations"."source" = 'device' AND "recovery_observations"."connection_id" IS NOT NULL AND "recovery_observations"."consent_id" IS NOT NULL)
          OR ("recovery_observations"."source" <> 'device' AND "recovery_observations"."connection_id" IS NULL AND "recovery_observations"."consent_id" IS NULL)),
	CONSTRAINT "recovery_observations_correction_shape" CHECK (("recovery_observations"."supersedes_id" IS NULL AND "recovery_observations"."correction_reason" IS NULL)
          OR ("recovery_observations"."supersedes_id" IS NOT NULL AND "recovery_observations"."correction_reason" IS NOT NULL)),
	CONSTRAINT "recovery_observations_no_self_supersession" CHECK ("recovery_observations"."supersedes_id" IS NULL OR "recovery_observations"."supersedes_id" <> "recovery_observations"."id")
);
--> statement-breakpoint
CREATE TABLE "recovery_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(128) NOT NULL,
	"name" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_providers_key_uq" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "recovery_sleep_details" (
	"observation_id" uuid PRIMARY KEY NOT NULL,
	"total_sleep_minutes" smallint NOT NULL,
	"sleep_quality" smallint,
	CONSTRAINT "recovery_sleep_details_values" CHECK ("recovery_sleep_details"."total_sleep_minutes" >= 0 AND "recovery_sleep_details"."total_sleep_minutes" <= 1440
          AND ("recovery_sleep_details"."sleep_quality" IS NULL OR ("recovery_sleep_details"."sleep_quality" >= 1 AND "recovery_sleep_details"."sleep_quality" <= 5)))
);
--> statement-breakpoint
CREATE TABLE "recovery_subjective_details" (
	"observation_id" uuid PRIMARY KEY NOT NULL,
	"energy" smallint NOT NULL,
	"fatigue" smallint NOT NULL,
	"muscle_soreness" smallint NOT NULL,
	"stress" smallint NOT NULL,
	"sleep_quality" smallint NOT NULL,
	"acute_illness" boolean NOT NULL,
	"injury_concern" boolean NOT NULL,
	CONSTRAINT "recovery_subjective_details_scales" CHECK ("recovery_subjective_details"."energy" BETWEEN 1 AND 5
          AND "recovery_subjective_details"."fatigue" BETWEEN 1 AND 5
          AND "recovery_subjective_details"."muscle_soreness" BETWEEN 1 AND 5
          AND "recovery_subjective_details"."stress" BETWEEN 1 AND 5
          AND "recovery_subjective_details"."sleep_quality" BETWEEN 1 AND 5)
);
--> statement-breakpoint
ALTER TABLE "recovery_assessment_observation_evidence" ADD CONSTRAINT "recovery_assessment_observation_assessment_fk" FOREIGN KEY ("assessment_id","person_id") REFERENCES "public"."recovery_assessments"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_assessment_observation_evidence" ADD CONSTRAINT "recovery_assessment_observation_observation_fk" FOREIGN KEY ("observation_id","person_id") REFERENCES "public"."recovery_observations"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_assessment_policy_versions" ADD CONSTRAINT "recovery_assessment_policy_version_policy_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."recovery_assessment_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_assessment_training_evidence" ADD CONSTRAINT "recovery_assessment_training_assessment_fk" FOREIGN KEY ("assessment_id","person_id") REFERENCES "public"."recovery_assessments"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_assessment_training_evidence" ADD CONSTRAINT "recovery_assessment_training_session_fk" FOREIGN KEY ("workout_session_id","person_id") REFERENCES "public"."workout_sessions"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_assessments" ADD CONSTRAINT "recovery_assessment_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_assessments" ADD CONSTRAINT "recovery_assessment_policy_version_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."recovery_assessment_policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_connections" ADD CONSTRAINT "recovery_connection_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_connections" ADD CONSTRAINT "recovery_connection_provider_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."recovery_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_consent_kinds" ADD CONSTRAINT "recovery_consent_kind_consent_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."recovery_consents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_consents" ADD CONSTRAINT "recovery_consent_connection_person_fk" FOREIGN KEY ("connection_id","person_id") REFERENCES "public"."recovery_connections"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_device_capabilities" ADD CONSTRAINT "recovery_device_capability_version_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."recovery_device_model_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_device_model_versions" ADD CONSTRAINT "recovery_device_model_version_model_fk" FOREIGN KEY ("model_id") REFERENCES "public"."recovery_device_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_device_models" ADD CONSTRAINT "recovery_device_model_provider_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."recovery_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_devices" ADD CONSTRAINT "recovery_device_connection_person_fk" FOREIGN KEY ("connection_id","person_id") REFERENCES "public"."recovery_connections"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_devices" ADD CONSTRAINT "recovery_device_model_version_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."recovery_device_model_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_metric_details" ADD CONSTRAINT "recovery_metric_detail_observation_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."recovery_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_observations" ADD CONSTRAINT "recovery_observation_source_person_fk" FOREIGN KEY ("source_reference_id","person_id") REFERENCES "public"."source_references"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_observations" ADD CONSTRAINT "recovery_observation_consent_connection_fk" FOREIGN KEY ("consent_id","connection_id","person_id") REFERENCES "public"."recovery_consents"("id","connection_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_observations" ADD CONSTRAINT "recovery_observation_supersedes_person_fk" FOREIGN KEY ("supersedes_id","person_id") REFERENCES "public"."recovery_observations"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_sleep_details" ADD CONSTRAINT "recovery_sleep_detail_observation_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."recovery_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_subjective_details" ADD CONSTRAINT "recovery_subjective_detail_observation_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."recovery_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_observations_person_source_dedupe_uq" ON "recovery_observations" USING btree ("person_id","source","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_observations_supersedes_uq" ON "recovery_observations" USING btree ("supersedes_id") WHERE "recovery_observations"."supersedes_id" IS NOT NULL;
