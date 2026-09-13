CREATE INDEX "integration_activity_person_date_idx" ON "integration_activity_facts" USING btree ("person_id","local_date");--> statement-breakpoint
CREATE INDEX "meals_person_date_idx" ON "meals" USING btree ("person_id","local_date");--> statement-breakpoint
CREATE INDEX "recovery_observations_person_date_idx" ON "recovery_observations" USING btree ("person_id","local_date");--> statement-breakpoint
CREATE INDEX "weight_measurements_person_date_idx" ON "weight_measurements" USING btree ("person_id","local_date");--> statement-breakpoint
CREATE INDEX "workout_sessions_person_date_idx" ON "workout_sessions" USING btree ("person_id","local_date");