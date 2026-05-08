# Complete Scheduled Command Flow - "Turn Pump On at 3:00 PM"

## 📋 Full Journey from Dashboard Click to ESP32 Execution

I've traced through the entire codebase. Here's **exactly** how a scheduled command flows:

---

## 🎯 Step-by-Step Flow

### **STEP 1: User Creates Scheduled Command (Dashboard UI)**

**File:** `src/components/dashboard/controller-detail.tsx` (Line 703-730)

```typescript
async function scheduleCommand() {
  // User fills form:
  // - Channel: "Pump"
  // - Action: "Turn On"
  // - Date: "2024-05-04"
  // - Time: "15:00" (3:00 PM)
  
  const scheduledFor = new Date(`${scheduledDate}T${scheduledTime}`);
  // Result: "2024-05-04T15:00:00.000Z"
  
  const r = await fetch(`/api/channels/${selectedChannelId}/scheduled-commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      desiredBooleanState: true,  // Turn ON
      note: "Afternoon watering",
      scheduledFor: scheduledFor.toISOString()
    })
  });
}
```

**HTTP Request:**
```http
POST /api/channels/ch_pump123/scheduled-commands
Content-Type: application/json

{
  "desiredBooleanState": true,
  "scheduledFor": "2024-05-04T15:00:00.000Z",
  "note": "Afternoon watering"
}
```

---

### **STEP 2: API Endpoint Receives Request**

**File:** `app/api/channels/[id]/scheduled-commands/route.ts` (Line 10-23)

```typescript
export const POST = handleRoute(async (request: Request, context: Context) => {
  const user = await requireApiUser();  // Verify user is logged in
  const { id } = await getRouteParams(context);  // Get channel ID
  const body = await parseJson(request, scheduledCommandSchema);  // Validate
  
  // Call service to create scheduled command
  const scheduledCommand = await createScheduledCommand(user.id, id, {
    desiredBooleanState: body.desiredBooleanState,  // true
    desiredNumericValue: body.desiredNumericValue,  // undefined
    note: body.note,  // "Afternoon watering"
    scheduledFor: new Date(body.scheduledFor),  // Date object
  });
  
  return jsonOk({ scheduledCommand }, { status: 201 });
});
```

---

### **STEP 3: Service Creates Database Record**

**File:** `src/lib/services/scheduled-command.service.ts` (Line 48-87)

```typescript
export async function createScheduledCommand(
  userId: string,
  channelId: string,
  input: {
    desiredBooleanState?: boolean;
    desiredNumericValue?: number;
    note?: string;
    scheduledFor: Date;
  }
) {
  const channel = await getChannelOwnedByUser(userId, channelId);
  const controller = await getControllerOwnedByUser(userId, channel.controllerId);

  // Validate scheduled time is in the future
  if (input.scheduledFor <= now()) {
    throw new Error("Scheduled time must be in the future.");
  }

  const scheduledCommandId = createId("schcmd");
  
  // INSERT INTO scheduledCommands table
  await db.insert(scheduledCommands).values({
    id: scheduledCommandId,  // "schcmd_abc123"
    controllerId: controller.id,  // "esp32_ctrl_001"
    channelId: channel.id,  // "ch_pump123"
    requestedByUserId: userId,
    commandType: "set_state",  // Because desiredBooleanState is set
    desiredBooleanState: true,  // Turn ON
    desiredNumericValue: null,
    note: "Afternoon watering",
    scheduledFor: new Date("2024-05-04T15:00:00.000Z"),
    status: "pending",  // ⚠️ IMPORTANT: Status is "pending"
    createdAt: now(),
    executedAt: null,
    cancelledAt: null,
    executedCommandId: null,
    failureReason: null,
  });

  return hydrateScheduledCommand(rows[0]!, channel.name);
}
```

**Database State After Step 3:**
```sql
-- scheduledCommands table
id: "schcmd_abc123"
controllerId: "esp32_ctrl_001"
channelId: "ch_pump123"
commandType: "set_state"
desiredBooleanState: true
scheduledFor: "2024-05-04 15:00:00"
status: "pending"  ← Command is waiting
executedCommandId: null
```

**⚠️ CRITICAL:** At this point, the command is **ONLY** in the `scheduledCommands` table, **NOT** in the `commands` table!

---

### **STEP 4: Server Scheduler Runs (Every 30 Seconds)**

**File:** `server.ts` (Line 32-35)

```typescript
// Server startup
import("@/lib/scheduler").then(({ startScheduler }) => {
  startScheduler();  // ← Starts background scheduler
  console.log("[Server] Scheduled command processor initialised.");
});
```

**File:** `src/lib/scheduler.ts` (Line 12-42)

```typescript
export function startScheduler() {
  console.log("[Scheduler] Starting scheduled command processor");

  // Process immediately on startup
  void processDueScheduledCommands().then((results) => {
    console.log(`[Scheduler] Initial run: processed=${results.processed}`);
  });

  // Then run every 30 seconds
  schedulerInterval = setInterval(() => {
    void processDueScheduledCommands().then((results) => {
      if (results.processed > 0) {
        console.log(`[Scheduler] Processed ${results.processed} commands`);
      }
    });
  }, 30_000);  // ← Every 30 seconds
}
```

**Timeline:**
```
2:59:30 PM - Scheduler checks: scheduledFor > NOW → Skip
2:59:60 PM - Scheduler checks: scheduledFor > NOW → Skip
3:00:30 PM - Scheduler checks: scheduledFor <= NOW → PROCESS! ✓
```

---

### **STEP 5: Scheduler Converts Scheduled Command to Regular Command**

**File:** `src/lib/services/scheduled-command.service.ts` (Line 145-220)

```typescript
export async function processDueScheduledCommands() {
  const currentTime = now();  // 2024-05-04 15:00:30

  // Find all pending scheduled commands that are due
  const dueCommands = await db
    .select({
      scheduledCommand: scheduledCommands,
      channel: channels,
    })
    .from(scheduledCommands)
    .innerJoin(channels, eq(scheduledCommands.channelId, channels.id))
    .where(
      and(
        eq(scheduledCommands.status, "pending"),  // ← Only pending
        lte(scheduledCommands.scheduledFor, currentTime)  // ← Time has passed
      )
    );
  // Result: Finds "schcmd_abc123"

  for (const { scheduledCommand, channel } of dueCommands) {
    try {
      // ⚠️ CREATE THE ACTUAL COMMAND
      const command = await createManualCommand(
        scheduledCommand.requestedByUserId,
        scheduledCommand.channelId,
        {
          desiredBooleanState: scheduledCommand.desiredBooleanState,  // true
          desiredNumericValue: scheduledCommand.desiredNumericValue,  // null
          note: scheduledCommand.note || `Scheduled command executed`,
          overrideMinutes: 2,  // Manual override for 2 minutes
        }
      );
      // This creates a NEW record in the "commands" table!

      // Mark scheduled command as executed
      await db
        .update(scheduledCommands)
        .set({
          status: "executed",  // ← Changed from "pending"
          executedAt: currentTime,
          executedCommandId: command.id,  // Link to actual command
        })
        .where(eq(scheduledCommands.id, scheduledCommand.id));

      console.log(`[ScheduledCommand] Executed ${scheduledCommand.id}`);
    } catch (error) {
      // Mark as failed if error occurs
      await db.update(scheduledCommands).set({
        status: "failed",
        failureReason: error.message,
      });
    }
  }
}
```

**Database State After Step 5:**
```sql
-- scheduledCommands table (UPDATED)
id: "schcmd_abc123"
status: "executed"  ← Changed from "pending"
executedAt: "2024-05-04 15:00:30"
executedCommandId: "cmd_xyz789"  ← Links to actual command

