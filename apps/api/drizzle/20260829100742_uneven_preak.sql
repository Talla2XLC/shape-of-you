DROP TABLE "day_closure_operations" CASCADE;--> statement-breakpoint
DROP TABLE "day_closure_references" CASCADE;--> statement-breakpoint
DROP TABLE "day_closures" CASCADE;--> statement-breakpoint
DROP TABLE "nutrition_day_closure_import_records" CASCADE;--> statement-breakpoint
ALTER TYPE "public"."chat_assistant_surface" RENAME VALUE 'chatgpt_work' TO 'chatgpt_chat';--> statement-breakpoint
DROP TYPE "public"."day_closure_operation";--> statement-breakpoint
DROP TYPE "public"."day_closure_reference_kind";--> statement-breakpoint
DROP TYPE "public"."day_closure_status";
