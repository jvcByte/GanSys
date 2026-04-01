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

## Run On The Internet

This app can be exposed on the public internet, but it should be run as a persistent Node.js server because it uses SQLite via `better-sqlite3`.

### Railway Deployment

This repository includes a `railway.json` file so Railway uses the correct build command, start command, and a healthcheck path that returns HTTP `200`.

Use these service settings on Railway:

- Attach a persistent volume for SQLite.
- Mount the volume to `/app/data` or another writable path.
- Keep the healthcheck path on `/api/health`.
- Do not point the healthcheck at `/` because this app redirects from `/` and Railway healthchecks require a `200` response.

This app automatically uses `RAILWAY_VOLUME_MOUNT_PATH` when Railway provides it, so a mounted volume becomes the database directory without extra code changes.

If Railway logs show a permission error when opening the SQLite file on the mounted volume, set `RAILWAY_RUN_UID=0` on the service. Railway volumes are mounted as `root`, and non-root containers can fail to write there.

### Recommended Production Setup

Use a VPS, cloud VM, or any server where you control:

- a public IP or domain
- a persistent disk for `data/gansys.sqlite`
- a long-running Node.js process

### Production Steps

1. Copy the project to your server.

2. Install dependencies:

```bash
npm install
```

3. Build the app:

```bash
npm run build
```

4. Start the app so it listens on the network:

```bash
npm run start -- --hostname 0.0.0.0 --port 3000
```

5. Put a reverse proxy such as Nginx or Caddy in front of the app and route your domain to port `3000`.

6. Enable HTTPS on your domain.

7. Make sure the `data/` folder is stored on persistent storage and backed up regularly.

### Important Notes

- Do not rely on a serverless filesystem for SQLite persistence.
- If the server is restarted or replaced, keep the same `data/gansys.sqlite` file or restore it from backup.
- Open only the ports you need, typically `80` and `443`.
- Keep the server clock correct because command timing and telemetry timestamps depend on it.

### ESP32 Change For Internet Deployment

After deploying, update the ESP32 firmware from a LAN URL such as:

```cpp
const char* SERVER_URL = "http://192.168.90.111:3000/api/device/sync";
```

to your public HTTPS endpoint:

```cpp
const char* SERVER_URL = "https://your-domain.com/api/device/sync";
```

### Temporary Remote Testing

If you only want to test from outside your local machine without doing a full deployment yet, you can:

1. Run the app on your computer with network binding:

```bash
npm run dev -- --hostname 0.0.0.0 --port 3000
```

2. Expose it using either:

- a tunnel service
- router port forwarding plus a public IP or dynamic DNS

This is fine for testing, but it is not a good production setup because:

- your computer must stay on
- your local SQLite database stays on that machine
- public exposure from a personal machine is less reliable and less secure

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
