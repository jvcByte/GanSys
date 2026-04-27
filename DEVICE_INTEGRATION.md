# Device Integration Guide for Scheduled Commands

## Overview

Scheduled commands are executed server-side and sent to your device via MQTT at the scheduled time. From the device's perspective, scheduled commands look exactly like manual commands.

## How It Works

1. **Server schedules command** - User schedules via web dashboard
2. **Background processor executes** - At scheduled time, server creates a regular command
3. **MQTT delivery** - Command is published to `gansys/{hardwareId}/commands`
4. **Device receives** - Your Arduino/ESP32 receives the command
5. **Device executes** - Device performs the action (turn on/off actuator)
6. **Device acknowledges** - Device publishes acknowledgement to `gansys/{hardwareId}/acks`

## No Changes Required!

Your existing device code should work without modifications because:

- Scheduled commands become regular commands when executed
- They use the same MQTT topics
- They have the same JSON structure
- They require the same acknowledgement format

## Command Format (Unchanged)

Commands arrive on topic `gansys/{hardwareId}/commands`:

```json
{
  "commands": [
    {
      "id": "cmd_abc123",
      "channelKey": "spray_pump",
      "commandType": "set_state",
      "desiredBooleanState": true,
      "note": "Scheduled: Spray pesticide for 15 minutes",
      "overrideUntil": "2026-04-27T15:30:00Z"
    }
  ],
  "pestControlSchedule": {
    "enabled": true,
    "sprayEntries": [...],
    "uvStartTime": "18:00",
    "uvEndTime": "06:00"
  }
}
```

## Acknowledgement Format (Unchanged)

Publish to `gansys/{hardwareId}/acks`:

```json
{
  "acknowledgements": [
    {
      "commandId": "cmd_abc123",
      "status": "acknowledged",
      "executedAt": "2026-04-27T15:20:05Z",
      "deviceMessage": "Spray pump activated"
    }
  ]
}
```

## Using RTC Module

Your RTC module can be used for:

### 1. Local Time Keeping
```cpp
#include <RTClib.h>

RTC_DS3231 rtc;

void setup() {
  if (!rtc.begin()) {
    Serial.println("RTC not found!");
  }
  
  // Sync with NTP or set manually
  if (rtc.lostPower()) {
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  }
}

void loop() {
  DateTime now = rtc.now();
  
  // Use for logging
  Serial.print("Current time: ");
  Serial.println(now.timestamp());
}
```

### 2. Command Timestamp Validation
```cpp
void handleCommand(JsonObject cmd) {
  DateTime now = rtc.now();
  String overrideUntil = cmd["overrideUntil"];
  
  // Parse ISO 8601 timestamp
  DateTime expiry = parseISO8601(overrideUntil);
  
  if (now > expiry) {
    Serial.println("Command expired, ignoring");
    return;
  }
  
  // Execute command
  executeCommand(cmd);
}
```

### 3. Execution Time Logging
```cpp
void acknowledgeCommand(String commandId) {
  DateTime now = rtc.now();
  
  JsonDocument doc;
  JsonArray acks = doc["acknowledgements"].to<JsonArray>();
  JsonObject ack = acks.add<JsonObject>();
  
  ack["commandId"] = commandId;
  ack["status"] = "acknowledged";
  ack["executedAt"] = now.timestamp(DateTime::TIMESTAMP_FULL);
  ack["deviceMessage"] = "Executed at local time";
  
  publishAcknowledgement(doc);
}
```

### 4. Offline Command Queue
```cpp
struct QueuedCommand {
  String commandId;
  String channelKey;
  bool desiredState;
  DateTime scheduledFor;
};

std::vector<QueuedCommand> commandQueue;

void queueCommand(JsonObject cmd) {
  QueuedCommand queued;
  queued.commandId = cmd["id"].as<String>();
  queued.channelKey = cmd["channelKey"].as<String>();
  queued.desiredState = cmd["desiredBooleanState"];
  queued.scheduledFor = parseISO8601(cmd["overrideUntil"]);
  
  commandQueue.push_back(queued);
}

void processCommandQueue() {
  DateTime now = rtc.now();
  
  for (auto it = commandQueue.begin(); it != commandQueue.end();) {
    if (now >= it->scheduledFor) {
      executeQueuedCommand(*it);
      it = commandQueue.erase(it);
    } else {
      ++it;
    }
  }
}
```

