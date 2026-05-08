# ESP32 Scheduling Quick Reference

## 🎯 What It Does

Your ESP32 now handles scheduled commands locally using its DS3231 RTC. No server background processes needed!

## 📋 Quick Flow

```
Dashboard → Server DB → ESP32 Sync → ESP32 Storage → RTC Check → Execute
```

## 🔍 Serial Monitor Messages

### When Command is Received:
```
[SCHED] Stored command schcmd_abc123 for epoch 1714838400
[SCHED] Channel: pump_main, Action: ON
[SCHED] 1 scheduled command(s) in storage
```

### When Command Executes:
```
[SCHED] ⏰ Executing scheduled command: schcmd_abc123
[SCHED] Scheduled for: 1714838400, Current: 1714838400
[SCHED] ✓ Pump set to ON for 60 seconds
[PUMP] ON
```

### When Blocked (Tank Full):
```
[SCHED] ⚠️ Blocked: Tank is full (92.5%)
```

### When Acknowledged:
```
Payload: {"acknowledgements":[{"commandId":"schcmd_abc123","status":"executed",...}]}
HTTP 200
```

## ⏱️ Timing

- **Check interval:** Every 1 second
- **Execution accuracy:** ±1 second
- **Acknowledgement:** Next sync (3 seconds)

## 🛡️ Safety Features

1. **Tank Full Protection:** Won't turn on pump if tank ≥90%
2. **Storage Limit:** Max 10 scheduled commands
3. **Duplicate Prevention:** Won't store same command twice
4. **Time Validation:** Validates ISO time format

## 🔧 Key Functions

```cpp
// Store scheduled command from server
storeScheduledCommand(JsonObject cmd)

// Check and execute due commands
checkAndExecuteScheduledCommands(uint32_t nowEpoch, float tankPercent)

// Parse ISO time to epoch
parseIsoToEpoch(const char* isoTime)

// Count active scheduled commands
countActiveScheduledCommands()
```

## 📊 Storage

```cpp
struct ScheduledCommand {
  bool active;
  char commandId[48];
  char channelKey[32];
  uint32_t scheduledEpoch;  // Unix timestamp
  bool desiredBooleanState;
  // ... other fields
};

ScheduledCommand scheduledCommands[10];  // Max 10 commands
```

## 🚀 Usage

### 1. Schedule from Dashboard
- Go to controller page
- Click "Schedule"
- Set time and action
- Submit

### 2. Watch Serial Monitor
- See command received
- See command executed at scheduled time
- See acknowledgement sent

### 3. Verify Execution
- Check pump actually turned on
- Check dashboard shows "executed" status

## 🐛 Troubleshooting

| Problem | Check | Solution |
|---------|-------|----------|
| Commands not received | `[SCHED] Stored command...` | Check server deployment |
| Commands not executing | RTC time in Serial Monitor | Sync RTC from NTP |
| Tank full block | Tank level % | Wait for level to drop |
| Storage full | Command count | Wait or restart ESP32 |

## 📝 Important Notes

- **RTC must be accurate** - Syncs from NTP on startup
- **Max 10 commands** - Old ones removed after execution
- **UTC time** - Dashboard sends UTC, RTC should match
- **Safety first** - Won't turn on pump if tank full
- **Offline capable** - Executes even if WiFi drops

## ✅ Success Indicators

1. ✓ See `[SCHED] Stored command...` after sync
2. ✓ See `[SCHED] ⏰ Executing...` at scheduled time
3. ✓ See `[PUMP] ON` immediately after
4. ✓ See acknowledgement sent on next sync
5. ✓ Dashboard shows "executed" status

## 🎉 Result

**Your pump will turn on at exactly 3:00 PM with ±1 second accuracy!**

No server scheduler needed. No Vercel cron jobs. Just your ESP32 and RTC doing the work! 🚀
