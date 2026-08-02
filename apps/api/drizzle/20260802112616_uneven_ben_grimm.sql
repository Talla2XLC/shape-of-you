CREATE TYPE "public"."intake_item_kind" AS ENUM('weight_measurement');--> statement-breakpoint
CREATE TYPE "public"."intake_item_status" AS ENUM('needs_clarification', 'awaiting_confirmation', 'queued', 'processing', 'completed', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."intake_job_kind" AS ENUM('parse_request', 'parse_clarification', 'route_item');--> statement-breakpoint
CREATE TYPE "public"."intake_job_status" AS ENUM('available', 'leased', 'completed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."intake_parsing_status" AS ENUM('queued', 'processing', 'parsed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."intake_timeline_event" AS ENUM('received', 'parsing_started', 'items_parsed', 'clarification_requested', 'clarification_submitted', 'confirmed', 'rejected', 'routing_started', 'completed', 'retry_scheduled', 'failed');--> statement-breakpoint
CREATE TABLE "intake_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"kind" "intake_item_kind" NOT NULL,
	"status" "intake_item_status" NOT NULL,
	"confidence" numeric(4, 3),
	"clarification_question" varchar(2000),
	"clarification_answer" varchar(2000),
	"clarification_idempotency_key" varchar(256),
	"decision_idempotency_key" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_items_id_person_uq" UNIQUE("id","person_id"),
	CONSTRAINT "intake_items_request_position_uq" UNIQUE("request_id","position"),
	CONSTRAINT "intake_items_position_nonnegative" CHECK ("intake_items"."position" >= 0),
	CONSTRAINT "intake_items_confidence_range" CHECK ("intake_items"."confidence" IS NULL OR ("intake_items"."confidence" >= 0 AND "intake_items"."confidence" <= 1)),
	CONSTRAINT "intake_items_clarification_shape" CHECK (("intake_items"."status" = 'needs_clarification') = ("intake_items"."clarification_question" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "intake_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"item_id" uuid,
	"kind" "intake_job_kind" NOT NULL,
	"job_key" varchar(256) NOT NULL,
	"status" "intake_job_status" DEFAULT 'available' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"leased_until" timestamp with time zone,
	"lease_token" uuid,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"max_attempts" smallint DEFAULT 5 NOT NULL,
	"error_code" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "intake_jobs_person_key_uq" UNIQUE("person_id","job_key"),
	CONSTRAINT "intake_jobs_attempt_limits" CHECK ("intake_jobs"."attempts" >= 0 AND "intake_jobs"."max_attempts" > 0 AND "intake_jobs"."attempts" <= "intake_jobs"."max_attempts"),
	CONSTRAINT "intake_jobs_lease_shape" CHECK (("intake_jobs"."status" = 'leased') = ("intake_jobs"."leased_until" IS NOT NULL AND "intake_jobs"."lease_token" IS NOT NULL)),
	CONSTRAINT "intake_jobs_completion_shape" CHECK (("intake_jobs"."status" = 'completed') = ("intake_jobs"."completed_at" IS NOT NULL)),
	CONSTRAINT "intake_jobs_item_shape" CHECK (("intake_jobs"."kind" = 'parse_request' AND "intake_jobs"."item_id" IS NULL) OR ("intake_jobs"."kind" <> 'parse_request' AND "intake_jobs"."item_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "intake_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"source" "source_channel" NOT NULL,
	"source_reference_id" uuid NOT NULL,
	"original_text" text NOT NULL,
	"locale" varchar(35) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"idempotency_key" varchar(256) NOT NULL,
	"parsing_status" "intake_parsing_status" DEFAULT 'queued' NOT NULL,
	"failure_code" varchar(128),
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_requests_id_person_uq" UNIQUE("id","person_id"),
	CONSTRAINT "intake_requests_person_source_dedupe_uq" UNIQUE("person_id","source","idempotency_key"),
	CONSTRAINT "intake_requests_failure_state" CHECK (("intake_requests"."parsing_status" = 'failed') = ("intake_requests"."failure_code" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "intake_timeline_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"item_id" uuid,
	"event" "intake_timeline_event" NOT NULL,
	"detail_code" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_weight_details" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"weight_kg" numeric(6, 3) NOT NULL,
	"dedupe_key" varchar(256) NOT NULL,
	"measurement_id" uuid,
	CONSTRAINT "intake_weight_details_weight_range" CHECK ("intake_weight_details"."weight_kg" >= 0.500 AND "intake_weight_details"."weight_kg" <= 700.000)
);
--> statement-breakpoint
ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_request_person_fk" FOREIGN KEY ("request_id","person_id") REFERENCES "public"."intake_requests"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_jobs" ADD CONSTRAINT "intake_jobs_request_person_fk" FOREIGN KEY ("request_id","person_id") REFERENCES "public"."intake_requests"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_jobs" ADD CONSTRAINT "intake_jobs_item_person_fk" FOREIGN KEY ("item_id","person_id") REFERENCES "public"."intake_items"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_requests" ADD CONSTRAINT "intake_requests_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_requests" ADD CONSTRAINT "intake_requests_source_person_fk" FOREIGN KEY ("source_reference_id","person_id") REFERENCES "public"."source_references"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_timeline_entries" ADD CONSTRAINT "intake_timeline_request_person_fk" FOREIGN KEY ("request_id","person_id") REFERENCES "public"."intake_requests"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_timeline_entries" ADD CONSTRAINT "intake_timeline_item_person_fk" FOREIGN KEY ("item_id","person_id") REFERENCES "public"."intake_items"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_weight_details" ADD CONSTRAINT "intake_weight_detail_item_person_fk" FOREIGN KEY ("item_id","person_id") REFERENCES "public"."intake_items"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_weight_details" ADD CONSTRAINT "intake_weight_detail_measurement_person_fk" FOREIGN KEY ("measurement_id","person_id") REFERENCES "public"."weight_measurements"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intake_items_request_status_idx" ON "intake_items" USING btree ("request_id","status");--> statement-breakpoint
CREATE INDEX "intake_jobs_available_idx" ON "intake_jobs" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE INDEX "intake_timeline_request_created_idx" ON "intake_timeline_entries" USING btree ("request_id","created_at");