CREATE TABLE "scheduled_commands" (
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
--> statement-breakpoint
ALTER TABLE "pest_control_schedules" ADD COLUMN "spray_pump_start_time" text;--> statement-breakpoint
ALTER TABLE "pest_control_schedules" ADD COLUMN "spray_pump_end_time" text;--> statement-breakpoint
ALTER TABLE "scheduled_commands" ADD CONSTRAINT "scheduled_commands_controller_id_controllers_id_fk" FOREIGN KEY ("controller_id") REFERENCES "public"."controllers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_commands" ADD CONSTRAINT "scheduled_commands_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_commands" ADD CONSTRAINT "scheduled_commands_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_commands" ADD CONSTRAINT "scheduled_commands_executed_command_id_commands_id_fk" FOREIGN KEY ("executed_command_id") REFERENCES "public"."commands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_commands_controller_id_idx" ON "scheduled_commands" USING btree ("controller_id");--> statement-breakpoint
CREATE INDEX "scheduled_commands_channel_id_idx" ON "scheduled_commands" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "scheduled_commands_status_idx" ON "scheduled_commands" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scheduled_commands_scheduled_for_idx" ON "scheduled_commands" USING btree ("scheduled_for");