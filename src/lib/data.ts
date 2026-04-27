/**
 * Barrel re-export — all domain logic now lives in src/lib/services/.
 * This file exists so existing imports from "@/lib/data" continue to work
 * without changes during the migration.
 */

export * from "./services/auth.service";
export * from "./services/alert.service";
export * from "./services/channel.service";
export * from "./services/command.service";
export * from "./services/controller.service";
export * from "./services/telemetry.service";
export * from "./services/snapshot.service";
export * from "./services/device-sync.service";
export * from "./services/pest.service";
export * from "./services/scheduled-command.service";
