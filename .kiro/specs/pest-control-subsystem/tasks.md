# Implementation Plan: Pest Control Subsystem

## Overview

Restructure the project for production-grade development, migrate the database from SQLite to Neon PostgreSQL, add pest control channel templates and presets, wire up an MQTT client and WebSocket server for real-time communication, implement the pest control schedule and activity log APIs, extend the device sync protocol, add camera snapshot support, and update the dashboard UI with new panels and real-time updates.

## Tasks

- [x] 0. Restructure project for production-grade development
  - [x] 0.1 Split `src/lib/data.ts` into domain services under `src/lib/services/`
    - Create `src/lib/services/auth.service.ts` — move `signupUser`, `loginUser`, `updateProfile`
    - Create `src/lib/services/controller.service.ts` — move `createController`, `updateController`, `deleteController`, `resetControllerKey`, `getUserControllers`, `getControllerOwnedByUser`, `updateControllerStatuses`
    - Create `src/lib/services/channel.service.ts` — move `createChannel`, `updateChannel`, `deleteChannel`, `getChannelOwnedByUser`
    - Create `src/lib/services/telemetry.service.ts` — move `applyReadings`, `getChannelHistory`, `evaluateThresholdAlerts`, `evaluateFaultAlerts`
    - Create `src/lib/services/alert.service.ts` — move `upsertOpenAlert`, `resolveOpenAlerts`
    - Create `src/lib/services/command.service.ts` — move `createManualCommand`, `applyAcknowledgements`
    - Create `src/lib/services/snapshot.service.ts` — move `getDashboardSnapshot`, `getControllerSnapshot`, `buildSummary`, `buildControllerCard`
    - Create `src/lib/services/device-sync.service.ts` — move `deviceSync` (the main sync handler called by `/api/device/sync`)
    - Keep `src/lib/data.ts` as a re-export barrel: `export * from "./services/..."` so existing imports don't break during migration
  - [x] 0.2 Create `src/lib/mqtt/` and `src/lib/ws/` directories with placeholder files
    - Create `src/lib/mqtt/client.ts` with an empty exported `publishCommands` stub
    - Create `src/lib/ws/server.ts` with an empty exported `broadcastToUser` stub
    - These will be fully implemented in tasks 9 and 10
  - [x] 0.3 Reorganise tests into `tests/unit/` and `tests/property/` subdirectories
    - Move `tests/auth.test.ts` → `tests/unit/auth.test.ts`
    - Move `tests/templates.test.ts` → `tests/unit/templates.test.ts`
    - Update `vitest.config.ts` include pattern to cover `tests/**/*.test.ts`

- [x] 1. Migrate database from SQLite to Neon PostgreSQL
  - [x] 1.1 Update dependencies and Drizzle config
    - Remove `better-sqlite3` and `@types/better-sqlite3` from `package.json`
    - Add `@neondatabase/serverless` to dependencies
    - Update `drizzle.config.ts`: set `dialect: "postgresql"` and `dbCredentials.url: process.env.DATABASE_URL!`
    - _Requirements: 12.1_

  - [x] 1.2 Rewrite `src/lib/db/client.ts` for Neon
    - Import `neon` from `@neondatabase/serverless` and `drizzle` from `drizzle-orm/neon-http`
    - Replace the `better-sqlite3` singleton with `const sql = neon(process.env.DATABASE_URL!)` and `export const db = drizzle(sql, { schema })`
    - Remove the `sqlite` named export and all `fs`/`path` imports
    - _Requirements: 12.1_

  - [x] 1.3 Rewrite `src/lib/db/schema.ts` for PostgreSQL
    - Replace all `sqliteTable` imports with `pgTable` from `drizzle-orm/pg-core`
    - Replace `text("*_at")` timestamp columns with `timestamp("*_at", { withTimezone: true })`
    - Replace `integer("*", { mode: "boolean" })` columns with `boolean("*")`
    - Replace `text("*_json")` JSON columns with `jsonb("*")` (rename columns: `configJson` → `config`, `calibrationJson` → `calibration`, `payloadJson` → `payload`, `metaJson` → `meta`)
    - Replace `real("*")` numeric columns with `doublePrecision("*")`
    - Add the `pest_control_schedules` table with columns: `id`, `controllerId` (FK → controllers), `enabled` (boolean), `sprayEntries` (jsonb), `uvStartTime` (text), `uvEndTime` (text), `updatedAt` (timestamp with timezone)
    - Add `uniqueIndex("pest_schedules_controller_idx")` on `controllerId`
    - _Requirements: 8.4, 12.1_

  - [x] 1.4 Replace raw migration script with Drizzle Kit workflow
    - Delete the raw SQL in `src/lib/db/migrations.ts` and replace with a no-op or remove the file
    - Update `scripts/migrate.ts` to run `drizzle-kit migrate` (or call `migrate` from `drizzle-orm/neon-http/migrator`)
    - _Requirements: 12.1_

  - [x] 1.5 Rewrite the bucketed history query in `src/lib/data.ts`
    - Remove the `sqlite.prepare(...)` raw SQL call in `getChannelHistory`
    - Rewrite using Drizzle's `sql` template tag or raw Neon SQL to bucket telemetry samples by time interval
    - Remove the `sqlite` import from `src/lib/db/client.ts` throughout `data.ts`
    - _Requirements: 2.6_

  - [ ]* 1.6 Write unit tests for schema column types
    - Verify `pest_control_schedules` table is exported from schema
    - Verify timestamp columns use `withTimezone: true`
    - _Requirements: 8.4_

