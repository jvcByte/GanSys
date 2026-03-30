import type Database from "better-sqlite3";

export const INITIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  farm_name TEXT NOT NULL,
  location TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS controllers (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  hardware_id TEXT NOT NULL UNIQUE,
  device_key_hash TEXT NOT NULL,
  location TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  firmware_version TEXT NOT NULL DEFAULT 'unknown',
  heartbeat_interval_sec INTEGER NOT NULL DEFAULT 60,
  last_seen_at TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS controllers_user_id_idx ON controllers(user_id);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY NOT NULL,
  controller_id TEXT NOT NULL,
  channel_key TEXT NOT NULL,
  name TEXT NOT NULL,
  template TEXT NOT NULL,
  kind TEXT NOT NULL,
  unit TEXT NOT NULL,
  min_value REAL NOT NULL,
  max_value REAL NOT NULL,
  latest_numeric_value REAL,
  latest_boolean_state INTEGER,
  latest_status TEXT NOT NULL DEFAULT 'unknown',
  last_sample_at TEXT,
  threshold_low REAL,
  threshold_high REAL,
  warning_low REAL,
  warning_high REAL,
  config_json TEXT NOT NULL DEFAULT '{}',
  calibration_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (controller_id) REFERENCES controllers(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS channels_controller_key_idx ON channels(controller_id, channel_key);
CREATE INDEX IF NOT EXISTS channels_controller_id_idx ON channels(controller_id);

CREATE TABLE IF NOT EXISTS telemetry_samples (
  id TEXT PRIMARY KEY NOT NULL,
  channel_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  numeric_value REAL,
  boolean_state INTEGER,
  raw_value REAL,
  raw_unit TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  payload_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS telemetry_channel_recorded_idx ON telemetry_samples(channel_id, recorded_at);

CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY NOT NULL,
  controller_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL,
  command_type TEXT NOT NULL,
  desired_boolean_state INTEGER,
  desired_numeric_value REAL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  override_until TEXT,
  created_at TEXT NOT NULL,
  acknowledged_at TEXT,
  device_message TEXT,
  FOREIGN KEY (controller_id) REFERENCES controllers(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS commands_channel_id_idx ON commands(channel_id);
CREATE INDEX IF NOT EXISTS commands_controller_id_idx ON commands(controller_id);
CREATE INDEX IF NOT EXISTS commands_status_idx ON commands(status);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  controller_id TEXT NOT NULL,
  channel_id TEXT,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  opened_at TEXT NOT NULL,
  resolved_at TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (controller_id) REFERENCES controllers(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS alerts_user_id_idx ON alerts(user_id);
CREATE INDEX IF NOT EXISTS alerts_controller_id_idx ON alerts(controller_id);
CREATE INDEX IF NOT EXISTS alerts_status_idx ON alerts(status);
`;

export function runMigrations(sqlite: Database.Database) {
  sqlite.exec(INITIAL_SCHEMA_SQL);
}
