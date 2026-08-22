ALTER TABLE "scheduled_commands" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduled_commands" ADD COLUMN "occurrence_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_commands_occurrence_key_idx" ON "scheduled_commands" USING btree ("occurrence_key");