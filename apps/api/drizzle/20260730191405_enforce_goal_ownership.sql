ALTER TABLE "physical_goal_versions" DROP CONSTRAINT "physical_goal_versions_id_goal_uq";--> statement-breakpoint
ALTER TABLE "physical_goal_versions" DROP CONSTRAINT "physical_goal_versions_goal_id_physical_goals_id_fk";
--> statement-breakpoint
ALTER TABLE "physical_goals" DROP CONSTRAINT "physical_goals_current_version_id_physical_goal_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "physical_goal_versions" ADD CONSTRAINT "physical_goal_versions_same_goal_person_fk" FOREIGN KEY ("goal_id","person_id") REFERENCES "public"."physical_goals"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_goal_versions" ADD CONSTRAINT "physical_goal_versions_id_goal_person_uq" UNIQUE("id","goal_id","person_id");--> statement-breakpoint
ALTER TABLE "physical_goals" ADD CONSTRAINT "physical_goals_current_version_same_goal_person_fk" FOREIGN KEY ("current_version_id","id","person_id") REFERENCES "public"."physical_goal_versions"("id","goal_id","person_id") ON DELETE no action ON UPDATE no action;
