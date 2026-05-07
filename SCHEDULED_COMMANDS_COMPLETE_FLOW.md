# Complete Scheduled Commands Flow Analysis

## 📋 Current Implementation (Server-Side Scheduling)

### Step-by-Step Flow: "Turn pump on at 3:00 PM"

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CURRENT FLOW (SERVER-SIDE)                       │
└─────────────────────────────────────────────────────────────────────┘

1. USER CREATES SCHEDULED COMMAND (Dashboard UI)
   │
   ├─→ User clicks "Schedule" button
   ├─→ Selects channel: "Pump"
   ├─→ Sets action: "Turn On"
   ├─→ Sets date: 2024-05-04
   ├─→ Sets time: 15:00 (3:00 PM)
   │
   └─→ Frontend sends:
       POST /api/channels/{channelId}/scheduled-commands
       {
         "desiredBooleanState": true,
         "scheduledFor": "2024-05-04T15:00:00.000Z",  // UTC time
         "note": "Afternoon watering"
       }

2. SERVER STORES IN DATABASE
   │
   ├─→ File: app/api/channels/[id]/scheduled-commands/route.ts
   ├─→ Calls: createScheduledCommand(userId, channelId, {...})
   │
   └─→ Inserts into scheduledCommands table:
       {
         id: "schcmd_abc123",
         controllerId: "esp32_ctrl_001",
         channelId: "ch_pump_main",
         requestedByUserId: "user_xyz",
         commandType: "set_state",
         desiredBooleanState: true,
         scheduledFor: "2024-05-04T15:00:00.000Z",
         status: "pending",  ← KEY: Stays pending until scheduled time
         createdAt: "2024-05-04T10:30:00.000Z"
       }

3. SERVER SCHEDULER RUNS (Every 30 seconds)
   │
   ├─→ File: src/lib/scheduler.ts
   ├─→ Function: processDueScheduledCommands()
   ├─→ Query: SELECT * FROM scheduled_commands 
   │          WHERE status='pending' 
   │          AND scheduled_for <= NOW()
   │
   ├─→ At 2:59:45 PM: No results (too early)
   ├─→ At 3:00:15 PM: Finds your scheduled command! ✓
   │
   └─→ Creates REGULAR command in commands table:
       {
         id: "cmd_xyz789",
         controllerId: "esp32_ctrl_001",
         channelId: "ch_pump_main",
         commandType: "set_state",
         desiredBooleanState: true,
         status: "pending",  ← Now in regular commands!
         overrideUntil: "2024-05-04T15:02:00.000Z",
         createdAt: "2024-05-04T15:00:15.000Z"
       }
       
       Updates scheduledCommands:
       {
         status: "executed",  ← Changed from pending
         executedAt: "2024-05-04T15:00:15.000Z",
         executedCommandId: "cmd_xyz789"
       }

4. ESP32 SYNCS WITH SERVER (Every 3 seconds)
   │
   ├─→ At 3:00:18 PM: ESP32 sends sync request
   │   POST /api/device/sync
   │   Headers: 
   │     x-device-id: ESP32-CONTROLLER
   │     x-device-key: rX0Wb8B8MyynWss9-gjLSSyiktDcc8gO
   │   Body: {
   │     firmwareVersion: "1.0.0",
   │     readings: [...],
   │     acknowledgements: [...]
   │   }
   │
   ├─→ Server processes (device-sync.service.ts):
   │   - Updates controller lastSeenAt
   │   - Processes readings
   │   - Queries pending commands:
   │     SELECT * FROM commands 
   │     WHERE controller_id='esp32_ctrl_001' 
   │     AND status='pending'
   │
   └─→ Server Response:
       {
         "serverTime": "2024-05-04T15:00:18.000Z",
         "pendingCommands": [
           {
             "commandId": "cmd_xyz789",
             "channelKey": "pump_main",
             "commandType": "set_state",
             "desiredBooleanState": true,
             "overrideMinutes": 2,
             "note": "Scheduled command executed at..."
           }
         ]
       }
       
       ⚠️ NOTE: scheduledFor is NOT sent to ESP32!
       ⚠️ The command is already converted to regular command

5. ESP32 PROCESSES COMMAND (Immediately)
   │
   ├─→ File: water_tank.ino
   ├─→ Function: processPendingCommands()
   ├─→ Line 476-520
   │
   ├─→ Checks:
   │   ✓ commandId exists
   │   ✓ channelKey matches "pump_main"
   │   ✓ commandType is "set_state"
   │   ✓ desiredBooleanState is true
   │   ✓ Tank level < 90% (not full)
   │
   ├─→ Sets manual override:
   │   manualOverrideActive = true
   │   manualOverrideDesiredState = true
   │   manualOverrideExpiresAtEpoch = nowEpoch + 120 seconds
   │
   ├─→ Queues acknowledgement:
   │   queueAck("cmd_xyz789", "acknowledged", "Manual override active")
   │
   └─→ Applies pump control:
       setPump(true)  → Pump turns ON! ✓

