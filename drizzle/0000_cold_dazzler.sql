CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"controller_id" text NOT NULL,
	"channel_id" text,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"meta_json" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"controller_id" text NOT NULL,
	"channel_key" text NOT NULL,
	"name" text NOT NULL,
	"template" text NOT NULL,
	"kind" text NOT NULL,
	"unit" text NOT NULL,
	"min_value" double precision NOT NULL,
	"max_value" double precision NOT NULL,
	"latest_numeric_value" double precision,
	"latest_boolean_state" boolean,
	"latest_status" text DEFAULT 'unknown' NOT NULL,
	"last_sample_at" timestamp with time zone,
	"threshold_low" double precision,
	"threshold_high" double precision,
	"warning_low" double precision,
	"warning_high" double precision,
	"config_json" text DEFAULT '{}' NOT NULL,
	"calibration_json" text DEFAULT '{}' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commands" (
	"id" text PRIMARY KEY NOT NULL,
	"controller_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"command_type" text NOT NULL,
	"desired_boolean_state" boolean,
	"desired_numeric_value" double precision,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"override_until" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"device_message" text
);
--> statement-breakpoint
CREATE TABLE "controllers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"hardware_id" text NOT NULL,
	"device_key_hash" text NOT NULL,
	"location" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"firmware_version" text DEFAULT 'unknown' NOT NULL,
	"heartbeat_interval_sec" integer DEFAULT 60 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"status" text DEFAULT 'offline' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pest_control_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"controller_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"spray_entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uv_start_time" text,
	"uv_end_time" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_samples" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"numeric_value" double precision,
	"boolean_state" boolean,
	"raw_value" double precision,
	"raw_unit" text,
	"status" text DEFAULT 'ok' NOT NULL,
	"payload_json" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"farm_name" text NOT NULL,
	"location" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_controller_id_controllers_id_fk" FOREIGN KEY ("controller_id") REFERENCES "public"."controllers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_controller_id_controllers_id_fk" FOREIGN KEY ("controller_id") REFERENCES "public"."controllers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_controller_id_controllers_id_fk" FOREIGN KEY ("controller_id") REFERENCES "public"."controllers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controllers" ADD CONSTRAINT "controllers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pest_control_schedules" ADD CONSTRAINT "pest_control_schedules_controller_id_controllers_id_fk" FOREIGN KEY ("controller_id") REFERENCES "public"."controllers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_samples" ADD CONSTRAINT "telemetry_samples_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_user_id_idx" ON "alerts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "alerts_controller_id_idx" ON "alerts" USING btree ("controller_id");--> statement-breakpoint
CREATE INDEX "alerts_status_idx" ON "alerts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_controller_key_idx" ON "channels" USING btree ("controller_id","channel_key");--> statement-breakpoint
CREATE INDEX "channels_controller_id_idx" ON "channels" USING btree ("controller_id");--> statement-breakpoint
CREATE INDEX "commands_channel_id_idx" ON "commands" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "commands_controller_id_idx" ON "commands" USING btree ("controller_id");--> statement-breakpoint
CREATE INDEX "commands_status_idx" ON "commands" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "controllers_hardware_id_idx" ON "controllers" USING btree ("hardware_id");--> statement-breakpoint
CREATE INDEX "controllers_user_id_idx" ON "controllers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pest_schedules_controller_idx" ON "pest_control_schedules" USING btree ("controller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "telemetry_channel_recorded_idx" ON "telemetry_samples" USING btree ("channel_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");