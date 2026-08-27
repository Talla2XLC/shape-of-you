CREATE TYPE "public"."chat_assistant_binding_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."chat_assistant_surface" AS ENUM('chatgpt_work');--> statement-breakpoint
CREATE TABLE "chat_assistant_conversation_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"surface" "chat_assistant_surface" NOT NULL,
	"external_conversation_id" varchar(128) NOT NULL,
	"status" "chat_assistant_binding_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_assistant_binding_external_id_shape" CHECK ("chat_assistant_conversation_bindings"."external_conversation_id" ~ '^[A-Za-z0-9_-]{16,128}$')
);
--> statement-breakpoint
ALTER TABLE "chat_assistant_conversation_bindings" ADD CONSTRAINT "chat_assistant_conversation_bindings_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_assistant_binding_active_uq" ON "chat_assistant_conversation_bindings" USING btree ("person_id","surface") WHERE "chat_assistant_conversation_bindings"."status" = 'active';