6. ESP32 SENDS ACKNOWLEDGEMENT (Next sync - 3 seconds later)
   │
   ├─→ At 3:00:21 PM: ESP32 syncs again
   │   Body: {
   │     acknowledgements: [
   │       {
   │         commandId: "cmd_xyz789",
   │         status: "acknowledged",
   │         deviceMessage: "Manual override active"
   │       }
   │     ]
   │   }
   │
   └─→ Server updates commands table:
       {
         status: "acknowledged",  ← Changed from pending
         acknowledgedAt: "2024-05-04T15:00:21.000Z",
         deviceMessage: "Manual override active"
       }

7. PUMP RUNS FOR 2 MINUTES
   │
   ├─→ Manual override expires at 3:02 PM
   ├─→ Automatic control resumes
   └─→ Pump state depends on tank level
```

## ⏱️ Timeline Summary

```
2:55:00 PM - User creates scheduled command
2:55:01 PM - Stored in scheduledCommands table (status: pending)
2:59:45 PM - Scheduler checks (too early, no action)
3:00:15 PM - Scheduler checks (finds command, creates regular command)
3:00:18 PM - ESP32 syncs (receives command)
3:00:18 PM - ESP32 turns pump ON
3:00:21 PM - ESP32 sends acknowledgement
3:02:18 PM - Manual override expires, automatic control resumes
```

**Total delay from scheduled time: ~18 seconds**

## 🔍 Why Scheduled Commands Don't Reach ESP32 Directly

### Key Points:

1. **Two Separate Tables:**
   - `scheduledCommands` - Future commands (not sent to ESP32)
   - `commands` - Active commands (sent to ESP32)

2. **Server Scheduler is the Bridge:**
   - Converts scheduled → regular commands at the right time
   - ESP32 never sees `scheduledFor` field
   - ESP32 only sees regular pending commands

3. **ESP32 Has No Scheduling Logic:**
   ```cpp
   // Current code (line 476-520)
   bool processPendingCommands(JsonArray commands, ...) {
     // No check for scheduledFor
     // Executes all commands immediately
   }
   ```

## 🚨 Why Your Pump Didn't Turn On

Based on this flow, the failure point is:

### Most Likely: Server Scheduler Not Running

**Check 1: Is scheduler running?**
```bash
# Look for these logs in your server:
[Scheduler] Starting scheduled command processor
[Scheduler] Processed 1 commands: succeeded=1, failed=0
```

**Problem:** Vercel (your hosting platform) is **serverless** - it doesn't support long-running background processes!

**Evidence:**
```typescript
// src/lib/scheduler.ts (line 88-90)
if (process.env.NODE_ENV === "production") {
  startScheduler();  // ← This won't work on Vercel!
}
```

### Why Vercel Can't Run Schedulers:

1. **Serverless Functions:** Only run when triggered by HTTP requests
2. **No Background Processes:** Can't run `setInterval()` continuously
3. **Cold Starts:** Functions shut down after requests complete

### The Fix: Use Vercel Cron Jobs

Vercel supports cron jobs that trigger HTTP endpoints:

```json
// vercel.json
{
  "crons": [{
    "path": "/api/cron/process-scheduled-commands",
    "schedule": "* * * * *"  // Every minute
  }]
}
```

## 💡 Your Idea: ESP32-Side Scheduling with RTC

You suggested:
> "Send the date and time to the ESP as it has an RTC already, so when the time corresponds it activates"

**This is actually a BETTER approach for your use case!** Here's why:

### Advantages:

1. ✅ **No server scheduler needed** - Works on Vercel!
2. ✅ **More reliable** - ESP32 controls timing locally
3. ✅ **Works offline** - Scheduled commands execute even if WiFi drops
4. ✅ **Accurate timing** - DS3231 RTC is very precise
5. ✅ **Simpler architecture** - No background processes needed

### How It Would Work:

```
1. User schedules: "Turn pump on at 3:00 PM"
2. Server stores in scheduledCommands table
3. ESP32 syncs, receives:
   {
     "scheduledCommands": [
       {
         "commandId": "schcmd_abc123",
         "channelKey": "pump_main",
         "desiredBooleanState": true,
         "scheduledFor": "2024-05-04T15:00:00Z",  ← ESP32 gets this!
         "note": "Afternoon watering"
       }
     ]
   }
4. ESP32 stores in local array
5. ESP32 checks RTC every second
6. At 3:00 PM: ESP32 executes command locally
7. ESP32 sends acknowledgement on next sync
```

### Implementation Changes Needed:

#### 1. Server: Send Scheduled Commands to ESP32

```typescript
// src/lib/services/device-sync.service.ts
// Add after line 65:

