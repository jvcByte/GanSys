import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    farmName: text("farm_name").notNull(),
    location: text("location").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)]
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("sessions_token_hash_idx").on(table.tokenHash), index("sessions_user_id_idx").on(table.userId)]
);

export const controllers = pgTable(
  "controllers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    hardwareId: text("hardware_id").notNull(),
    deviceKeyHash: text("device_key_hash").notNull(),
    location: text("location").notNull(),
    description: text("description").notNull().default(""),
    firmwareVersion: text("firmware_version").notNull().default("unknown"),
    heartbeatIntervalSec: integer("heartbeat_interval_sec").notNull().default(60),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    status: text("status").notNull().default("offline"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("controllers_hardware_id_idx").on(table.hardwareId),
    index("controllers_user_id_idx").on(table.userId),
  ]
);

export const channels = pgTable(
  "channels",
  {
    id: text("id").primaryKey(),
    controllerId: text("controller_id").notNull().references(() => controllers.id, { onDelete: "cascade" }),
    channelKey: text("channel_key").notNull(),
    name: text("name").notNull(),
    template: text("template").notNull(),
    kind: text("kind").notNull(),
    unit: text("unit").notNull(),
    minValue: doublePrecision("min_value").notNull(),
    maxValue: doublePrecision("max_value").notNull(),
    latestNumericValue: doublePrecision("latest_numeric_value"),
    latestBooleanState: boolean("latest_boolean_state"),
    latestStatus: text("latest_status").notNull().default("unknown"),
    lastSampleAt: timestamp("last_sample_at", { withTimezone: true }),
    thresholdLow: doublePrecision("threshold_low"),
    thresholdHigh: doublePrecision("threshold_high"),
    warningLow: doublePrecision("warning_low"),
    warningHigh: doublePrecision("warning_high"),
    configJson: text("config_json").notNull().default("{}"),
    calibrationJson: text("calibration_json").notNull().default("{}"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("channels_controller_key_idx").on(table.controllerId, table.channelKey),
    index("channels_controller_id_idx").on(table.controllerId),
  ]
);

export const telemetrySamples = pgTable(
  "telemetry_samples",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    numericValue: doublePrecision("numeric_value"),
    booleanState: boolean("boolean_state"),
    rawValue: doublePrecision("raw_value"),
    rawUnit: text("raw_unit"),
    status: text("status").notNull().default("ok"),
    payloadJson: text("payload_json").notNull().default("{}"),
  },
  (table) => [index("telemetry_channel_recorded_idx").on(table.channelId, table.recordedAt)]
);

export const commands = pgTable(
  "commands",
  {
    id: text("id").primaryKey(),
    controllerId: text("controller_id").notNull().references(() => controllers.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    requestedByUserId: text("requested_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    commandType: text("command_type").notNull(),
    desiredBooleanState: boolean("desired_boolean_state"),
    desiredNumericValue: doublePrecision("desired_numeric_value"),
    note: text("note").notNull().default(""),
    status: text("status").notNull().default("pending"),
    overrideUntil: timestamp("override_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    deviceMessage: text("device_message"),
  },
  (table) => [
    index("commands_channel_id_idx").on(table.channelId),
    index("commands_controller_id_idx").on(table.controllerId),
    index("commands_status_idx").on(table.status),
  ]
);

export const alerts = pgTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    controllerId: text("controller_id").notNull().references(() => controllers.id, { onDelete: "cascade" }),
    channelId: text("channel_id").references(() => channels.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    severity: text("severity").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    status: text("status").notNull().default("open"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    metaJson: text("meta_json").notNull().default("{}"),
  },
  (table) => [
    index("alerts_user_id_idx").on(table.userId),
    index("alerts_controller_id_idx").on(table.controllerId),
    index("alerts_status_idx").on(table.status),
  ]
);

export const pestControlSchedules = pgTable(
  "pest_control_schedules",
  {
    id: text("id").primaryKey(),
    controllerId: text("controller_id")
      .notNull()
      .references(() => controllers.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    sprayEntries: jsonb("spray_entries")
      .$type<Array<{ startTime: string; durationMinutes: number }>>()
      .notNull()
      .default([]),
    uvStartTime: text("uv_start_time"),
    uvEndTime: text("uv_end_time"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("pest_schedules_controller_idx").on(table.controllerId)]
);

export const scheduledCommands = pgTable(
  "scheduled_commands",
  {
    id: text("id").primaryKey(),
    controllerId: text("controller_id").notNull().references(() => controllers.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    requestedByUserId: text("requested_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    commandType: text("command_type").notNull(),
    desiredBooleanState: boolean("desired_boolean_state"),
    desiredNumericValue: doublePrecision("desired_numeric_value"),
    note: text("note").notNull().default(""),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"), // pending, executed, cancelled, failed
    executedCommandId: text("executed_command_id").references(() => commands.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
  },
  (table) => [
    index("scheduled_commands_controller_id_idx").on(table.controllerId),
    index("scheduled_commands_channel_id_idx").on(table.channelId),
    index("scheduled_commands_status_idx").on(table.status),
    index("scheduled_commands_scheduled_for_idx").on(table.scheduledFor),
  ]
);
