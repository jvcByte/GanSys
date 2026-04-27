-- Add scheduled_commands table
CREATE TABLE IF NOT EXISTS "scheduled_commands" (
	"id" text PRIMARY KEY NOT NULL,
	"controller_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"command_type" text NOT NULL,
	"desired_boolean_state" boolean,
	"desired_numeric_value" double precision,
	"note" text DEFAULT '' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"executed_command_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"failure_reason" text
);

-- Add foreign key constraints
ALTER TABLE "scheduled_commands" ADD CONSTRAINT "scheduled_commands_controller_id_controllers_id_fk" FOREIGN KEY ("controller_id") REFERENCES "controllers"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "scheduled_commands" ADD CONSTRAINT "scheduled_commands_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "scheduled_commands" ADD CONSTRAINT "scheduled_commands_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "scheduled_commands" ADD CONSTRAINT "scheduled_commands_executed_command_id_commands_id_fk" FOREIGN KEY ("executed_command_id") REFERENCES "commands"("id") ON DELETE set null ON UPDATE no action;

-- Add indexes
CREATE INDEX IF NOT EXISTS "scheduled_commands_controller_id_idx" ON "scheduled_commands" ("controller_id");
CREATE INDEX IF NOT EXISTS "scheduled_commands_channel_id_idx" ON "scheduled_commands" ("channel_id");
CREATE INDEX IF NOT EXISTS "scheduled_commands_status_idx" ON "scheduled_commands" ("status");
CREATE INDEX IF NOT EXISTS "scheduled_commands_scheduled_for_idx" ON "scheduled_commands" ("scheduled_for");