const scheduledCommandsRows = await db
  .select()
  .from(scheduledCommands)
  .where(
    and(
      eq(scheduledCommands.controllerId, controller.id),
      eq(scheduledCommands.status, "pending")
    )
  )
  .orderBy(asc(scheduledCommands.scheduledFor));

// Add to return object (line 97):
return {
  // ... existing fields ...
  scheduledCommands: scheduledCommandsRows.map((cmd) => ({
    commandId: cmd.id,
    channelKey: channelKeyById.get(cmd.channelId) ?? null,
    commandType: cmd.commandType,
    desiredBooleanState: cmd.desiredBooleanState,
    desiredNumericValue: cmd.desiredNumericValue,
    scheduledFor: cmd.scheduledFor.toISOString(),  ← Send to ESP32!
    note: cmd.note,
  })),
};
```

#### 2. ESP32: Store and Execute Scheduled Commands

```cpp
// Add to water_tank.ino:

struct ScheduledCommand {
  bool active;
  char commandId[48];
  char channelKey[32];
  bool desiredBooleanState;
  uint32_t scheduledEpoch;
  char note[96];
};

#define MAX_SCHEDULED_COMMANDS 10
ScheduledCommand scheduledCommands[MAX_SCHEDULED_COMMANDS];

void clearScheduledCommands() {
  for (int i = 0; i < MAX_SCHEDULED_COMMANDS; i++) {
    scheduledCommands[i].active = false;
  }
}

void storeScheduledCommand(JsonObject cmd) {
  const char* commandId = cmd["commandId"];
  const char* channelKey = cmd["channelKey"];
  const char* scheduledFor = cmd["scheduledFor"];
  
  // Parse ISO time to epoch
  uint32_t scheduledEpoch = parseIsoToEpoch(scheduledFor);
  
  // Find empty slot
  for (int i = 0; i < MAX_SCHEDULED_COMMANDS; i++) {
    if (!scheduledCommands[i].active) {
      scheduledCommands[i].active = true;
      copyText(scheduledCommands[i].commandId, 48, commandId);
      copyText(scheduledCommands[i].channelKey, 32, channelKey);
      scheduledCommands[i].desiredBooleanState = cmd["desiredBooleanState"];
      scheduledCommands[i].scheduledEpoch = scheduledEpoch;
      copyText(scheduledCommands[i].note, 96, cmd["note"] | "");
      
      Serial.printf("[SCHED] Stored: %s at epoch %lu\n", 
                    commandId, scheduledEpoch);
      break;
    }
  }
}

void checkScheduledCommands(uint32_t nowEpoch) {
  for (int i = 0; i < MAX_SCHEDULED_COMMANDS; i++) {
    if (!scheduledCommands[i].active) continue;
    
    // Check if time has arrived
    if (nowEpoch >= scheduledCommands[i].scheduledEpoch) {
      Serial.printf("[SCHED] Executing: %s\n", 
                    scheduledCommands[i].commandId);
      
      // Execute command
      if (strcmp(scheduledCommands[i].channelKey, PUMP_CHANNEL_KEY) == 0) {
        manualOverrideActive = true;
        manualOverrideDesiredState = scheduledCommands[i].desiredBooleanState;
        manualOverrideExpiresAtEpoch = nowEpoch + 120;  // 2 minutes
        
        // Queue acknowledgement
        queueAck(scheduledCommands[i].commandId, 
                 "executed", 
                 "Scheduled command executed");
      }
      
      // Remove from array
      scheduledCommands[i].active = false;
    }
  }
}

// In loop():
void loop() {
  // ... existing code ...
  
  // Check scheduled commands every second
  static uint32_t lastScheduleCheck = 0;
  if (millis() - lastScheduleCheck >= 1000) {
    lastScheduleCheck = millis();
    checkScheduledCommands(currentEpoch());
  }
}
```

## 🎯 Recommendation

**Keep your current server-side implementation** because:

1. It already works (just needs Vercel cron fix)
2. Centralized scheduling is easier to manage
3. No ESP32 code changes needed
4. Dashboard shows accurate status

**OR implement ESP32-side scheduling** if you want:

1. Offline scheduling capability
2. No server background processes
3. More reliable timing
4. Simpler server architecture

Both approaches are valid! The server-side approach is more common, but ESP32-side is perfectly fine for your use case with RTC.

## 📝 Summary

**Current Flow:**
```
Dashboard → scheduledCommands table → Server Scheduler → 
commands table → ESP32 sync → ESP32 executes
```

**Your Proposed Flow:**
```
Dashboard → scheduledCommands table → ESP32 sync → 
ESP32 stores locally → RTC triggers → ESP32 executes
```

**Why pump didn't turn on:**
- Server scheduler not running on Vercel (serverless platform)
- Scheduled command never converted to regular command
- ESP32 never received the command

**Fix options:**
1. Add Vercel cron job (keep current architecture)
2. Implement ESP32-side scheduling (your idea - also good!)