- [ ] 2. Add new channel templates and setup presets
  - [ ] 2.1 Add `spray_pump`, `uv_zapper`, `camera_snapshot` templates to `src/lib/templates.ts`
    - Extend `ChannelTemplateId` union with `"spray_pump" | "uv_zapper" | "camera_snapshot"`
    - Add `spray_pump` template: `kind: "actuator"`, `unit: "state"`, `config: { onLabel: "Spraying", offLabel: "Idle", display: "toggle" }`
    - Add `uv_zapper` template: `kind: "actuator"`, `unit: "state"`, `config: { onLabel: "Active", offLabel: "Off", display: "toggle" }`
    - Add `camera_snapshot` template: `kind: "hybrid"`, `unit: "image"`, `config: { display: "image" }`
    - _Requirements: 7.1, 7.2, 4.1_

  - [ ] 2.2 Add `pest_control` preset and update `full_gansystems` in `src/lib/templates.ts`
    - Extend `SetupPreset["id"]` union with `"pest_control"`
    - Add `pest_control` preset with `spray_pump` and `uv_zapper` channels (keys: `"spray_pump"`, `"uv_zapper"`)
    - Append `spray_pump` and `uv_zapper` channels to the `full_gansystems` preset channels array
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 2.3 Write unit tests for new templates and presets
    - Assert `CHANNEL_TEMPLATES` contains `spray_pump`, `uv_zapper`, `camera_snapshot` with correct `kind`, `unit`, and `config` fields
    - Assert `CONTROLLER_SETUP_PRESETS` contains a `pest_control` preset
    - Assert `full_gansystems` preset channels include `spray_pump` and `uv_zapper`
    - _Requirements: 7.1, 7.2, 10.1, 10.3_

  - [ ]* 2.4 Write property test for preset channel key uniqueness (Property 9)
    - **Property 9: Preset channel keys are unique within a controller**
    - **Validates: Requirements 10.2**

- [ ] 3. Extend types and validators
  - [ ] 3.1 Add new types to `src/lib/types.ts`
    - Add `SprayEntry`, `PestControlSchedule`, `SnapshotPayload`, `PestLogEntry`, `WsMessage` types as defined in the design
    - Extend `ControllerSnapshot` with `pestSchedule: PestControlSchedule | null`, `pestLog: PestLogEntry[]`, `latestSnapshots: Record<string, SnapshotPayload>`
    - Add `DeviceSyncResponse` type with `commands` and `pestControlSchedule` fields
    - _Requirements: 8.4, 8.5, 9.3, 12.3_

  - [ ] 3.2 Add Zod validation schema for pest control schedule in `src/lib/validators.ts`
    - Add `SprayEntrySchema`: `startTime` matching `/^\d{2}:\d{2}$/` with hours 0–23 and minutes 0–59, `durationMinutes` integer 1–120
    - Add `PestScheduleSchema`: `enabled` boolean, `sprayEntries` array of 0–10 `SprayEntrySchema`, `uvStartTime` and `uvEndTime` nullable strings matching the same time format
    - _Requirements: 8.2, 8.3_

