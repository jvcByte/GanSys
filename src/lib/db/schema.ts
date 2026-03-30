import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    farmName: text("farm_name").notNull(),
    location: text("location").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)]
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [uniqueIndex("sessions_token_hash_idx").on(table.tokenHash), index("sessions_user_id_idx").on(table.userId)]
);

export const controllers = sqliteTable(
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
    lastSeenAt: text("last_seen_at"),
    status: text("status").notNull().default("offline"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("controllers_hardware_id_idx").on(table.hardwareId),
    index("controllers_user_id_idx").on(table.userId),
  ]
);

export const channels = sqliteTable(
  "channels",
  {
    id: text("id").primaryKey(),
    controllerId: text("controller_id").notNull().references(() => controllers.id, { onDelete: "cascade" }),
    channelKey: text("channel_key").notNull(),
    name: text("name").notNull(),
    template: text("template").notNull(),
    kind: text("kind").notNull(),
    unit: text("unit").notNull(),
    minValue: real("min_value").notNull(),
    maxValue: real("max_value").notNull(),
    latestNumericValue: real("latest_numeric_value"),
    latestBooleanState: integer("latest_boolean_state", { mode: "boolean" }),
    latestStatus: text("latest_status").notNull().default("unknown"),
    lastSampleAt: text("last_sample_at"),
    thresholdLow: real("threshold_low"),
    thresholdHigh: real("threshold_high"),
    warningLow: real("warning_low"),
    warningHigh: real("warning_high"),
    configJson: text("config_json").notNull().default("{}"),
    calibrationJson: text("calibration_json").notNull().default("{}"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("channels_controller_key_idx").on(table.controllerId, table.channelKey),
    index("channels_controller_id_idx").on(table.controllerId),
  ]
);

export const telemetrySamples = sqliteTable(
  "telemetry_samples",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    recordedAt: text("recorded_at").notNull(),
    numericValue: real("numeric_value"),
    booleanState: integer("boolean_state", { mode: "boolean" }),
    rawValue: real("raw_value"),
    rawUnit: text("raw_unit"),
    status: text("status").notNull().default("ok"),
    payloadJson: text("payload_json").notNull().default("{}"),
  },
  (table) => [index("telemetry_channel_recorded_idx").on(table.channelId, table.recordedAt)]
);

export const commands = sqliteTable(
  "commands",
  {
    id: text("id").primaryKey(),
    controllerId: text("controller_id").notNull().references(() => controllers.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    requestedByUserId: text("requested_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    commandType: text("command_type").notNull(),
    desiredBooleanState: integer("desired_boolean_state", { mode: "boolean" }),
    desiredNumericValue: real("desired_numeric_value"),
    note: text("note").notNull().default(""),
    status: text("status").notNull().default("pending"),
    overrideUntil: text("override_until"),
    createdAt: text("created_at").notNull(),
    acknowledgedAt: text("acknowledged_at"),
    deviceMessage: text("device_message"),
  },
  (table) => [
    index("commands_channel_id_idx").on(table.channelId),
    index("commands_controller_id_idx").on(table.controllerId),
    index("commands_status_idx").on(table.status),
  ]
);

export const alerts = sqliteTable(
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
    openedAt: text("opened_at").notNull(),
    resolvedAt: text("resolved_at"),
    metaJson: text("meta_json").notNull().default("{}"),
  },
  (table) => [
    index("alerts_user_id_idx").on(table.userId),
    index("alerts_controller_id_idx").on(table.controllerId),
    index("alerts_status_idx").on(table.status),
  ]
);
