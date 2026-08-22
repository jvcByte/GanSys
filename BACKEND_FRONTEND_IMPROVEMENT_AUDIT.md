# GanSystems Backend, Frontend, Deployment, and Firmware Audit

**Review date:** 2026-08-21  
**Scope:** Documentation, backend services and API routes, frontend dashboard, database schema/migrations, deployment configuration, WebSocket/MQTT integration, tests, and ESP32 firmware.

No application source files were changed as part of this audit.

## Summary

The previous list was not exhaustive. This audit found 24 concrete findings, including credential exposure, deployment failures, authorization gaps, scheduling races and duplication, MQTT delivery risks, frontend stale-state problems, firmware reliability issues, and insufficient test coverage.

Prioritize the Critical and High items before treating the system as production-ready.

## Critical Findings

### 1. Cross-user channel creation / IDOR

[Channel creation service](src/lib/services/channel.service.ts) accepts a `controllerId` but does not appear to verify that the controller belongs to the authenticated user before inserting the channel. The authenticated route passes the user-provided controller ID from [the channels route](app/api/controllers/[id]/channels/route.ts).

**Risk:** A user who knows another controller ID may add or modify channel configuration on that controller.

**Improvement:** Enforce controller ownership inside the service boundary, not only in the route.

### 2. Credentials and device secrets are committed

The repository contains database or MQTT credentials in [.env.example](.env.example), and Wi-Fi passwords/device keys in firmware such as [water_tank.ino](c++/water_tank/water_tank.ino) and [dual_soil_irrigation.ino](c++/dual_soil_irrigation/dual_soil_irrigation.ino). Additional firmware variants should be checked as well.

**Risk:** Anyone with repository access can access the database, MQTT broker, network, or devices.

**Improvement:** Rotate every exposed secret immediately, remove real values from Git, use local untracked environment files, and provision per-device credentials securely.

### 3. TLS certificate verification is disabled on ESP32

The firmware uses `setInsecure()` in the water-tank and dual-soil sketches.

**Risk:** A network attacker can impersonate the API, capture device keys, submit false telemetry, or issue commands.

**Improvement:** Pin the server certificate/public key or install a trusted CA certificate and reject invalid certificates.

### 4. Production does not start the custom server services

The production command in [package.json](package.json) launches the generated standalone Next server through [start-standalone.js](scripts/start-standalone.js). WebSocket upgrades, MQTT initialization, and scheduler startup are attached only in [server.ts](server.ts). Railway uses this standalone start command in [railway.json](railway.json).

**Risk:** Production may serve the web app while MQTT, WebSocket, and scheduled execution are absent.

**Improvement:** Make the production command launch the custom server, or explicitly split the worker/MQTT/WebSocket responsibilities into independently deployed processes and health checks.

### 5. Server-side and ESP32-side scheduling can execute one command twice

The server sends pending scheduled commands to devices in [device-sync.service.ts](src/lib/services/device-sync.service.ts), while the server scheduler executes due rows in [scheduled-command.service.ts](src/lib/services/scheduled-command.service.ts). Firmware such as [water_tank.ino](c++/water_tank/water_tank.ino) also stores and executes scheduled commands locally.

**Risk:** Duplicate actuator actions and conflicting acknowledgements.

**Improvement:** Select one execution authority. If both modes must remain, add explicit ownership, idempotency keys, command claims, and clear acknowledgement semantics.

### 6. Scheduled commands are not atomically claimed

[processDueScheduledCommands](src/lib/services/scheduled-command.service.ts) selects pending rows and later updates them without an atomic claim or conditional status transition.

**Risk:** Multiple server instances or overlapping scheduler runs can create multiple regular commands for one scheduled command.

**Improvement:** Claim rows transactionally with a status transition such as `pending -> processing`, a lease, and a conditional update.

### 7. Pest schedule MQTT publish uses the database ID as hardware ID

[The pest schedule route](app/api/controllers/[id]/pest-schedule/route.ts) calls `publishCommands(id, ...)`. [The MQTT client](src/lib/mqtt/client.ts) treats that argument as a hardware ID when constructing the topic.

**Risk:** Devices may never receive updated pest schedules because the topic uses the controller database ID instead of the registered hardware ID.

**Improvement:** Resolve the owned controller and publish using `controller.hardwareId`.

## High Findings

### 8. Retained MQTT command payloads can replay old commands

[MQTT publishing](src/lib/mqtt/client.ts) uses `retain: true` for command payloads.

**Risk:** A reconnecting device can receive an old command after it was acknowledged, cancelled, or superseded.

**Improvement:** Do not retain one-shot commands, or include expiry, monotonic versions, and device-side idempotency checks.

### 9. Auto-scheduling has a check-then-insert race

[auto-schedule.service.ts](src/lib/services/auto-schedule.service.ts) checks for existing pending commands and inserts later. There is no database uniqueness constraint enforcing one auto command per schedule occurrence.

