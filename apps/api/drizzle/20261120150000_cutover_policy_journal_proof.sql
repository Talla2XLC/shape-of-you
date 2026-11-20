ALTER TABLE "integration_cutovers" ADD COLUMN "policy_journal_hash" varchar(64), ADD COLUMN "policy_journal_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "integration_cutovers" ADD CONSTRAINT "integration_cutovers_journal_proof" CHECK ((policy_journal_hash IS NULL) = (policy_journal_at IS NULL));
