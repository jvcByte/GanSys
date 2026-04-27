# Quick Start Guide

## Prerequisites

- Node.js 20.9.0 or higher
- PostgreSQL database (local or Neon cloud)
- MQTT broker (optional, for device integration)

## Setup Steps

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.env` file in the project root:

```env
# Database (choose one)
# Option A: Local PostgreSQL
DATABASE_URL=postgresql://user@localhost:5432/gansytems

# Option B: Neon Cloud
# DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/dbname?sslmode=require

# MQTT (optional)
MQTT_BROKER_URL=mqtts://your-broker.hivemq.cloud:8883
MQTT_USERNAME=your_username
MQTT_PASSWORD=your_password

# Environment
NODE_ENV=development
```

### 3. Run Database Migrations

```bash
npm run migrate
```

This will create:
- All existing tables (users, controllers, channels, etc.)
- New `scheduled_commands` table
- New columns in `pest_control_schedules` table

### 4. Start the Application

```bash
npm run dev:server
```

The application will start on `http://localhost:3000`

You should see:
```
[Server] Ready on http://0.0.0.0:3000
[MQTT] Connected to broker (if configured)
[Scheduler] Starting scheduled command processor
[Scheduler] Initial run: processed=0, succeeded=0, failed=0
[AutoSchedule] Initial auto-schedule: created 0 commands
```

## Testing the New Features

### Test 1: Scheduled Commands

1. **Navigate** to a controller detail page
2. **Scroll** to "Scheduled Commands" section
3. **Click** "Schedule" button
4. **Fill in** the form:
   - Channel: Select a spray pump or valve
   - Action: Turn On
   - Date: Today
   - Time: 2 minutes from now
   - Note: "Test scheduled command"
5. **Click** "Schedule Command"
6. **Wait** 2 minutes and verify execution

**Expected Result**:
- Command appears in pending list
- At scheduled time, command executes
- Device receives command via MQTT
- Command moves to history with status "executed"

### Test 2: Auto Spray Schedule

1. **Navigate** to a controller detail page
2. **Scroll** to "Pest Control" → "Spray schedule"
3. **Set** spray pump times:
   - Turn on at: 06:00
   - Turn off at: 18:00
4. **Click** "Save Schedule"
5. **Check** "Scheduled Commands" panel

**Expected Result**:
- Two scheduled commands created automatically
- One for turning ON at 06:00
- One for turning OFF at 18:00
- Commands show "Auto-schedule" in note

### Test 3: Background Scheduler

**Check server logs** for scheduler activity:

```
[Scheduler] Starting scheduled command processor
[AutoSchedule] Created spray pump ON command for Controller1 at 2026-04-28T06:00:00Z
[AutoSchedule] Created spray pump OFF command for Controller1 at 2026-04-28T18:00:00Z
[Scheduler] Processed 1 commands: succeeded=1, failed=0
```

## Troubleshooting

### Database Connection Error

**Error**: `Error: connect ECONNREFUSED`

**Solution**:
1. Ensure PostgreSQL is running
2. Check DATABASE_URL is correct
3. Verify database exists: `psql -l`

### MQTT Not Connected

**Warning**: `[MQTT] MQTT_BROKER_URL not set — MQTT client disabled.`

**Solution**:
- This is normal if MQTT is not configured
- Features work without MQTT (commands stored in database)
- To enable MQTT, set MQTT_BROKER_URL in .env

### Scheduler Not Running

**Issue**: No scheduler logs appear

**Solution**:
1. Check server started with `npm run dev:server` (not `npm run dev`)
2. Look for `[Scheduler] Starting` message
3. Restart server if needed

### Migrations Failed

**Error**: `Migration failed`

**Solution**:
1. Check DATABASE_URL is correct
2. Ensure database exists
3. Check database user has CREATE TABLE permissions
4. Try running migrations manually:
   ```bash
   npx tsx scripts/migrate.ts
   ```

## Development Commands

```bash
# Start development server (with scheduler)
npm run dev:server

# Start Next.js dev server only (no scheduler)
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run tests
npm test

# Run tests in watch mode
npm test:watch

# Run migrations
npm run migrate

# Test new features
npx tsx scripts/test-new-features.ts

# Test scheduler manually
npx tsx scripts/test-scheduler.ts
```

## Project Structure

```
.
├── app/                          # Next.js app directory
│   ├── api/                      # API routes
│   │   ├── channels/[id]/
│   │   │   └── scheduled-commands/  # NEW: Schedule commands
│   │   ├── scheduled-commands/[id]/ # NEW: Cancel commands
│   │   └── controllers/[id]/
│   │       └── pest-schedule/    # UPDATED: Auto schedule
│   └── dashboard/                # Dashboard pages
├── src/
│   ├── components/               # React components
│   │   └── dashboard/
│   │       └── controller-detail.tsx  # UPDATED: New panels
│   ├── lib/
│   │   ├── db/
│   │   │   └── schema.ts         # UPDATED: New tables
│   │   ├── services/
│   │   │   ├── scheduled-command.service.ts  # NEW
│   │   │   ├── auto-schedule.service.ts      # NEW
│   │   │   └── pest.service.ts   # UPDATED
│   │   ├── scheduler.ts          # NEW: Background worker
│   │   ├── types.ts              # UPDATED: New types
│   │   └── validators.ts         # UPDATED: New schemas
├── drizzle/                      # Database migrations
│   ├── 0001_add_scheduled_commands.sql      # NEW
│   └── 0002_add_spray_pump_schedule.sql     # NEW
├── scripts/
│   ├── migrate.ts                # Migration runner
│   ├── test-new-features.ts      # NEW: Feature tests
│   └── test-scheduler.ts         # NEW: Scheduler test
└── server.ts                     # UPDATED: Scheduler init
```

## API Endpoints

### New Endpoints

**POST `/api/channels/:id/scheduled-commands`**
- Create a scheduled command
- Body: `{ desiredBooleanState, note, scheduledFor }`
- Returns: Created scheduled command

**DELETE `/api/scheduled-commands/:id`**
- Cancel a pending scheduled command
- Returns: Updated scheduled command

### Updated Endpoints

**PUT `/api/controllers/:id/pest-schedule`**
- Now accepts `sprayPumpStartTime` and `sprayPumpEndTime`
- Triggers auto-schedule processing
- Returns: Updated schedule

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `MQTT_BROKER_URL` | No | MQTT broker URL (optional) |
| `MQTT_USERNAME` | No | MQTT username (if broker requires) |
| `MQTT_PASSWORD` | No | MQTT password (if broker requires) |
| `NODE_ENV` | No | Environment (development/production) |
| `PORT` | No | Server port (default: 3000) |
| `HOSTNAME` | No | Server hostname (default: 0.0.0.0) |

## Next Steps

1. ✅ Application is running
2. ✅ Features are tested
3. 📱 Connect your Arduino/ESP32 device
4. 🔧 Configure MQTT for real-time updates
5. 📊 Monitor scheduler logs
6. 🚀 Deploy to production

## Support

- **Documentation**: See `*.md` files in project root
- **Test Report**: See `TEST_REPORT.md`
- **Feature Docs**: See `SCHEDULED_COMMANDS.md` and `AUTO_SPRAY_SCHEDULE.md`
- **Device Integration**: See `DEVICE_INTEGRATION.md`

## Production Deployment

See `railway.json` for Railway deployment configuration.

For other platforms:
1. Set environment variables
2. Run `npm run build`
3. Run `npm start`
4. Ensure database is accessible
5. Configure MQTT broker

---

**Ready to go!** 🚀

Your scheduled commands and auto spray schedule features are fully functional and ready for use.
