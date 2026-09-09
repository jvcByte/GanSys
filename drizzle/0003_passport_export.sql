-- Food Safety Passport Tables (Export Compliance)
-- Migration 0003: passport_export

CREATE TABLE IF NOT EXISTS "passport_profiles" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "product_name" text NOT NULL,
  "destination" text NOT NULL,
  "lookback_hours" integer NOT NULL DEFAULT 168,
  "max_data_age_minutes" integer NOT NULL DEFAULT 60,
  "version" integer NOT NULL DEFAULT 1,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "passport_profiles_user_id_idx" ON "passport_profiles" ("user_id");

CREATE TABLE IF NOT EXISTS "passport_profile_channels" (
  "id" text PRIMARY KEY NOT NULL,
  "profile_id" text NOT NULL REFERENCES "passport_profiles"("id") ON DELETE cascade,
  "channel_id" text NOT NULL REFERENCES "channels"("id") ON DELETE cascade,
  "min_value" double precision NOT NULL,
  "max_value" double precision NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "passport_profile_channels_min_max_check" CHECK ("min_value" < "max_value")
);

CREATE UNIQUE INDEX IF NOT EXISTS "passport_profile_channels_profile_channel_idx" ON "passport_profile_channels" ("profile_id", "channel_id");

CREATE TABLE IF NOT EXISTS "passport_certificates" (
  "id" text PRIMARY KEY NOT NULL,
  "profile_id" text REFERENCES "passport_profiles"("id") ON DELETE set null,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "product_name" text NOT NULL,
  "destination" text NOT NULL,
  "issuer_name" text NOT NULL,
  "farm_name" text NOT NULL,
  "farm_location" text NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "window_end" timestamp with time zone NOT NULL,
  "status" text NOT NULL DEFAULT 'valid',
  "payload_json" text NOT NULL,
  "payload_hash" text NOT NULL,
  "signature" text NOT NULL,
  "signature_algo" text NOT NULL DEFAULT 'HMAC-SHA256',
  "certificate_version" integer NOT NULL DEFAULT 1,
  "signature_key_id" text NOT NULL DEFAULT 'key_v1',
  "issued_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "passport_certificates_user_id_idx" ON "passport_certificates" ("user_id");
CREATE INDEX IF NOT EXISTS "passport_certificates_issued_at_idx" ON "passport_certificates" ("issued_at");
CREATE INDEX IF NOT EXISTS "passport_certificates_status_idx" ON "passport_certificates" ("status");
CREATE INDEX IF NOT EXISTS "passport_certificates_payload_hash_idx" ON "passport_certificates" ("payload_hash");
