# Scheduled Commands Implementation Summary

## What Was Implemented

A complete timed/scheduled commands system that allows users to schedule future commands from the web dashboard (e.g., "in 10 minutes, spray pesticide").

## Files Created

1. **`src/lib/services/scheduled-command.service.ts`** - Service layer for scheduled commands
2. **`src/lib/scheduler.ts`** - Background worker that executes due commands every 30 seconds
3. **`app/api/channels/[id]/scheduled-commands/route.ts`** - API endpoint to create scheduled commands
4. **`app/api/scheduled-commands/[id]/route.ts`** - API endpoint to cancel scheduled commands
5. **`drizzle/0001_add_scheduled_commands.sql`** - Database migration for new table
6. **`SCHEDULED_COMMANDS.md`** - Feature documentation
7. **`IMPLEMENTATION_SUMMARY.md`** - This file

## Files Modified

1. **`src/lib/db/schema.ts`** - Added `scheduledCommands` table definition
2. **`src/lib/types.ts`** - Added `ScheduledCommandView` type and updated `ControllerSnapshot`
3. **`src/lib/validators.ts`** - Added `scheduledCommandSchema` validator
4. **`src/lib/data.ts`** - Exported scheduled command service functions
5. **`src/lib/services/snapshot.service.ts`** - Added scheduled commands to controller snapshot
6. **`server.ts`** - Initialize scheduler on server startup
7. **`src/components/dashboard/controller-detail.tsx`** - Added Scheduled Commands Panel UI

## Key Features

### 1. Database Schema
- New `scheduled_commands` table with indexes
- Tracks pending, executed, cancelled, and failed commands
- Links to channels, controllers, users, and executed commands

### 2. Background Scheduler
- Runs every 30 seconds to check for due commands
- Automatically executes commands at scheduled time
- Handles failures gracefully
- Cleans up old commands (30+ days) daily

### 3. API Endpoints
- **POST** `/api/channels/[channelId]/scheduled-commands` - Schedule a command
- **DELETE** `/api/scheduled-commands/[id]` - Cancel a pending command

### 4. User Interface
- Schedule form with channel selection, action (on/off), date/time picker, and notes
- List of pending commands with cancel buttons
- History of executed/cancelled/failed commands
- Default time set to 10 minutes in the future

### 5. Integration
- Works with existing MQTT infrastructure
- Uses existing `createManualCommand()` for execution
- Respects user permissions and controller ownership
- Integrates with RTC module on hardware

## How It Works

1. **User schedules a command** via the web dashboard
2. **Command is stored** in the database with status `pending`
3. **Background scheduler** checks every 30 seconds for due commands
4. **When time arrives**, scheduler calls `createManualCommand()` to execute
5. **Command is sent** to device via MQTT (same as manual commands)
6. **Device acknowledges** and executes the command
7. **Status is updated** to `executed` (or `failed` if error occurs)

## Next Steps

### 1. Run Database Migration

```bash
npm run migrate
```

This creates the `scheduled_commands` table.

### 2. Test the Feature

1. Start the server: `npm run dev` or `npm start`
2. Navigate to a controller detail page
3. Click "Schedule" in the Scheduled Commands section
4. Schedule a command for 1-2 minutes in the future
5. Wait and verify it executes

### 3. Monitor Logs

Watch for scheduler activity in server logs:

```
[Scheduler] Starting scheduled command processor
[Scheduler] Processed 1 commands: succeeded=1, failed=0
```

## Example Use Cases

1. **Pesticide spraying**: "In 10 minutes, turn on spray pump for 15 minutes"
2. **Irrigation scheduling**: "Tomorrow at 6:00 AM, turn on irrigation valve"
3. **UV zapper timing**: "Tonight at 8:00 PM, turn on UV zapper"
4. **Maintenance windows**: "In 1 hour, turn off all pumps for maintenance"

## Technical Notes

- Scheduler runs in the same process as the web server
- Commands execute within 30 seconds of scheduled time (scheduler interval)
- Only actuator/hybrid channels can be scheduled (sensors are read-only)
- Scheduled commands require server to be running at execution time
- If server is down, commands execute when it restarts (if still due)
- All scheduled commands respect user permissions and controller ownership

## Future Enhancements

Consider adding:
- Recurring schedules (daily, weekly)
- Conditional execution (based on sensor readings)
- Command sequences/chains
- Time zone support
- Email/push notifications
- Bulk scheduling
