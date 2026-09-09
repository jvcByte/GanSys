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

## Food Safety Passports

GanSystems supports export compliance certificates for food safety. The passport system allows farms to generate cryptographic certificates proving their produce meets specified water quality standards over a defined time window.

### Features

- **Compliance Profiles**: Define product, destination, and telemetry channels to monitor
- **Automated Evaluation**: Server-side compliance checking against configured ranges
- **Cryptographic Certificates**: HMAC-SHA256 signed certificates with version tracking
- **Public Verification**: Shareable verification page with QR code support
- **Integrity Protection**: Hash and signature verification detects tampering

### Profile Setup

1. Navigate to **Passports** in the dashboard sidebar
2. Click **Create Profile**
3. Configure:
   - Profile name (e.g., "Tomato Export to EU")
   - Product name
   - Destination market
   - Lookback window (24–720 hours)
   - Maximum data age / freshness requirement (5–1440 minutes)
4. Add compliance rules:
   - Select numeric sensor channels (pH, temperature, turbidity, etc.)
   - Set allowed min/max ranges for each parameter
   - Suggested bands are pre-filled for water_ph, water_temperature, turbidity

### Issuing Certificates

1. Ensure all rules show **Compliant** status
2. Profile must be **Enabled**
3. Click **Issue Certificate**
4. Certificate is generated with:
   - Immutable snapshot of compliance data
   - Cryptographic signature
   - Unique verification URL

### Verification

Certificates can be verified at:

```text
/verify/{certificate_id}
```

The verification page shows:

- Certificate status (VALID, REVOKED, TAMPERED, NOT_FOUND, VERIFICATION_UNAVAILABLE)
- Issuer and farm information
- Compliance evidence table
- Integrity block (version, algorithm, fingerprint)

### Certificate States

| State | Meaning |
|-------|---------|
| VALID | Certificate is authentic and not revoked |
| REVOKED | Certificate has been revoked by issuer |
| TAMPERED | Hash or signature verification failed |
| NOT_FOUND | No certificate exists with this ID |
| VERIFICATION_UNAVAILABLE | Signing secret not configured on server |

### Key Rotation Policy

**v1 uses a single signing key (`key_v1`)**:

- Changing `PASSPORT_SIGNING_SECRET` invalidates all existing signatures
- Multi-key rotation (`signatureKeyId` field) is a documented future extension
- Keep the secret secure and backed up — loss prevents verification of existing certificates

### Environment Variables

```bash
# Required for certificate signing
PASSPORT_SIGNING_SECRET=your-secure-random-string

# Optional - used for QR code generation
PASSPORT_PUBLIC_URL=https://your-domain.com
```

Generate a secure secret:

```bash
openssl rand -hex 32
```

### Transaction Strategy

The passport service uses a driver-aware transaction strategy:

- **postgres-js (local/Railway)**: Uses `db.transaction()` for atomic operations
- **Neon HTTP driver**: Falls back to ordered writes with optimistic `profileVersion` guard

This ensures data integrity regardless of database driver limitations.

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/passports` | List profiles and certificates |
| POST | `/api/passports` | Create profile |
| GET | `/api/passports/:id` | Get profile with compliance status |
| PATCH | `/api/passports/:id` | Update profile |
| DELETE | `/api/passports/:id` | Delete profile (certificates preserved) |
| POST | `/api/passports/:id/issue` | Issue certificate |
| POST | `/api/passports/preview` | Evaluate unsaved rules (profile form preview) |
| GET | `/api/passports/certificates/:id` | Get certificate details |
| POST | `/api/passports/certificates/:id?action=revoke` | Revoke certificate |

### Database Schema

Three tables support passports:

- `passport_profiles` - User-defined compliance profiles
- `passport_profile_channels` - Channel rules with min/max bounds
- `passport_certificates` - Issued certificates with snapshots and signatures

Run migrations to create tables:

```bash
npm run migrate
```