## Example Arduino Sketch

```cpp
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <RTClib.h>

RTC_DS3231 rtc;
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

const char* HARDWARE_ID = "ESP32_001";

void setup() {
  Serial.begin(115200);
  
  // Initialize RTC
  if (!rtc.begin()) {
    Serial.println("RTC not found!");
  }
  
  // Connect to WiFi
  WiFi.begin("SSID", "PASSWORD");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
  
  // Connect to MQTT
  mqtt.setServer("mqtt.example.com", 1883);
  mqtt.setCallback(onMqttMessage);
  connectMqtt();
}

void loop() {
  if (!mqtt.connected()) {
    connectMqtt();
  }
  mqtt.loop();
  
  // Your existing code...
}

void connectMqtt() {
  String clientId = String("gansys_") + HARDWARE_ID;
  
  if (mqtt.connect(clientId.c_str(), "username", "password")) {
    String commandTopic = String("gansys/") + HARDWARE_ID + "/commands";
    mqtt.subscribe(commandTopic.c_str());
    Serial.println("MQTT connected");
  }
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  JsonDocument doc;
  deserializeJson(doc, payload, length);
  
  if (doc.containsKey("commands")) {
    JsonArray commands = doc["commands"];
    for (JsonObject cmd : commands) {
      handleCommand(cmd);
    }
  }
}

void handleCommand(JsonObject cmd) {
  String commandId = cmd["id"];
  String channelKey = cmd["channelKey"];
  bool desiredState = cmd["desiredBooleanState"];
  
  Serial.print("Executing command: ");
  Serial.println(commandId);
  
  // Execute the command
  if (channelKey == "spray_pump") {
    digitalWrite(SPRAY_PUMP_PIN, desiredState ? HIGH : LOW);
  }
  
  // Acknowledge
  acknowledgeCommand(commandId, "acknowledged", "Command executed successfully");
}

void acknowledgeCommand(String commandId, String status, String message) {
  DateTime now = rtc.now();
  
  JsonDocument doc;
  JsonArray acks = doc["acknowledgements"].to<JsonArray>();
  JsonObject ack = acks.add<JsonObject>();
  
  ack["commandId"] = commandId;
  ack["status"] = status;
  ack["executedAt"] = now.timestamp(DateTime::TIMESTAMP_FULL);
  ack["deviceMessage"] = message;
  
  String payload;
  serializeJson(doc, payload);
  
  String ackTopic = String("gansys/") + HARDWARE_ID + "/acks";
  mqtt.publish(ackTopic.c_str(), payload.c_str());
}
```

## Testing

1. **Schedule a command** via web dashboard for 2 minutes in the future
2. **Monitor serial output** on your device
3. **Verify command received** at the scheduled time
4. **Check acknowledgement** is sent back to server
5. **Confirm in dashboard** that command status shows "acknowledged"

## Troubleshooting

### Command not received
- Check MQTT connection is active
- Verify subscription to `gansys/{hardwareId}/commands`
- Check server logs for scheduler activity

### RTC time drift
- Sync RTC with NTP periodically
- Use DS3231 (more accurate than DS1307)
- Check battery backup

### Commands expire before execution
- Ensure device clock is synchronized
- Check `overrideUntil` timestamp parsing
- Verify time zone handling

## Notes

- Scheduled commands have a 2-minute override window by default
- Device should execute commands immediately when received
- RTC is optional but recommended for accurate logging
- All timestamps use ISO 8601 format with UTC timezone