-- commands table (NEW RECORD CREATED)
id: "cmd_xyz789"  ← NEW!
controllerId: "esp32_ctrl_001"
channelId: "ch_pump123"
commandType: "set_state"
desiredBooleanState: true
status: "pending"  ← ESP32 needs to execute this
overrideUntil: "2024-05-04 15:02:30"  (2 minutes from now)
createdAt: "2024-05-04 15:00:30"
```

**⚠️ KEY POINT:** The scheduler creates a **NEW** command in the `commands` table with `status: "pending"`. This is what the ESP32 will receive!

---

### **STEP 6: ESP32 Syncs with Server (Every 3 Seconds)**

**File:** `c++/water_tank/water_tank.ino` (Line 545-650)

```cpp
void syncDevice() {
  // ESP32 sends current readings
  DynamicJsonDocument requestDoc(3072);
  requestDoc["firmwareVersion"] = "1.0.0";
  
  JsonArray readings = requestDoc.createNestedArray("readings");
  // ... add tank level, pump state, etc.
  
  // Send acknowledgements for previously executed commands
  JsonArray acknowledgements = requestDoc.createNestedArray("acknowledgements");
  // ... add any acks from queue
  
  String body;
  serializeJson(requestDoc, body);
  
  // POST to server
  HTTPClient http;
  http.begin(secureClient, SERVER_URL);  // https://gansystems.vercel.app/api/device/sync
  http.addHeader("x-device-id", DEVICE_ID);
  http.addHeader("x-device-key", DEVICE_KEY);
  
  int statusCode = http.POST(body);
  String response = http.getString();
  
  // Parse response
  DynamicJsonDocument responseDoc(8192);
  deserializeJson(responseDoc, response);
  
  // ⚠️ GET PENDING COMMANDS
  JsonArray pendingCommands = responseDoc["pendingCommands"].as<JsonArray>();
  processPendingCommands(pendingCommands, cachedTankPercent, nowEpoch);
}
```

**HTTP Request from ESP32:**
```http
POST /api/device/sync
x-device-id: ESP32-CONTROLLER
x-device-key: rX0Wb8B8MyynWss9-gjLSSyiktDcc8gO

