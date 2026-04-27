# Auto Spray Pump Schedule Feature

## Overview

This feature allows you to set daily start and end times for the spray pump to automatically turn on and off. This is useful for:

- Daily pesticide application windows (e.g., turn on at 6:00 AM, turn off at 8:00 AM)
- Automated pest control routines
- Consistent spray schedules without manual intervention

## How It Works

### 1. User Configuration

Users set the spray pump start and end times via the dashboard:
- **Turn on at**: Time to automatically turn on the spray pump (e.g., "06:00")
- **Turn off at**: Time to automatically turn off the spray pump (e.g., "08:00")

### 2. Auto-Schedule Processing

The system automatically creates scheduled commands for the next occurrence:

```
User sets: Turn on at 06:00, Turn off at 08:00
System creates:
  - Scheduled command: Turn ON spray pump tomorrow at 06:00
  - Scheduled command: Turn OFF spray pump tomorrow at 08:00
```

### 3. Command Execution

- At 06:00, the scheduled command executes → spray pump turns ON
- At 08:00, the scheduled command executes → spray pump turns OFF
- After execution, new commands are created for the next day

### 4. Continuous Operation

The system ensures there's always a pending command for the next occurrence:
- Checks every hour to ensure commands are scheduled
- After a command executes, creates the next day's command
- Handles server restarts gracefully

## Architecture

### Database Schema

Added two new columns to `pest_control_schedules`:

```sql
ALTER TABLE "pest_control_schedules" 
  ADD COLUMN "spray_pump_start_time" text,
  ADD COLUMN "spray_pump_end_time" text;
```

### Auto-Schedule Service

**`src/lib/services/auto-schedule.service.ts`** provides:

- `processAutoSchedules()` - Main function that creates scheduled commands
- `scheduleSprayPumpAutoCommands()` - Creates spray pump on/off commands
- `scheduleUvZapperAutoCommands()` - Creates UV zapper on/off commands

### Scheduler Integration

The background scheduler (`src/lib/scheduler.ts`) now:

1. **On startup**: Creates auto-schedule commands immediately
2. **Every 30 seconds**: Executes due commands, then checks for new auto-schedules
3. **Every hour**: Ensures auto-schedule commands are always set
4. **After command execution**: Creates the next day's command

### Smart Scheduling Logic

The system prevents duplicate commands:

```typescript
// Only creates a command if one doesn't already exist
const hasPendingStart = existingCommands.some(
  (cmd) => 
    cmd.status === "pending" && 
    cmd.desiredBooleanState === true &&
    cmd.note.includes("Auto-schedule: Turn on")
);

if (!hasPendingStart) {
  // Create new scheduled command
}
```

## User Interface

The Pest Control Schedule panel now includes:

```
┌─────────────────────────────────────────┐
│ Spray Pump Auto On/Off                  │
├─────────────────────────────────────────┤
│ Turn on at:  [06:00]                    │
│ Turn off at: [08:00]                    │
│                                         │
│ Automatically turn spray pump on/off    │
│ at specified times daily                │
└─────────────────────────────────────────┘
```

## Usage Example

### Setting Up Daily Spray Schedule

1. Navigate to controller detail page
2. Scroll to "Pest Control" → "Spray schedule"
3. Set spray pump times:
   - **Turn on at**: 06:00
   - **Turn off at**: 08:00
4. Click "Save Schedule"

### What Happens Next

**Immediately:**
- Schedule saved to database
- Auto-schedule processor creates two scheduled commands:
  - Turn ON at tomorrow 06:00 (or today if before 06:00)
  - Turn OFF at tomorrow 08:00 (or today if before 08:00)

**At 06:00:**
- Scheduled command executes
- Spray pump turns ON
- New command created for tomorrow at 06:00

**At 08:00:**
- Scheduled command executes
- Spray pump turns OFF
- New command created for tomorrow at 08:00

**Every day:**
- Process repeats automatically
- No manual intervention needed

## Viewing Scheduled Commands

The "Scheduled Commands" panel shows auto-scheduled commands:

```
┌─────────────────────────────────────────┐
│ Spray Pump                              │
│ Turn On                                 │
│ Auto-schedule: Turn on at 06:00         │
│ Scheduled for Apr 28, 2026 6:00 AM     │
│                              [Cancel]   │
└─────────────────────────────────────────┘
```

## Cancelling Auto-Schedules

To stop the auto-schedule:

**Option 1: Clear the times**
- Set both "Turn on at" and "Turn off at" to empty
- Save schedule
- Existing scheduled commands remain but won't be recreated

**Option 2: Cancel individual commands**
- Go to "Scheduled Commands" panel
- Click "Cancel" on specific commands

**Option 3: Disable pest control**
- Uncheck "Enabled" in Pest Control Schedule
- Save schedule
- Auto-schedules won't be created

