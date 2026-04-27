# Scheduled Commands Feature

## Overview

The scheduled commands feature allows users to schedule future commands to be executed at specific times. This is useful for automating tasks like:

- Spraying pesticides at a specific time (e.g., "in 10 minutes, turn on spray pump")
- Turning on irrigation at dawn
- Activating UV zappers at dusk
- Any time-based automation for actuators

## Architecture

### Database Schema

A new `scheduled_commands` table stores pending, executed, cancelled, and failed scheduled commands:

```sql
CREATE TABLE scheduled_commands (
  id TEXT PRIMARY KEY,
  controller_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL,
  command_type TEXT NOT NULL,
  desired_boolean_state BOOLEAN,
  desired_numeric_value DOUBLE PRECISION,
  note TEXT DEFAULT '' NOT NULL,
  scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL,
  executed_command_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  executed_at TIMESTAMP WITH TIME ZONE,
  cancelled_at TIMESTAMP WITH TIME ZONE,
  failure_reason TEXT
);
```

### Background Scheduler

A background worker (`src/lib/scheduler.ts`) runs every 30 seconds to:

1. Check for scheduled commands where `scheduled_for <= NOW()` and `status = 'pending'`
2. Execute each due command by calling `createManualCommand()`
3. Update the scheduled command status to `executed` or `failed`
4. Clean up old executed commands (older than 30 days) once per day

The scheduler is automatically started when the server starts (in `server.ts`).

### Service Layer

**`src/lib/services/scheduled-command.service.ts`** provides:

- `createScheduledCommand()` - Create a new scheduled command
- `getScheduledCommandsByController()` - List scheduled commands for a controller
- `cancelScheduledCommand()` - Cancel a pending scheduled command
- `processDueScheduledCommands()` - Execute due commands (called by scheduler)
- `cleanupOldScheduledCommands()` - Remove old executed commands

### API Endpoints

**POST `/api/channels/[id]/scheduled-commands`**
- Schedule a new command for a specific channel
- Body: `{ desiredBooleanState, note, scheduledFor }`
- Returns: Created scheduled command

**DELETE `/api/scheduled-commands/[id]`**
- Cancel a pending scheduled command
- Returns: Updated scheduled command with status `cancelled`

### UI Components

The controller detail page (`src/components/dashboard/controller-detail.tsx`) includes a new **Scheduled Commands Panel** that shows:

- A form to schedule new commands (channel, action, date/time, note)
- List of pending scheduled commands with cancel buttons
- History of executed/cancelled/failed commands

## Usage

### From the Web Dashboard

1. Navigate to a controller detail page
2. Scroll to the "Scheduled Commands" section
3. Click "Schedule" to open the form
4. Select:
   - **Channel**: Which actuator to control (e.g., spray pump, irrigation valve)
   - **Action**: Turn On or Turn Off
   - **Date & Time**: When to execute the command
   - **Note**: Optional description (e.g., "Spray pesticide for 15 minutes")
5. Click "Schedule Command"
6. The command will appear in the pending list
7. At the scheduled time, the background worker will execute it automatically

### Cancelling a Scheduled Command

- Click the "Cancel" button next to any pending command
- The command status will change to `cancelled` and it won't be executed

### Integration with RTC Module

Since you're using an RTC (Real-Time Clock) module on your hardware:

1. **Server-side scheduling**: The web dashboard schedules commands on the server
2. **Background execution**: The scheduler runs on the server and executes commands at the right time
3. **MQTT delivery**: When executed, the command is sent to the device via MQTT (same as manual commands)
4. **Device acknowledgement**: The device receives the command and acknowledges it

The RTC module on your device can be used for:
- Local time-keeping when offline
- Validating command timestamps
- Logging when commands were actually executed

## Database Migration

To apply the new schema:

```bash
npm run migrate
```

This will create the `scheduled_commands` table with all necessary indexes and foreign keys.

## Testing

### Manual Testing

1. Schedule a command for 1-2 minutes in the future
2. Wait for the scheduled time
3. Check that:
   - The command appears in the "Recent log" section
   - The device receives and executes the command
   - The scheduled command status changes to `executed`

### Monitoring

Check server logs for scheduler activity:

```
[Scheduler] Starting scheduled command processor
[Scheduler] Processed 1 commands: succeeded=1, failed=0
[ScheduledCommand] Executed scheduled command schcmd_xxx for channel Spray Pump
```

## Future Enhancements

Potential improvements:

1. **Recurring schedules**: Daily/weekly repeating commands
2. **Conditional execution**: Only execute if certain conditions are met (e.g., soil moisture below threshold)
3. **Command sequences**: Chain multiple commands together
4. **Time zones**: Support for different time zones
5. **Notifications**: Alert users when scheduled commands execute or fail
6. **Bulk scheduling**: Schedule multiple commands at once

## Notes

- Scheduled commands require the server to be running at the scheduled time
- If the server is down, commands will execute when it comes back online (if still within a reasonable window)
- The scheduler checks every 30 seconds, so commands may execute up to 30 seconds after the scheduled time
- Only actuator and hybrid channels can be scheduled (sensors are read-only)
- Scheduled commands respect the same permissions as manual commands