{
  "firmwareVersion": "1.0.0",
  "readings": [
    {"channelKey": "tank_main", "numericValue": 45.2},
    {"channelKey": "pump_main", "booleanState": false}
  ],
  "acknowledgements": []
}
```

---

### **STEP 7: Server Responds with Pending Commands**

**File:** `src/lib/services/device-sync.service.ts` (Line 56-61)

```typescript
// Query for pending commands
const pendingCommands = await db.select().from(commands)
  .where(and(
    eq(commands.controllerId, controller.id),
    eq(commands.status, "pending")  // ← Only pending commands
  ))
  .orderBy(asc(commands.createdAt));
// Result: Finds "cmd_xyz789" created by scheduler!
```

**File:** `src/lib/services/device-sync.service.ts` (Line 82-92)

```typescript
return {
  serverTime: now().toISOString(),
  controller: { ... },
  channelConfig: [ ... ],
  pendingCommands: pendingCommands.map((cmd) => ({
    commandId: cmd.id,  // "cmd_xyz789"
    channelId: cmd.channelId,
    channelKey: channelKeyById.get(cmd.channelId),  // "pump_main"
    commandType: cmd.commandType,  // "set_state"
    desiredBooleanState: cmd.desiredBooleanState,  // true
    desiredNumericValue: cmd.desiredNumericValue,  // null
    overrideUntil: cmd.overrideUntil,  // "2024-05-04T15:02:30Z"
    note: cmd.note,
  })),
  pestControlSchedule: null,
};
```

**HTTP Response to ESP32:**
```json
{
  "serverTime": "2024-05-04T15:00:33.000Z",
  "controller": {
    "hardwareId": "ESP32-CONTROLLER",
    "heartbeatIntervalSec": 60
  },
  "pendingCommands": [
    {
      "commandId": "cmd_xyz789",
      "channelKey": "pump_main",
      "commandType": "set_state",
      "desiredBooleanState": true,
      "overrideMinutes": 2,
      "note": "Scheduled command executed at 2024-05-04T15:00:30.000Z"
    }
  ]
}
```

---

### **STEP 8: ESP32 Processes Command**

**File:** `c++/water_tank/water_tank.ino` (Line 476-520)

```cpp
bool processPendingCommands(JsonArray commands, float tankPercent, uint32_t nowEpoch) {
  for (JsonObject cmd : commands) {
    const char* commandId = cmd["commandId"];  // "cmd_xyz789"
    const char* channelKey = cmd["channelKey"];  // "pump_main"
    const char* commandType = cmd["commandType"];  // "set_state"
    
    // Check if already processed
    if (ackQueuedFor(commandId)) continue;
    
    // Verify channel
    if (strcmp(channelKey, PUMP_CHANNEL_KEY) != 0) {
      queueAck(commandId, "failed", "Unsupported channel");
      continue;
    }
    
    // Verify command type
    if (strcmp(commandType, "set_state") != 0) {
      queueAck(commandId, "failed", "Unsupported command type");
      continue;
    }
    
    // Get desired state
    bool desiredState = cmd["desiredBooleanState"].as<bool>();  // true
    
    // Safety check: Don't turn on pump if tank is full
    if (desiredState && tankPercent >= TANK_PUMP_OFF_PERCENT) {
      queueAck(commandId, "failed", "Pump blocked: tank already full");
      continue;
    }
    
    // Get override duration
    uint32_t overrideMs = MANUAL_OVERRIDE_MS;  // Default 60 seconds
    if (!cmd["overrideMinutes"].isNull()) {
      int m = cmd["overrideMinutes"].as<int>();  // 2
      if (m > 0) overrideMs = (uint32_t)m * 60000UL;  // 120000 ms
    }
    
    // ⚠️ EXECUTE COMMAND
    manualOverrideActive = true;
    manualOverrideDesiredState = desiredState;  // true (ON)
    manualOverrideExpiresAtEpoch = nowEpoch + (overrideMs / 1000UL);
    
    // Queue acknowledgement
    queueAck(commandId, "acknowledged", "Manual override active");
    
    Serial.printf("[CMD] %s → manual override %s for %lu s\n",
                  commandId, desiredState ? "ON" : "OFF",
                  (unsigned long)(overrideMs / 1000UL));
  }
  
  return true;
}
```

**Serial Monitor Output:**
```
----- Sync Start -----
Payload: {...}
HTTP 200
Response:
{"pendingCommands":[{"commandId":"cmd_xyz789","channelKey":"pump_main",...}]}
[CMD] cmd_xyz789 → manual override ON for 120 s
[PUMP] ON
Next sync in 1000 ms
----- Sync End -----
```

---

### **STEP 9: ESP32 Applies Pump Control**

**File:** `c++/water_tank/water_tank.ino` (Line 456-474)

```cpp
void applyPumpControl(float tankPercent, uint32_t nowEpoch) {
  // ... safety checks ...
  
  // Check if manual override is active and valid
  if (manualOverrideValid(nowEpoch)) {
    setPump(manualOverrideDesiredState);  // ← Turn pump ON
    return;
  }
  
  // ... automatic control logic ...
}