**Risk:** Concurrent scheduler instances can create duplicate daily commands.

**Improvement:** Use a schedule occurrence key plus a unique constraint and an atomic insert/upsert.

### 10. Disabling or changing a schedule does not cancel old commands

The pest schedule update stores new values and invokes auto-scheduling, but existing generated pending commands are not cancelled. This conflicts with the documentation claiming that clearing times or disabling pest control stops the schedule.

**Risk:** A device can still turn on or off after the user disabled or changed the schedule.

**Improvement:** Reconcile pending auto-generated commands whenever a schedule changes; preserve manually-created commands separately.

### 11. Scheduled command validation permits invalid commands

[scheduledCommandSchema](src/lib/validators.ts) allows neither desired field or both fields. It also lacks finite-number checks, note length limits, and a maximum request size.

**Risk:** Null or ambiguous commands can be stored and later sent to devices.

**Improvement:** Require exactly one desired value, validate finite numeric ranges, limit note length, and verify that the target channel is an actuator or hybrid.

### 12. Acknowledgement status is unrestricted and terminal states can be overwritten

[applyAcknowledgements](src/lib/services/command.service.ts) accepts arbitrary status strings and updates scheduled commands without requiring them to remain pending. [deviceSyncSchema](src/lib/validators.ts) also accepts arbitrary acknowledgement status text.

**Risk:** Delayed or malformed device acknowledgements can change cancelled, failed, or executed commands.

**Improvement:** Use an allowlist of statuses, define legal state transitions, reject invalid timestamps, and update only when the current state allows the transition.

### 13. Pest schedule upsert is not atomic

[upsertPestSchedule](src/lib/services/pest.service.ts) performs a read followed by an insert or update even though the database has a unique controller index.

**Risk:** Concurrent saves can produce a unique-key error or lost updates.

**Improvement:** Use a database-native `INSERT ... ON CONFLICT DO UPDATE`.

### 14. WebSocket origin is not validated

[WebSocket authentication](src/lib/ws/server.ts) checks the session cookie but does not validate the request `Origin`.

**Risk:** Cross-origin WebSocket requests may use a victim's browser session and receive live dashboard data.

**Improvement:** Allow only configured origins, reject unexpected origins during upgrade, and add connection rate limits and heartbeat handling.

### 15. Snapshot WebSocket messages are not consumed by the frontend

[The MQTT client](src/lib/mqtt/client.ts) broadcasts `snapshot_update`, but [controller-detail.tsx](src/components/dashboard/controller-detail.tsx) only handles `controller_update` in its WebSocket effect.

**Risk:** Camera data remains stale until a full HTTP refresh.

**Improvement:** Handle `snapshot_update` and merge the snapshot into component state.

### 16. One firmware variant does not implement scheduled commands

[sketch_apr18a.ino](c++/sketch_apr18a/sketch_apr18a.ino) processes pending commands but does not consume `scheduledCommands`, and it targets an unsecured HTTP endpoint. The repository does not clearly identify which sketch is production firmware.

**Risk:** Devices using that sketch will not support the documented scheduling behavior and may expose device credentials over an insecure connection.

**Improvement:** Declare one supported firmware per hardware model, keep the API contract synchronized, and remove or clearly mark obsolete sketches.

### 17. ESP32 scheduled-command storage is volatile

The water-tank firmware clears its scheduled-command array at startup.

**Risk:** A reboot erases future commands; recovery depends on a successful later sync, conflicting with strong offline scheduling claims.

**Improvement:** Persist schedules in nonvolatile storage or explicitly document reboot recovery limitations.

## Medium Findings

### 18. Telemetry ingestion is sequential and query-heavy

[telemetry.service.ts](src/lib/services/telemetry.service.ts) performs multiple database operations per reading. Camera snapshot retrieval also performs one latest-sample query per camera channel.

**Improvement:** Batch inserts/updates, reduce repeated reads, evaluate alerts efficiently, and use grouped latest-row queries for snapshots.

### 19. Device sync accepts unbounded arrays and payload objects

[deviceSyncSchema](src/lib/validators.ts) does not cap reading count, acknowledgement count, string lengths, or payload size.

**Risk:** Oversized requests can consume memory, database capacity, and processing time.

**Improvement:** Add strict limits and request-body size limits at the server/proxy layer.

### 20. Frontend polling can overwrite newer state

Dashboard polling and controller polling use asynchronous interval callbacks without aborting previous requests or guarding every response against stale data.

**Risk:** A slow response can overwrite newer WebSocket or polling state.

**Improvement:** Use `AbortController`, request sequence IDs, or a data-fetching library with stale-response protection.

### 21. Frontend network errors are inconsistently handled

Several dashboard fetches silently return on failure or assume a JSON response. Schedule loading and command operations do not consistently expose loading, retry, or error states.