## Integration with RTC Module

The spray pump auto-schedule works seamlessly with your RTC module:

### Server-Side Scheduling
- Server creates scheduled commands based on configured times
- Background processor executes commands at the right time
- Commands sent to device via MQTT

### Device-Side Execution
- Device receives command via MQTT (same as manual commands)
- Device executes immediately
- Device can use RTC for logging actual execution time

### Example Device Code

```cpp
void handleCommand(JsonObject cmd) {
  String note = cmd["note"];
  
  // Check if this is an auto-scheduled command
  if (note.indexOf("Auto-schedule") >= 0) {
    Serial.println("Executing auto-scheduled command");
    
    // Log with RTC timestamp
    DateTime now = rtc.now();
    Serial.print("Executed at: ");
    Serial.println(now.timestamp());
  }
  
  // Execute command normally
  String channelKey = cmd["channelKey"];
  bool desiredState = cmd["desiredBooleanState"];
  
  if (channelKey == "spray_pump") {
    digitalWrite(SPRAY_PUMP_PIN, desiredState ? HIGH : LOW);
  }
  
  // Acknowledge
  acknowledgeCommand(cmd["id"], "acknowledged", "Auto-schedule executed");
}
```

## Comparison with Spray Time Slots

The system now has two ways to schedule spray pump operation:

### Spray Time Slots (Existing)
- Multiple time slots per day
- Each slot has duration (e.g., 15 minutes)
- Device-side execution (device checks schedule)
- Good for: Multiple short spray sessions

### Auto On/Off Times (New)
- Single on time, single off time per day
- Server-side execution (creates scheduled commands)
- Good for: Long spray windows, guaranteed execution

### Using Both Together

You can use both features simultaneously:

```
Auto On/Off:
  Turn on at:  06:00
  Turn off at: 18:00

Spray Time Slots:
  1. 07:00 for 15 minutes
  2. 12:00 for 15 minutes
  3. 17:00 for 15 minutes
```

This ensures:
- Spray pump is available from 06:00 to 18:00
- Specific spray sessions at 07:00, 12:00, and 17:00
- Pump automatically turns off at 18:00

## Troubleshooting

### Commands not being created

**Check:**
1. Pest control schedule is enabled
2. Start/end times are set
3. Spray pump channel exists
4. Server is running

**Logs to check:**
```
[AutoSchedule] Created spray pump ON command for Controller1 at 2026-04-28T06:00:00Z
[AutoSchedule] Created spray pump OFF command for Controller1 at 2026-04-28T08:00:00Z
```

### Commands not executing

**Check:**
1. Scheduled commands panel shows pending commands
2. Scheduled time is in the future
3. Background scheduler is running
4. MQTT connection is active

**Logs to check:**
```
[Scheduler] Processed 1 commands: succeeded=1, failed=0
[ScheduledCommand] Executed scheduled command schcmd_xxx for channel Spray Pump
```

### Duplicate commands

The system prevents duplicates automatically. If you see duplicates:
1. Check for multiple server instances
2. Restart the server
3. Manually cancel duplicate commands

## Database Migration

Apply the migration to add the new columns:

```bash
npm run migrate
```

This runs `drizzle/0002_add_spray_pump_schedule.sql`:

```sql
ALTER TABLE "pest_control_schedules" 
  ADD COLUMN IF NOT EXISTS "spray_pump_start_time" text;
ALTER TABLE "pest_control_schedules" 
  ADD COLUMN IF NOT EXISTS "spray_pump_end_time" text;
```

## Testing

### Manual Test

1. Set spray pump times for 2 minutes in the future:
   - Turn on at: [current time + 2 minutes]
   - Turn off at: [current time + 5 minutes]
2. Save schedule
3. Check "Scheduled Commands" panel for pending commands
4. Wait and verify execution

### Automated Test

```bash
# Check auto-schedule processing
npx tsx -e "
import { processAutoSchedules } from './src/lib/services/auto-schedule.service';
processAutoSchedules().then(console.log);
"
```

## Notes

- Auto-schedules use 24-hour time format (HH:MM)
- Times are in the server's timezone
- Commands are created for the next occurrence (today or tomorrow)
- After execution, new commands are created automatically
- Clearing times stops future auto-schedules but doesn't cancel existing ones
- Works alongside manual commands and spray time slots

## Future Enhancements

Potential improvements:

1. **Multiple time windows**: Support multiple on/off pairs per day
2. **Day-specific schedules**: Different times for different days of the week
3. **Seasonal adjustments**: Automatically adjust times based on sunrise/sunset
4. **Duration-based**: Instead of end time, specify duration (e.g., run for 2 hours)
5. **Conditional execution**: Only run if certain conditions are met (e.g., no rain)
