# GanSystems Dashboard

GanSystems is a Next.js dashboard for ESP32-based farm automation. It combines authenticated multi-user dashboards, controller management, telemetry ingestion, MQTT command delivery, WebSocket live updates, and route-scoped plus section-scoped error recovery.

## Current stack

- Next.js 16
- React 19
- TypeScript
- Drizzle ORM
- Neon Postgres via `@neondatabase/serverless`
- MQTT for device command delivery and broker-originated updates
- Native WebSocket server attached through a custom Node server
- Zod for API validation
- Recharts for telemetry history views

## What the app does

- User signup, login, logout, and session-backed dashboard access
- Dashboard overview for controllers, alerts, averages, and command state
- Controller detail pages with:
  - live controller status
  - telemetry cards
  - manual actuator commands
  - channel history charts
  - camera snapshots
  - pest-control schedule and activity views
- Settings area for:
  - profile updates
  - controller registration
  - channel setup
  - generated ESP32 sync contract guidance
- Device sync endpoint for ESP32 telemetry and acknowledgements
- MQTT integration for device-facing command publish and inbound broker messages
- WebSocket fanout for near-real-time dashboard updates

## Architecture

High-level structure:

- `app/`
  - App Router pages, layouts, API routes, global error boundaries, and not-found pages
- `src/components/`
  - UI for auth, dashboard, home, and system-level reusable states
- `src/lib/services/`
  - Domain logic for auth, controllers, channels, alerts, telemetry, snapshots, commands, pest control, and device sync
- `src/lib/api.ts`
  - Shared route helpers for auth enforcement, JSON parsing, and route error handling
- `src/lib/db/`
  - Drizzle schema and Neon database client
- `src/lib/mqtt/`
  - MQTT client bootstrap and broker message handling
- `src/lib/ws/`
  - WebSocket server and browser context wiring
- `drizzle/`
  - SQL migrations and migration metadata
- `scripts/migrate.ts`
  - Migration runner
- `server.ts`
  - Custom Next.js HTTP server that mounts WebSocket upgrade handling and initializes MQTT

## Error handling

The app now uses layered error handling:

- `app/global-error.tsx`
  - catches root shell failures
- `app/error.tsx`
  - catches application-level rendering failures
- route-level boundaries such as:
  - `app/dashboard/error.tsx`
  - `app/login/error.tsx`
  - `app/signup/error.tsx`
- section-scoped boundaries inside dashboard client views
  - if a dashboard panel fails, the surrounding shell stays mounted
  - the local failure is rendered inline where that panel or resource belongs

This means a failure in one dashboard section should no longer blank the entire dashboard content area by default.

## Local development

1. Install dependencies

```bash
npm install
```

2. Set environment variables in `.env.local`

Required:

```bash
DATABASE_URL=postgres://...
```

Common optional runtime variables:

```bash
MQTT_BROKER_URL=mqtt://...
MQTT_USERNAME=...
MQTT_PASSWORD=...
HOSTNAME=0.0.0.0
PORT=3000
```

3. Run migrations

```bash
npm run migrate
```

4. Start the app

For standard Next development:

```bash
npm run dev
```

For the custom Node server with WebSocket and MQTT startup behavior:

```bash
npm run dev:server
```

5. Open the app

```text
http://localhost:3000
```

## Scripts

```bash
npm run dev
npm run dev:server
npm run build
npm run start
npm run lint
npm run test
npm run migrate
```

## Device sync API

Endpoint:

```text
POST /api/device/sync
```

Required headers:

- `x-device-id`
- `x-device-key`

Example payload:

```json
{
  "firmwareVersion": "1.0.0",
  "readings": [
    {
      "channelKey": "tank_main",
      "numericValue": 72,
      "rawValue": 38,
      "rawUnit": "cm",
      "status": "ok"
    }
  ],
  "acknowledgements": [
    {
      "commandId": "cmd_123",
      "status": "acknowledged",
      "executedAt": "2026-03-30T12:30:00.000Z",
      "deviceMessage": "Pump toggled"
    }
  ]
}
```

Response includes:

- `serverTime`
- controller heartbeat metadata
- channel configuration for firmware
- pending commands
- pest-control schedule when configured

## Deployment notes

This project is not a static or purely serverless dashboard. Production behavior depends on:

- a reachable Postgres database via `DATABASE_URL`
- the custom Node runtime in `server.ts`
- WebSocket upgrade handling
- optional MQTT broker connectivity for device command distribution and broker-originated updates

Recommended production shape:

- deploy as a long-running Node process (Railway's `startCommand` is `node dist/server.js`)
- run `npm run build` (builds the Next app **and** bundles `server.ts` → `dist/server.js`)
- start with `npm run start` (runs `node dist/server.js`, which starts HTTP + WebSocket + MQTT + the scheduler)
- set `ALLOWED_ORIGINS` to the comma-separated list of browser origins allowed to open WebSocket connections
- provide a stable Postgres database
- place a reverse proxy in front if needed

## Recent implementation updates

- API routes were refactored to use shared request/error helpers
- several unresolved async response bugs were fixed in route handlers
- MQTT async handling was corrected so broker-driven updates await their snapshots properly
- global, route-level, and section-scoped error boundaries were added
- dashboard failures are now more localized instead of always replacing the whole active route segment