**Improvement:** Centralize API parsing, show recoverable error states, and provide retry actions without losing current data.

### 22. Duplicate switch cases exist in settings

[settings-view.tsx](src/components/dashboard/settings-view.tsx) repeats cases for `spray_pump`, `uv_zapper`, and `camera_snapshot`.

**Risk:** Later branches are unreachable and generated device-contract output can diverge from intended behavior.

**Improvement:** Consolidate each template case and add a test that covers every supported template.

### 23. Dashboard controller status counts can be misleading

[dashboard-home.tsx](src/components/dashboard/dashboard-home.tsx) derives offline count as total minus online, which counts stale controllers as offline.

**Improvement:** Count `offline`, `stale`, and `online` explicitly and display distinct values.

### 24. Query parameter validation is incomplete

[alertQuerySchema](src/lib/validators.ts) accepts arbitrary status values. Invalid values can silently return empty results instead of a useful validation error.

**Improvement:** Use enums for supported alert statuses and validate IDs and pagination parameters consistently.

## Additional Recommendations

- Add rate limiting and abuse protection for login, signup, device sync, command creation, and WebSocket upgrades.
- Use UTC for persisted scheduling and an explicit user/device timezone for display and recurrence calculations.
- Add command and schedule audit logs for safety-critical actuator operations.
- Add database constraints or enums for command types, channel kinds, and status fields.
- Add optimistic concurrency/version fields for controller and pest schedule updates.
- Add telemetry retention, archival, partitioning, and indexes appropriate for device frequency.
- Validate or allowlist user-supplied stream and image URLs before rendering them.
- Add WebSocket session-expiry handling, ping/pong heartbeats, and cleanup for dead connections.
- Add accessible `aria-live` status messages, visible focus states, and labels for icon-only controls.
- Ensure destructive actions require CSRF protection or equivalent same-site request protections.
- Add structured logging, correlation IDs, metrics, and alerts for failed commands, device sync failures, MQTT disconnects, and scheduler lag.
- Separate user-facing error messages from internal logs so database and infrastructure details are not exposed.
- Document backup/restore, secret rotation, firmware rollout, rollback, and emergency actuator shutdown procedures.

## Testing Gaps

The visible automated suite contains only two narrow unit tests:

- [auth.test.ts](tests/unit/auth.test.ts)
- [templates.test.ts](tests/unit/templates.test.ts)

There are no visible focused tests for:

- API authorization and cross-user isolation
- Channel/controller ownership
- Scheduled command validation and state transitions
- Scheduler concurrency and duplicate prevention
- Auto-schedule reconciliation after updates or disablement
- Device sync authentication and payload limits
- Acknowledgement replay/out-of-order handling
- MQTT topic construction and retained-message behavior
- WebSocket authentication and origin validation
- Frontend polling/WebSocket state merging
- Firmware time parsing, reboot recovery, queue overflow, and safety cutoffs
- End-to-end command execution against a test broker/device simulator

The feature reports [TEST_REPORT.md](TEST_REPORT.md) and [TESTING_COMPLETE.md](TESTING_COMPLETE.md) describe broad readiness, but the actual visible test suite does not substantiate those claims. [tests/property/README.md](tests/property/README.md) also indicates property testing is not implemented.

## Documentation and Repository Hygiene

- [DEVICE_INTEGRATION.md](DEVICE_INTEGRATION.md) describes server-side scheduling, while [ESP32_SCHEDULING_IMPLEMENTATION.md](ESP32_SCHEDULING_IMPLEMENTATION.md) describes device-side scheduling. Select and document one authoritative model.
- The documentation references both Vercel and Railway deployment models. Document the supported production topology and exact startup command.
- The documented `npm start` behavior should match the actual WebSocket, MQTT, and scheduler startup behavior.
- A duplicate project tree exists under [GanSys/](GanSys/), including source, firmware, migrations, and documentation. Identify the canonical tree and remove or explicitly mark the duplicate archival tree.
- Update the device sync response documentation to include `scheduledCommands` if device-side scheduling remains supported.
- Replace claims such as “production ready” with evidence-based status tied to integration and end-to-end test results.

## Suggested Order of Work

1. Rotate exposed credentials and replace insecure TLS handling.
2. Fix production startup and confirm MQTT, WebSocket, and scheduler health in deployment.
3. Fix controller/channel authorization and WebSocket origin validation.
4. Choose one scheduling authority and implement atomic claims/idempotency.
5. Reconcile auto-schedules on update/disable and fix the MQTT hardware-ID topic.
6. Harden schemas, acknowledgement transitions, and request limits.
7. Fix frontend live snapshot/state handling and stale polling behavior.
8. Add integration, concurrency, security, and firmware contract tests.
9. Reconcile duplicated firmware/docs/project trees and document the supported deployment.
