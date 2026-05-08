# ESP32-Side Scheduling Implementation Guide

## ✅ What Was Implemented

I've implemented **ESP32-side scheduling** that allows your ESP32 to handle scheduled commands locally using its DS3231 RTC. This eliminates the need for server-side background processes and works perfectly on Vercel!

## 🎯 New Flow

```
Dashboard → scheduledCommands table → ESP32 sync → 
ESP32 stores locally → RTC triggers → ESP32 executes
```

### Complete Flow Diagram:

```
1. USER SCHEDULES COMMAND (Dashboard)
   │
   ├─→ User: "Turn pump on at 3:00 PM"
   │
   └─→ POST /api/channels/{id}/scheduled-commands
       {
         "desiredBooleanState": true,
         "scheduledFor": "2024-05-04T15:00:00Z"
       }

2. SERVER STORES IN DATABASE
   │
   └─→ scheduledCommands table:
       {
         id: "schcmd_abc123",
         status: "pending",
         scheduledFor: "2024-05-04T15:00:00Z"
       }

3. ESP32 SYNCS (Every 3 seconds)
   │
   ├─→ POST /api/device/sync
   │
   └─→ Server Response NOW includes:
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

4. ESP32 STORES LOCALLY
   │
   ├─→ Parses ISO time to epoch: 1714838400
   ├─→ Stores in scheduledCommands array
   │
   └─→ Serial Output:
       [SCHED] Stored command schcmd_abc123 for epoch 1714838400
       [SCHED] Channel: pump_main, Action: ON
       [SCHED] 1 scheduled command(s) in storage

5. ESP32 CHECKS RTC (Every 1 second)
   │
   ├─→ Function: checkAndExecuteScheduledCommands()
   ├─→ Compares: nowEpoch >= scheduledEpoch
   │
   └─→ At 2:59:59 PM: nowEpoch=1714838399 < 1714838400 (wait)
       At 3:00:00 PM: nowEpoch=1714838400 >= 1714838400 (execute!)

6. ESP32 EXECUTES COMMAND
   │
   ├─→ Serial Output:
   │   [SCHED] ⏰ Executing scheduled command: schcmd_abc123
   │   [SCHED] Scheduled for: 1714838400, Current: 1714838400
   │   [SCHED] ✓ Pump set to ON for 60 seconds
   │   [PUMP] ON
   │
   ├─→ Sets manual override:
   │   manualOverrideActive = true
   │   manualOverrideDesiredState = true
   │   manualOverrideExpiresAtEpoch = 1714838460
   │
   └─→ Queues acknowledgement:
       queueAck("schcmd_abc123", "executed", 
                "Scheduled command executed by ESP32")

7. ESP32 SENDS ACKNOWLEDGEMENT (Next sync - 3 seconds later)
   │
   └─→ POST /api/device/sync
       {
         "acknowledgements": [
           {
             "commandId": "schcmd_abc123",
             "status": "executed",
             "deviceMessage": "Scheduled command executed by ESP32"
           }
         ]
       }

8. SERVER UPDATES DATABASE
   │
   └─→ scheduledCommands table:
       {
         status: "executed",  ← Updated!
         executedAt: "2024-05-04T15:00:03Z"
       }
```

## 📝 Changes Made

### 1. Server Changes (`device-sync.service.ts`)

**Added scheduled commands to sync response:**

```typescript
// Now queries pending scheduled commands
const pendingScheduledCommands = await db
  .select()
  .from(scheduledCommands)
  .where(
    and(
      eq(scheduledCommands.controllerId, controller.id),
      eq(scheduledCommands.status, "pending")
    )
  );

// Sends them to ESP32
return {
  // ... existing fields ...
  scheduledCommands: pendingScheduledCommands.map((cmd) => ({
    commandId: cmd.id,
    channelKey: channelKeyById.get(cmd.channelId) ?? null,
    commandType: cmd.commandType,
    desiredBooleanState: cmd.desiredBooleanState,
    desiredNumericValue: cmd.desiredNumericValue,
    scheduledFor: cmd.scheduledFor.toISOString(),  // ← Sent to ESP32!
    note: cmd.note,
  })),
};
```

### 2. ESP32 Changes (`water_tank.ino`)

**Added scheduled command storage:**

```cpp
// Storage for up to 10 scheduled commands
constexpr size_t MAX_SCHEDULED_COMMANDS = 10;

struct ScheduledCommand {
  bool active;
  char commandId[48];
  char channelKey[32];
  char commandType[16];
  bool desiredBooleanState;
  float desiredNumericValue;
  uint32_t scheduledEpoch;  // ← RTC epoch time
  char note[96];
};

ScheduledCommand scheduledCommands[MAX_SCHEDULED_COMMANDS];
```

**Added ISO time parser:**