void setPump(bool on) {
  digitalWrite(PUMP_RELAY_PIN, RELAY_ACTIVE_LOW ? !on : on);
  pumpState = on;
  Serial.printf("[PUMP] %s\n", on ? "ON" : "OFF");
}
```

**Physical Action:** Pump relay activates, pump turns ON! 💧

---

### **STEP 10: ESP32 Sends Acknowledgement**

**File:** `c++/water_tank/water_tank.ino` (Next sync, ~3 seconds later)

```cpp
void syncDevice() {
  // ... build request ...
  
  JsonArray acknowledgements = requestDoc.createNestedArray("acknowledgements");
  for (size_t i = 0; i < ACK_QUEUE_SIZE; i++) {
    if (!ackQueue[i].used) continue;
    
    JsonObject ack = acknowledgements.createNestedObject();
    ack["commandId"] = ackQueue[i].commandId;  // "cmd_xyz789"
    ack["status"] = ackQueue[i].status;  // "acknowledged"
    ack["deviceMessage"] = ackQueue[i].message;  // "Manual override active"
  }
  
  // Send to server
  http.POST(body);
  
  // Clear ack queue after successful sync
  clearAckQueue();
}
```

**HTTP Request:**
```json
{
  "firmwareVersion": "1.0.0",
  "readings": [...],
  "acknowledgements": [
    {
      "commandId": "cmd_xyz789",
      "status": "acknowledged",
      "deviceMessage": "Manual override active"
    }
  ]
}
```

---

### **STEP 11: Server Marks Command as Executed**

**File:** `src/lib/services/command.service.ts`

```typescript
export async function applyAcknowledgements(
  userId: string,
  controllerId: string,
  acks: DeviceAckInput[]
) {
  for (const ack of acks) {
    await db.update(commands)
      .set({
        status: "executed",  // ← Changed from "pending"
        executedAt: now(),
        deviceMessage: ack.deviceMessage,
      })
      .where(eq(commands.id, ack.commandId));
  }
}
```

**Final Database State:**
```sql
-- commands table (UPDATED)
id: "cmd_xyz789"
status: "executed"  ← Changed from "pending"
executedAt: "2024-05-04 15:00:36"
deviceMessage: "Manual override active"