- [ ] 4. Implement pest control schedule data layer and API
  - [ ] 4.1 Add `getPestSchedule` and `upsertPestSchedule` to `src/lib/data.ts`
    - `getPestSchedule(userId, controllerId)`: verify ownership, query `pestControlSchedules` by `controllerId`, return hydrated `PestControlSchedule` or `null`
    - `upsertPestSchedule(userId, controllerId, input)`: verify ownership, insert or update the single row for that controller using Drizzle's `onConflictDoUpdate`
    - _Requirements: 8.4, 8.6, 8.7_

  - [ ] 4.2 Create `app/api/controllers/[id]/pest-schedule/route.ts`
    - `GET`: call `getPestSchedule`, return `{ schedule }` (null if not configured)
    - `PUT`: validate body with `PestScheduleSchema`, call `upsertPestSchedule`, call `publishCommands` to push updated schedule to device, return `{ schedule }`
    - Return 404 for unowned controllers, 400 for validation errors
    - _Requirements: 8.1, 8.4, 8.5, 8.7_

  - [ ]* 4.3 Write property tests for schedule round-trip and replacement (Properties 5 and 6)
    - **Property 5: Pest control schedule round-trip**
    - **Validates: Requirements 8.4, 8.7**
    - **Property 6: Schedule replacement is total**
    - **Validates: Requirements 8.7**

- [ ] 5. Update device sync to include pest control schedule
  - [ ] 5.1 Update `deviceSync` in `src/lib/data.ts` to fetch and return the pest schedule
    - After processing readings and acknowledgements, call `getPestSchedule` for the controller
    - Return `{ commands, pestControlSchedule }` from `deviceSync`
    - _Requirements: 8.5, 8.6, 12.3_

  - [ ] 5.2 Update `app/api/device/sync/route.ts` response shape
    - Include `pestControlSchedule` in the JSON response body
    - _Requirements: 12.3_

  - [ ]* 5.3 Write property test for sync response always containing pestControlSchedule (Property 7)
    - **Property 7: Sync response always contains pestControlSchedule field**
    - **Validates: Requirements 8.5, 8.6**

- [ ] 6. Add camera snapshot support
  - [ ] 6.1 Update `applyReadings` in `src/lib/data.ts` to handle `camera_snapshot` channels
    - Detect when `reading.payload` contains `imageUrl` or `imageBase64`
    - Store the payload in `telemetrySamples.payload` jsonb column
    - _Requirements: 4.2, 12.5_

  - [ ] 6.2 Add `getLatestSnapshots(controllerId)` to `src/lib/data.ts`
    - For each `camera_snapshot` channel on the controller, fetch the most recent telemetry sample with a non-empty payload
    - Return `Record<channelId, SnapshotPayload>`
    - _Requirements: 4.2, 4.3_

  - [ ] 6.3 Update `getControllerSnapshot` to populate `latestSnapshots`
    - Call `getLatestSnapshots` and include the result in the returned `ControllerSnapshot`
    - _Requirements: 4.3, 4.4_

  - [ ]* 6.4 Write property test for camera snapshot payload round-trip (Property 4)
    - **Property 4: Camera snapshot payload round-trip**
    - **Validates: Requirements 4.2**

- [ ] 7. Add pest control activity log
  - [ ] 7.1 Add `getPestControlLog(controllerId, limit)` to `src/lib/data.ts`
    - Query `telemetrySamples` joined with `channels` where `template IN ('spray_pump', 'uv_zapper')` for the given controller
    - Order by `recordedAt` descending, limit to 20
    - Return `PestLogEntry[]` with `channelId`, `channelName`, `activationType` (from payload or default `"manual"`), `booleanState`, `recordedAt`
    - _Requirements: 9.2, 9.3_

  - [ ] 7.2 Update `getControllerSnapshot` to populate `pestLog` and `pestSchedule`
    - Call `getPestControlLog` and `getPestSchedule` and include both in the returned `ControllerSnapshot`
    - _Requirements: 9.1, 9.2, 8.6_

  - [ ]* 7.3 Write property test for pest control log limit and ordering (Property 8)
    - **Property 8: Pest control log returns at most 20 entries ordered by time**
    - **Validates: Requirements 9.2, 9.3**