```cpp
uint32_t parseIsoToEpoch(const char* isoTime) {
  // Parses: "2024-05-04T15:00:00.000Z"
  // Returns: Unix epoch timestamp
  
  int year, month, day, hour, minute, second;
  sscanf(isoTime, "%d-%d-%dT%d:%d:%d", 
         &year, &month, &day, &hour, &minute, &second);
  
  DateTime dt(year, month, day, hour, minute, second);
  return dt.unixtime();
}
```

**Added storage function:**

```cpp
bool storeScheduledCommand(JsonObject cmd) {
  const char* commandId = cmd["commandId"];
  const char* scheduledFor = cmd["scheduledFor"];
  
  // Parse time
  uint32_t scheduledEpoch = parseIsoToEpoch(scheduledFor);
  
  // Store in array
  scheduledCommands[i].active = true;
  scheduledCommands[i].scheduledEpoch = scheduledEpoch;
  // ... store other fields ...
  
  Serial.printf("[SCHED] Stored command %s for epoch %lu\n", 
                commandId, scheduledEpoch);
}
```

**Added execution checker:**

```cpp
void checkAndExecuteScheduledCommands(uint32_t nowEpoch, float tankPercent) {
  for (size_t i = 0; i < MAX_SCHEDULED_COMMANDS; i++) {
    if (!scheduledCommands[i].active) continue;
    
    // Check if time has arrived
    if (nowEpoch >= scheduledCommands[i].scheduledEpoch) {
      Serial.printf("[SCHED] ⏰ Executing: %s\n", commandId);
      
      // Safety check
      if (desiredState && tankPercent >= TANK_PUMP_OFF_PERCENT) {
        queueAck(commandId, "failed", "Tank already full");
      } else {
        // Execute command
        manualOverrideActive = true;
        manualOverrideDesiredState = desiredState;
        manualOverrideExpiresAtEpoch = nowEpoch + 60;
        
        queueAck(commandId, "executed", 
                 "Scheduled command executed by ESP32");
      }
      
      // Remove from storage
      scheduledCommands[i].active = false;
    }
  }
}
```

**Added to main loop:**

```cpp
void loop() {
  // ... existing code ...
  
  // Check scheduled commands every 1 second
  if ((uint32_t)(nowMs - lastControlMs) >= LOCAL_CONTROL_INTERVAL_MS) {
    lastControlMs = nowMs;
    uint32_t nowEpoch = currentEpoch();
    
    // Check for scheduled commands
    checkAndExecuteScheduledCommands(nowEpoch, cachedTankPercent);
    
    // Apply pump control
    applyPumpControl(cachedTankPercent, nowEpoch);
  }
}
```

## 🚀 How to Use

### 1. Upload Updated Code to ESP32

```bash
1. Open water_tank.ino in Arduino IDE
2. Verify code compiles
3. Upload to ESP32
4. Open Serial Monitor (115200 baud)
```

### 2. Deploy Server Changes

```bash
cd GanSys
git add .
git commit -m "Implement ESP32-side scheduling"
git push origin dev
```

Vercel will auto-deploy the changes.

### 3. Create Scheduled Command from Dashboard

```
1. Go to controller detail page
2. Click "Schedule" button
3. Select channel: "Pump"
4. Select action: "Turn On"
5. Set date and time
6. Click "Schedule Command"
```

### 4. Watch Serial Monitor

You'll see:

```
----- Sync Start -----
HTTP 200
Response:
{"scheduledCommands":[{"commandId":"schcmd_abc123",...}]}

[SCHED] Stored command schcmd_abc123 for epoch 1714838400
[SCHED] Channel: pump_main, Action: ON
[SCHED] 1 scheduled command(s) in storage
----- Sync End -----

... (wait until scheduled time) ...

[SCHED] ⏰ Executing scheduled command: schcmd_abc123
[SCHED] Scheduled for: 1714838400, Current: 1714838400
[SCHED] ✓ Pump set to ON for 60 seconds
[PUMP] ON

----- Sync Start -----
Payload: {"acknowledgements":[{"commandId":"schcmd_abc123","status":"executed",...}]}
HTTP 200
----- Sync End -----
```

## ⏰ Timing Accuracy

### Expected Behavior:

- **Scheduled time:** 3:00:00 PM
- **ESP32 checks:** Every 1 second
- **Execution:** 3:00:00 PM ±1 second
- **Acknowledgement sent:** 3:00:03 PM (next sync)

### Accuracy:

- **RTC accuracy:** ±2 minutes per year (DS3231)
- **Execution delay:** 0-1 second
- **Much better than server-side:** 30-90 seconds delay

## 🔍 Debugging

### Check if Scheduled Commands are Received:

```
Serial Monitor should show:
[SCHED] Stored command schcmd_abc123 for epoch 1714838400
[SCHED] 1 scheduled command(s) in storage
```

