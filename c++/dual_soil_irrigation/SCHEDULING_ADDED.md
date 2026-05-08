# Scheduled Commands Added to Dual Soil Irrigation

## ✅ Implementation Complete!

I've added ESP32-side scheduled commands support to the **dual_soil_irrigation.ino** controller.

## 🎯 What Was Added:

### 1. Scheduled Commands Storage
```cpp
constexpr size_t MAX_SCHEDULED_COMMANDS = 10;

struct ScheduledCommand {
  bool active;
  char commandId[48];
  char channelKey[32];
  uint32_t scheduledEpoch;  // Uses server time sync
  bool desiredBooleanState;
  // ... other fields
};

ScheduledCommand scheduledCommands[10];
```

### 2. Time Parser
```cpp
uint32_t parseScheduledTimeToEpoch(const char* isoTime) {
  // Parses: "2024-05-04T15:00:00.000Z"
  // Applies UTC+1 offset (same as server time sync)
  // Returns: Unix epoch timestamp
}
```

### 3. Storage Function
```cpp
bool storeScheduledCommand(JsonObject cmd) {
  // Stores scheduled command from server
  // Validates time format
  // Prevents duplicates
  // Returns true if stored successfully
}
```

### 4. Execution Checker
```cpp
void checkAndExecuteScheduledCommands(uint32_t nowEpoch, float moisturePct) {
  // Checks every second if any commands are due
  // Executes commands at scheduled time
  // Safety check: won't open valve if soil saturated
  // Sends acknowledgements back to server
}
```

### 5. Integration Points

**In syncDevice():**
```cpp
// Process scheduled commands from server
JsonArray scheduledCommandsArray = resp["scheduledCommands"];
for (JsonObject cmd : scheduledCommandsArray) {
  storeScheduledCommand(cmd);
}

// Check and execute any due scheduled commands
checkAndExecuteScheduledCommands(currentEpoch(), moisturePct);
```

**In loop():**
```cpp
// Check scheduled commands every second
static uint32_t lastScheduleCheck = 0;
if ((uint32_t)(now - lastScheduleCheck) >= 1000UL) {
  lastScheduleCheck = now;
  if (timeSynced) {
    checkAndExecuteScheduledCommands(currentEpoch(), moisturePct);
  }
}
```

## 🔄 Complete Flow:

```
1. Dashboard: User schedules "Open valve at 3:00 PM"
   ↓
2. Server: Stores in scheduledCommands table
   ↓
3. ESP32 Syncs: Receives scheduledCommands array
   ↓
4. ESP32 Stores: Parses time, stores locally
   ↓
5. ESP32 Checks: Every 1 second, compares nowEpoch >= scheduledEpoch
   ↓
6. ESP32 Executes: At 3:00 PM, opens valve
   ↓
7. ESP32 Acknowledges: Sends "executed" status to server
```

## 📊 Key Features:

### ✅ Server Time Sync
- Uses `serverTime` from API (already implemented)
- Applies UTC+1 offset automatically
- Syncs every 3 seconds

### ✅ Safety Checks
```cpp
// Won't open valve if soil already saturated
if (desiredState && moisturePct >= VALVE_CLOSE_THRESHOLD_PCT) {
  queueAck(commandId, "failed", "Soil already saturated");
}
```

### ✅ Storage Management
- Max 10 scheduled commands
- Prevents duplicates
- Auto-removes after execution

### ✅ Time Accuracy
- Checks every 1 second
- Execution accuracy: ±1 second
- Uses same time sync as server

## 🔍 Serial Monitor Output:

### When Command Received:
```
[SCHED] Stored command schcmd_abc123 for epoch 1714838400 (2024-05-04T15:00:00.000Z)
[SCHED] Channel: irrigation_valve_1, Action: OPEN
[SCHED] 1 scheduled command(s) in storage
```

### When Command Executes:
```
[SCHED] ⏰ Executing scheduled command: schcmd_abc123
[SCHED] Scheduled for: 1714838400, Current: 1714838400
[SCHED] ✓ Valve set to OPEN for 60 seconds
[VALVE] OPEN
```

### When Blocked (Soil Saturated):
```
[SCHED] ⚠️ Blocked: Soil already saturated (75.2%)
```

## 🚀 How to Use:

### 1. Upload Updated Code
```bash
1. Open dual_soil_irrigation.ino in Arduino IDE
2. Verify code compiles
3. Upload to ESP32
4. Open Serial Monitor (115200 baud)
```

### 2. Schedule from Dashboard
```
1. Go to soil irrigation controller page
2. Click "Schedule" button
3. Select valve channel
4. Set action: "Open" or "Close"
5. Set date and time
6. Click "Schedule Command"
```

### 3. Watch It Work
```
Serial Monitor will show:
- Command received and stored
- Time sync updates
- Command execution at scheduled time
- Acknowledgement sent
```

## ⏰ Timing:

- **Sync interval:** 3 seconds
- **Check interval:** 1 second
- **Execution accuracy:** ±1 second
- **Time source:** Server time (UTC+1)

## 🛡️ Safety Features:

1. **Soil Saturation Check:** Won't open valve if moisture ≥70%
2. **Max Open Time:** Valve auto-closes after 5 minutes
3. **Sensor Fault Protection:** Closes valve if sensor fails
4. **Duplicate Prevention:** Won't store same command twice
5. **Time Validation:** Validates ISO time format

## 📝 Differences from Water Tank Controller:

| Feature | Water Tank | Dual Soil |
|---------|-----------|-----------|
| Time source | DS3231 RTC | Server time sync |
| Time accuracy | ±2 min/year | Syncs every 3 sec |
| Offline capability | Yes | No (needs WiFi) |
| Timezone | UTC+1 (RTC) | UTC+1 (server) |
| Storage | 10 commands | 10 commands |

## ✅ Summary:

**Both controllers now support scheduled commands!**

- **Water Tank:** Uses DS3231 RTC (offline capable)
- **Dual Soil:** Uses server time sync (requires WiFi)

Both execute commands at exact scheduled time with ±1 second accuracy! 🎉