- [ ] 8. Checkpoint — Ensure all data layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Implement MQTT client
  - [ ] 9.1 Create `src/lib/mqtt.ts` singleton MQTT client
    - Connect to the broker using `MQTT_BROKER_URL` env var via the existing `mqtt` npm package
    - Subscribe to `gansys/+/readings` and `gansys/+/acks` at QoS 1
    - Parse the hardware ID from the topic string on each message
    - _Requirements: 12.1_

  - [ ] 9.2 Wire MQTT readings handler
    - On `gansys/+/readings`: look up controller by `hardwareId`, call `deviceSync`, publish the response to `gansys/{hardwareId}/commands` with `retain: true`
    - _Requirements: 12.1, 12.2, 12.3_

  - [ ] 9.3 Wire MQTT acks handler and export `publishCommands`
    - On `gansys/+/acks`: call `applyAcknowledgements`, broadcast WebSocket update via `broadcastToUser`
    - Export `publishCommands(hardwareId, payload)` for use by API routes
    - _Requirements: 12.7, 11.9_

- [ ] 10. Implement WebSocket server
  - [ ] 10.1 Create WebSocket server entry point
    - Create `app/api/ws/route.ts` (or custom Next.js server entry) using the `ws` npm package
    - Maintain `Map<userId, Set<WebSocket>>` for per-user broadcast
    - Validate session cookie on connect; close with 401 if invalid
    - _Requirements: 11.7_

  - [ ] 10.2 Export `broadcastToUser` for use by data layer and MQTT client
    - Implement `broadcastToUser(userId: string, message: WsMessage): void` that serialises and sends to all sockets for that user
    - Handle disconnected sockets by removing them from the map
    - _Requirements: 11.7, 11.9_

- [ ] 11. Update settings page for new templates and presets
  - [ ] 11.1 Update `buildDeviceSyncExample` in `src/components/dashboard/settings-view.tsx`
    - Add cases for `spray_pump` and `uv_zapper`: return `{ channelKey, booleanState: false, numericValue: 0, status: "ok" }`
    - Add case for `camera_snapshot`: return `{ channelKey, payload: { imageUrl: "https://example.com/snapshot.jpg" }, status: "ok" }`
    - _Requirements: 7.6, 10.4_

  - [ ] 11.2 Verify template selector and preset dropdowns include new entries
    - Confirm `CHANNEL_TEMPLATES` iteration in the template `<select>` renders `spray_pump`, `uv_zapper`, `camera_snapshot`
    - Confirm `CONTROLLER_SETUP_PRESETS` iteration in bundle dropdowns renders `pest_control`
    - No code changes needed if the selects already iterate the arrays — add a targeted test instead
    - _Requirements: 7.6, 10.4_

