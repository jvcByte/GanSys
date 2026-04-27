# Spray Pump Auto On/Off Schedule - Implementation Summary

## What Was Added

A daily auto on/off schedule for the spray pump that automatically turns it on and off at specified times every day.

## Changes Made

### 1. Database Schema
**File**: `src/lib/db/schema.ts`
- Added `sprayPumpStartTime` column to `pest_control_schedules`
- Added `sprayPumpEndTime` column to `pest_control_schedules`

**Migration**: `drizzle/0002_add_spray_pump_schedule.sql`

### 2. Types
**File**: `src/lib/types.ts`
- Updated `PestControlSchedule` type with new fields

### 3. Services

**New File**: `src/lib/services/auto-schedule.service.ts`
- `processAutoSchedules()` - Creates scheduled commands for auto on/off times
- `scheduleSprayPumpAutoCommands()` - Handles spray pump scheduling
- `scheduleUvZapperAutoCommands()` - Handles UV zapper scheduling

**Updated**: `src/lib/services/pest.service.ts`
- Updated `hydrateSchedule()` to include new fields
- Updated `upsertPestSchedule()` to save new fields

### 4. Scheduler
**File**: `src/lib/scheduler.ts`
- Added auto-schedule processing on startup
- Added hourly auto-schedule check
- Triggers auto-schedule after command execution

### 5. API
**File**: `app/api/controllers/[id]/pest-schedule/route.ts`
- Updated to accept new fields
- Triggers auto-schedule processing after save

### 6. Validators
**File**: `src/lib/validators.ts`
- Updated `pestScheduleSchema` with new optional fields

### 7. UI
**File**: `src/components/dashboard/controller-detail.tsx`
- Added "Spray Pump Auto On/Off" section
- Two time inputs: "Turn on at" and "Turn off at"
- Help text explaining the feature

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│ User sets times in dashboard                                │
│   Turn on at: 06:00                                         │
│   Turn off at: 08:00                                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Auto-schedule service creates scheduled commands            │
│   - Command 1: Turn ON at tomorrow 06:00                   │
│   - Command 2: Turn OFF at tomorrow 08:00                  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Background scheduler executes at scheduled time             │
│   06:00 → Spray pump turns ON                              │
│   08:00 → Spray pump turns OFF                             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ After execution, new commands created for next day          │
│   - Command 3: Turn ON at next day 06:00                   │
│   - Command 4: Turn OFF at next day 08:00                  │
└─────────────────────────────────────────────────────────────┘
```

## Key Features

✅ **Daily Recurring**: Automatically repeats every day
✅ **Self-Sustaining**: Creates next day's commands after execution
✅ **No Duplicates**: Smart logic prevents duplicate commands
✅ **Hourly Check**: Ensures commands are always scheduled
✅ **Immediate Trigger**: Creates commands as soon as schedule is saved
✅ **Works with RTC**: Integrates with your existing RTC module
✅ **Visible in UI**: Shows up in Scheduled Commands panel
✅ **Cancellable**: Can cancel individual commands or clear times

## Usage

### Setting Up

1. Go to controller detail page
2. Find "Pest Control" → "Spray schedule"
3. Set times:
   ```
   Spray Pump Auto On/Off
   Turn on at:  [06:00]
   Turn off at: [08:00]
   ```
4. Click "Save Schedule"

### What Happens

- **Immediately**: Two scheduled commands created
- **At 06:00**: Spray pump turns ON automatically
- **At 08:00**: Spray pump turns OFF automatically
- **After execution**: New commands created for next day
- **Every day**: Process repeats indefinitely

### Stopping

**Option 1**: Clear both times and save
**Option 2**: Uncheck "Enabled" in pest control
**Option 3**: Cancel individual commands in Scheduled Commands panel

## Testing

### Quick Test (2 minutes)

1. Set times for 2 minutes from now:
   - Turn on at: [current time + 2 min]
   - Turn off at: [current time + 5 min]
2. Save schedule
3. Check "Scheduled Commands" panel
4. Wait and verify execution

### Check Logs

```bash
# Server logs will show:
[AutoSchedule] Created spray pump ON command for Controller1 at 2026-04-28T06:00:00Z
[AutoSchedule] Created spray pump OFF command for Controller1 at 2026-04-28T08:00:00Z
[Scheduler] Processed 1 commands: succeeded=1, failed=0
```

## Database Migration

Run the migration to add the new columns:

```bash
npm run migrate
```

## Documentation

- **AUTO_SPRAY_SCHEDULE.md** - Detailed feature documentation
- **SCHEDULED_COMMANDS.md** - General scheduled commands documentation
- **DEVICE_INTEGRATION.md** - Device/Arduino integration guide

## Benefits

1. **Consistent Schedule**: Spray pump runs at the same time every day
2. **No Manual Work**: Set once, runs forever
3. **Reliable**: Server-side execution ensures it happens
4. **Flexible**: Can change times anytime
5. **Visible**: See upcoming commands in dashboard
6. **Controllable**: Can cancel or modify as needed

## Example Use Cases

- **Morning spray routine**: Turn on at 6 AM, off at 8 AM
- **Evening spray routine**: Turn on at 6 PM, off at 8 PM
- **All-day operation**: Turn on at 6 AM, off at 6 PM
- **Night operation**: Turn on at 8 PM, off at 6 AM (next day)

## Notes

- Times are in 24-hour format (HH:MM)
- Uses server timezone
- Works alongside spray time slots
- Works alongside manual commands
- Commands visible in Scheduled Commands panel
- Can be cancelled individually
- Automatically recreates after execution