-- scheduledCommands table (Already updated in Step 5)
id: "schcmd_abc123"
status: "executed"
executedCommandId: "cmd_xyz789"
```

---

## 📊 Complete Timeline

```
Time          | Action                                    | Component
--------------|-------------------------------------------|------------------
2:58:00 PM    | User clicks "Schedule" button             | Dashboard UI
2:58:01 PM    | POST /api/channels/.../scheduled-commands | API Route
2:58:01 PM    | INSERT INTO scheduledCommands             | Database
              | status: "pending"                         |
              |                                           |
2:59:30 PM    | Scheduler checks: scheduledFor > NOW      | Server Scheduler
              | → Skip (not time yet)                     |
              |                                           |
3:00:00 PM    | Scheduler checks: scheduledFor > NOW      | Server Scheduler
              | → Skip (not time yet)                     |
              |                                           |
3:00:30 PM    | Scheduler checks: scheduledFor <= NOW     | Server Scheduler
              | → PROCESS! ✓                              |
3:00:30 PM    | INSERT INTO commands (status: "pending")  | Database
3:00:30 PM    | UPDATE scheduledCommands                  | Database
              | (status: "executed")                      |
              |                                           |
3:00:33 PM    | ESP32 syncs with server                   | ESP32
3:00:33 PM    | POST /api/device/sync                     | ESP32 → Server
3:00:33 PM    | Server queries pending commands           | Server
3:00:33 PM    | Server responds with cmd_xyz789           | Server → ESP32
3:00:33 PM    | ESP32 processes command                   | ESP32
3:00:33 PM    | Pump turns ON! 💧                         | Physical Hardware
3:00:33 PM    | Queue acknowledgement                     | ESP32
              |                                           |
3:00:36 PM    | ESP32 syncs again                         | ESP32
3:00:36 PM    | Send acknowledgement                      | ESP32 → Server
3:00:36 PM    | UPDATE commands (status: "executed")      | Database
```

**Total Delay:** ~33-36 seconds after scheduled time

---

## 🔴 Why Your Pump Didn't Turn On

Based on this complete flow, the pump didn't turn on because **ONE** of these steps failed:

### 1. **Server Scheduler Not Running** (Most Likely)
**Check:** Look for this in server logs:
```
[Server] Scheduled command processor initialised.
[Scheduler] Starting scheduled command processor
```

**If missing:** The scheduler never started, so Step 5 never happened!

**Why:** You're on **Vercel**, which is serverless. The `server.ts` file is **NOT** used on Vercel! Vercel uses its own runtime.

**Solution:** Add a cron job (see below).

### 2. **Scheduler Ran But Failed**
**Check:** Look for errors in logs:
```
[Scheduler] Error processing scheduled commands: ...
```

### 3. **Command Created But ESP32 Didn't Sync**
**Check ESP32 Serial Monitor:**
```
----- Sync Start -----
HTTP 200
Response:
{"pendingCommands":[]}  ← Empty!
```

### 4. **Command Rejected by ESP32**
**Check ESP32 Serial Monitor:**
```
Pump blocked: tank already full
```

### 5. **WiFi Disconnected**
**Check ESP32 Serial Monitor:**
```
[WiFi] Connection failed.
```

---

## ✅ The Fix: Add Vercel Cron Job

Since Vercel doesn't support `server.ts`, you need a cron job:

### 1. Create Cron Endpoint

```typescript
// app/api/cron/process-scheduled-commands/route.ts
import { processDueScheduledCommands } from "@/lib/services/scheduled-command.service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const results = await processDueScheduledCommands();
    return Response.json({
      success: true,
      processed: results.processed,
      succeeded: results.succeeded,
      failed: results.failed,
    });
  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
```

### 2. Add to `vercel.json`

```json
{
  "crons": [{
    "path": "/api/cron/process-scheduled-commands",
    "schedule": "* * * * *"
  }]
}
```

This runs **every minute** instead of every 30 seconds, but it will work!

---

## 📝 Summary

**The scheduled command flow:**

1. ✅ Dashboard → API → Database (`scheduledCommands` table, status: "pending")
2. ❌ **Server scheduler** (runs every 30s) → Creates regular command
3. ✅ ESP32 syncs → Receives command → Executes → Sends ack

**Your issue:** Step 2 doesn't happen on Vercel because `server.ts` isn't used!

**The fix:** Add a Vercel cron job to trigger the scheduler every minute.

Would you like me to create the cron endpoint files for you?
