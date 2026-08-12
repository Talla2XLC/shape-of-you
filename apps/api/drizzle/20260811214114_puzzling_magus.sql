ALTER TABLE "day_closure_operations" ADD COLUMN "actor_person_id" uuid;--> statement-breakpoint
ALTER TABLE "day_closure_operations" ADD COLUMN "source" "source_channel";--> statement-breakpoint
ALTER TABLE "day_closures" ADD COLUMN "closed_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "day_closures" ADD COLUMN "source" "source_channel";--> statement-breakpoint
UPDATE "day_closure_operations" SET "actor_person_id" = "person_id", "source" = 'manual' WHERE "actor_person_id" IS NULL;--> statement-breakpoint
UPDATE "day_closures" SET "closed_by_person_id" = "person_id", "source" = 'manual' WHERE "closed_by_person_id" IS NULL;--> statement-breakpoint
ALTER TABLE "day_closure_operations" ALTER COLUMN "actor_person_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "day_closure_operations" ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "day_closures" ALTER COLUMN "closed_by_person_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "day_closures" ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "day_closure_operations" ADD CONSTRAINT "day_closure_operations_actor_person_id_persons_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_closures" ADD CONSTRAINT "day_closures_closed_by_person_id_persons_id_fk" FOREIGN KEY ("closed_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_closure_operations" ADD CONSTRAINT "day_closure_ops_actor_is_owner" CHECK ("day_closure_operations"."actor_person_id" = "day_closure_operations"."person_id");--> statement-breakpoint
ALTER TABLE "day_closures" ADD CONSTRAINT "day_closures_actor_is_owner" CHECK ("day_closures"."closed_by_person_id" = "day_closures"."person_id");