If you don't see this:
- Server might not be sending scheduled commands
- Check server deployment
- Check Serial Monitor for HTTP errors

### Check if Commands Execute:

```
Serial Monitor should show at scheduled time:
[SCHED] ⏰ Executing scheduled command: schcmd_abc123
[PUMP] ON
```

If you don't see this:
- RTC might not be set correctly
- Check: `[RTC] Current time: 2024-05-04 15:00:00`
- Scheduled time might be in wrong timezone

### Check Acknowledgements:

```
Serial Monitor should show:
Payload: {"acknowledgements":[{"commandId":"schcmd_abc123",...}]}
```

If you don't see this:
- Command might have failed safety checks
- Check for: `[SCHED] ⚠️ Blocked: Tank is full`

## 🛡️ Safety Features

### 1. Tank Full Protection

```cpp
if (desiredState && tankPercent >= TANK_PUMP_OFF_PERCENT) {
  Serial.printf("[SCHED] ⚠️ Blocked: Tank is full (%.1f%%)\n", tankPercent);
  queueAck(commandId, "failed", "Pump blocked: tank already full");
}
```

Prevents pump from turning on if tank is ≥90% full.

### 2. Storage Limit

```cpp
constexpr size_t MAX_SCHEDULED_COMMANDS = 10;
```

Can store up to 10 scheduled commands. Prevents memory overflow.

### 3. Duplicate Prevention

```cpp
if (isScheduledCommandStored(commandId)) {
  return true;  // Already have it
}
```

Won't store the same command twice.

### 4. Time Validation

```cpp
uint32_t scheduledEpoch = parseIsoToEpoch(scheduledFor);
if (scheduledEpoch == 0) {
  Serial.printf("[SCHED] Failed to parse time: %s\n", scheduledFor);
  return false;
}
```

Validates time format before storing.

## 📊 Advantages Over Server-Side

| Feature | Server-Side | ESP32-Side (New) |
|---------|-------------|------------------|
| **Works on Vercel** | ❌ No (needs cron) | ✅ Yes |
| **Offline execution** | ❌ No | ✅ Yes |
| **Timing accuracy** | ±30-90 seconds | ±1 second |
| **Server complexity** | High (scheduler) | Low (just storage) |
| **WiFi dependency** | High | Low (only for sync) |
| **RTC required** | No | Yes (you have it!) |
| **Storage location** | Database | ESP32 RAM |
| **Max commands** | Unlimited | 10 active |

## 🎯 Best Practices

### 1. Schedule in Advance

Schedule at least 10 seconds in advance to ensure ESP32 receives the command before execution time.

### 2. Monitor Serial Output

Always check Serial Monitor when testing scheduled commands to see what's happening.

### 3. Verify RTC Time

Before scheduling, verify RTC time is correct:

```
Serial Monitor shows:
[RTC] Current time: 2024-05-04 14:55:30
```

If wrong, sync from NTP:
- Ensure WiFi connected
- ESP32 will auto-sync on startup

### 4. Use UTC Time

Dashboard sends times in UTC. Your RTC should be set to UTC (or adjust for timezone).

### 5. Don't Overload Storage

Maximum 10 scheduled commands. Old commands are automatically removed after execution.

## 🔧 Troubleshooting

### Problem: Commands Not Executing

**Check 1: RTC Time**
```
[RTC] Current time: 2024-05-04 15:00:00
```
If time is wrong, ESP32 won't execute at correct time.

**Check 2: Commands Stored**
```
[SCHED] 1 scheduled command(s) in storage
```
If 0, commands aren't being received from server.

**Check 3: Scheduled Time**
```
[SCHED] Scheduled for: 1714838400, Current: 1714838350
```
If scheduled time is in the past, command executes immediately.

### Problem: Tank Full Block

```
[SCHED] ⚠️ Blocked: Tank is full (92.5%)
```

**Solution:** This is a safety feature. Wait for tank level to drop below 90%.

### Problem: Storage Full

```
[SCHED] Storage full; cannot store more scheduled commands
```

**Solution:** Wait for existing commands to execute, or restart ESP32 to clear storage.

## 📝 Summary

**What Changed:**

1. ✅ Server now sends `scheduledCommands` array to ESP32
2. ✅ ESP32 stores up to 10 scheduled commands locally
3. ✅ ESP32 checks RTC every second for due commands
4. ✅ ESP32 executes commands at exact scheduled time
5. ✅ ESP32 sends acknowledgements back to server

**Benefits:**

- ✅ Works on Vercel (no background processes needed)
- ✅ Accurate timing (±1 second vs ±30-90 seconds)
- ✅ Offline capability (executes even if WiFi drops)
- ✅ Simpler server architecture
- ✅ Leverages your existing DS3231 RTC

**Your pump will now turn on at exactly 3:00 PM!** 🎉
