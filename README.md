# GanSystems Dashboard

Multi-user Next.js dashboard for GanSystems, backed by SQLite and designed for ESP32-based smart water and irrigation monitoring.

## Stack

- Next.js 15 + React 19
- TypeScript
- SQLite via `better-sqlite3`
- Drizzle ORM
- Recharts
- Zod

## Local Run

1. Install dependencies:

```bash
npm install
```

2. Start the app:

```bash
npm run dev
```

3. Open:

```text
http://localhost:3000
```

## Database

- SQLite file: `data/gansys.sqlite`
- Tables are created automatically when the app starts.
- You can also run:

```bash
npm run migrate
npm run seed
```

## Demo Account

- Email: `demo@gansys.app`
- Password: `demo1234`

## ESP32 Sync API

POST `/api/device/sync`

Required headers:

- `x-device-id`
- `x-device-key`

Example body:

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

The response returns:

- `serverTime`
- controller heartbeat metadata
- channel config for firmware use
- pending manual commands queued from the dashboard