- [ ] 12. Update controller detail UI
  - [ ] 12.1 Exclude `camera_snapshot` channels from `getCardGroups` sensor/actuator grouping
    - In `getCardGroups` in `controller-detail.tsx`, filter out channels with `template === "camera_snapshot"` from both `primaryChannels` and `actuators` before building groups
    - _Requirements: 4.6_

  - [ ] 12.2 Add camera snapshot card rendering
    - After the `groups` and `standaloneActuators` sections, render a separate card for each `camera_snapshot` channel
    - Display the image from `snapshot.latestSnapshots[channel.id]` or a "No snapshot yet" placeholder
    - Show channel name and `lastSampleAt` timestamp
    - _Requirements: 4.3, 4.4, 4.5_

  - [ ] 12.3 Add Pest Control Schedule panel component
    - Render only when the controller has at least one `spray_pump` or `uv_zapper` channel
    - On mount, `GET /api/controllers/{id}/pest-schedule` and populate form state
    - Form fields: `enabled` checkbox, spray time slots list (start time + duration + remove button + add slot button), UV zapper start/end time inputs
    - On save, `PUT /api/controllers/{id}/pest-schedule` with the form state
    - Display "No schedule set" when schedule is null
    - _Requirements: 8.1, 8.2, 8.3, 8.6_

  - [ ] 12.4 Add Pest Control Activity Log panel component
    - Render only when the controller has at least one `spray_pump` or `uv_zapper` channel
    - Populate from `snapshot.pestLog` (already fetched in the controller snapshot)
    - Each row: channel name, activation type, state (On/Off), relative timestamp
    - Display "No activity yet" when `pestLog` is empty
    - _Requirements: 9.1, 9.2, 9.3, 9.5_

  - [ ] 12.5 Add CSS classes for new panels to `dashboard.module.css`
    - Add styles for the camera snapshot card image container
    - Add styles for the pest schedule panel (slot list, time inputs)
    - Add styles for the pest activity log panel (log rows)
    - _Requirements: 4.3, 8.1, 9.1_

- [ ] 13. Add WebSocket context and replace polling
  - [ ] 13.1 Create `src/lib/ws-context.tsx` React context
    - Wrap a `WebSocket` connection with `subscribe(controllerId)` / `unsubscribe(controllerId)` / `lastMessage` API
    - Reconnect automatically on disconnect
    - _Requirements: 11.7_

  - [ ] 13.2 Replace polling in `dashboard-home.tsx` with WebSocket subscription
    - Subscribe to controller updates on mount via `WsContext`
    - On `controller_update` message, update snapshot state
    - Keep the existing 5-second `setInterval` as a fallback when WebSocket is disconnected
    - _Requirements: 1.2_

  - [ ] 13.3 Replace polling in `controller-detail.tsx` with WebSocket subscription
    - Subscribe to the controller's ID on mount via `WsContext`
    - On `controller_update`, `snapshot_update`, and `pest_log_entry` messages, update local state
    - Keep the existing 3-second `setInterval` as a fallback when WebSocket is disconnected
    - _Requirements: 2.5, 4.5, 9.4, 11.7_

- [ ] 14. Add property-based tests infrastructure and remaining properties
  - [ ] 14.1 Add `fast-check` to devDependencies
    - Add `fast-check` to `devDependencies` in `package.json`
    - _Requirements: (testing infrastructure)_

  - [ ]* 14.2 Write property test for controller status classification (Property 1)
    - **Property 1: Controller status classification is exhaustive and correct**
    - **Validates: Requirements 1.3, 1.4**

  - [ ]* 14.3 Write property test for dashboard summary consistency (Property 2)
    - **Property 2: Dashboard summary counts are consistent with input data**
    - **Validates: Requirements 1.1**

  - [ ]* 14.4 Write property test for alert ordering (Property 3)
    - **Property 3: Alert ordering is severity-first then time-descending**
    - **Validates: Requirements 1.6**

  - [ ]* 14.5 Write property test for sync commands ordered oldest-first (Property 10)
    - **Property 10: Sync response commands are ordered oldest-first**
    - **Validates: Requirements 11.2**

  - [ ]* 14.6 Write property test for threshold alert lifecycle (Property 11)
    - **Property 11: Threshold alerts are raised and resolved correctly**
    - **Validates: Requirements 13.1, 13.2, 13.3**

  - [ ]* 14.7 Write property test for invalid credentials rejection (Property 12)
    - **Property 12: Invalid device credentials always return 401**
    - **Validates: Requirements 12.6**

- [ ] 15. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Properties 4, 5, 6, 7, 8, 9 are placed close to their implementation tasks (tasks 6, 4, 5, 5, 7, 2) to catch regressions early
- Properties 1, 2, 3, 10, 11, 12 are grouped in task 14 as they test existing logic that is being migrated rather than new features
- The MQTT client (task 9) and WebSocket server (task 10) depend on the data layer being complete (tasks 1–8)
- UI tasks (12, 13) depend on the type extensions in task 3 being in place first
