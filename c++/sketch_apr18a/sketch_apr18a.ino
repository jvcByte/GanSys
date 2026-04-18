#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* WIFI_SSID = "MTN_4G_B1583C";
const char* WIFI_PASSWORD = "4E0CB315";

// Laptop IP on your hotspot/Wi-Fi network.
const char* SERVER_URL = "http://gansystems.up.railway.app/api/device/sync";

const char* DEVICE_ID = "ESP32-CONTROLLER";
const char* DEVICE_KEY = "N3GGKSldVHv68-2Vr5M_vpld9xowwjNe";
const char* FIRMWARE_VERSION = "1.0.0";

const char* TANK_CHANNEL_KEY = "tank_main";
const char* PUMP_CHANNEL_KEY = "pump_main";

// Leave blank unless you know the backend DB channel id for pump_main.
const char* PUMP_CHANNEL_ID = "";

const uint8_t TRIG_PIN = 5;
const uint8_t ECHO_PIN = 18;
const uint8_t PUMP_RELAY_PIN = 26;

const bool RELAY_ACTIVE_LOW = true;
const float TANK_EMPTY_DISTANCE_CM = 160.0f;
const float TANK_FULL_DISTANCE_CM = 20.0f;

uint32_t syncIntervalMs = 30000;
uint32_t lastSyncMs = 0;
bool pumpState = false;

struct AckItem {
  bool used = false;
  String commandId;
  String status;
  String message;
};

AckItem ackQueue[4];

float clampf(float value, float low, float high) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

void setPump(bool on) {
  digitalWrite(PUMP_RELAY_PIN, RELAY_ACTIVE_LOW ? !on : on);
  pumpState = on;
}

void queueAck(const String& commandId, const String& status, const String& message) {
  for (int i = 0; i < 4; i++) {
    if (!ackQueue[i].used) {
      ackQueue[i].used = true;
      ackQueue[i].commandId = commandId;
      ackQueue[i].status = status;
      ackQueue[i].message = message;
      return;
    }
  }
  Serial.println("Ack queue full, dropping acknowledgement.");
}

void clearAckQueue() {
  for (int i = 0; i < 4; i++) {
    ackQueue[i].used = false;
    ackQueue[i].commandId = "";
    ackQueue[i].status = "";
    ackQueue[i].message = "";
  }
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to WiFi");
  uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 20000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected. ESP32 IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("Gateway: ");
    Serial.println(WiFi.gatewayIP());
  } else {
    Serial.println("WiFi connection failed.");
  }
}

float readTankDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(3);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration <= 0) return -1.0f;

  return (duration * 0.0343f) / 2.0f;
}

float readTankPercent(float distanceCm) {
  if (distanceCm < 0) return -1.0f;
  float percent = 100.0f * (TANK_EMPTY_DISTANCE_CM - distanceCm) / (TANK_EMPTY_DISTANCE_CM - TANK_FULL_DISTANCE_CM);
  return clampf(percent, 0.0f, 100.0f);
}

bool commandTargetsPump(JsonObject cmd) {
  const char* channelKey = cmd["channelKey"] | "";
  if (strlen(channelKey) > 0 && String(channelKey) == PUMP_CHANNEL_KEY) return true;

  const char* channelId = cmd["channelId"] | "";
  if (strlen(PUMP_CHANNEL_ID) > 0 && String(channelId) == PUMP_CHANNEL_ID) return true;

  return false;
}

void processPendingCommands(JsonArray commands) {
  for (JsonObject cmd : commands) {
    const char* commandId = cmd["commandId"] | "";
    const char* channelId = cmd["channelId"] | "";
    const char* commandType = cmd["commandType"] | "";

    if (!commandTargetsPump(cmd)) {
      Serial.printf("Unmapped command: id=%s channelId=%s type=%s\n", commandId, channelId, commandType);
      continue;
    }

    if (cmd["desiredBooleanState"].isNull()) {
      queueAck(commandId, "failed", "desiredBooleanState missing");
      continue;
    }

    bool nextState = cmd["desiredBooleanState"].as<bool>();
    setPump(nextState);
    queueAck(commandId, "acknowledged", nextState ? "Pump turned on" : "Pump turned off");
    Serial.printf("Pump command applied: %s\n", nextState ? "ON" : "OFF");
  }
}

void syncDevice() {
  connectWiFi();
  if (WiFi.status() != WL_CONNECTED) return;

  float distanceCm = readTankDistanceCm();
  float tankPercent = readTankPercent(distanceCm);

  DynamicJsonDocument requestDoc(1024);
  requestDoc["firmwareVersion"] = FIRMWARE_VERSION;

  JsonArray readings = requestDoc.createNestedArray("readings");

  JsonObject tank = readings.createNestedObject();
  tank["channelKey"] = TANK_CHANNEL_KEY;
  if (tankPercent >= 0) {
    tank["numericValue"] = tankPercent;
    tank["rawValue"] = distanceCm;
    tank["rawUnit"] = "cm";
    tank["status"] = "ok";
  } else {
    tank["status"] = "fault";
  }

  JsonObject pump = readings.createNestedObject();
  pump["channelKey"] = PUMP_CHANNEL_KEY;
  pump["booleanState"] = pumpState;
  pump["numericValue"] = pumpState ? 1 : 0;
  pump["status"] = "ok";

  JsonArray acknowledgements = requestDoc.createNestedArray("acknowledgements");
  for (int i = 0; i < 4; i++) {
    if (!ackQueue[i].used) continue;
    JsonObject ack = acknowledgements.createNestedObject();
    ack["commandId"] = ackQueue[i].commandId;
    ack["status"] = ackQueue[i].status;
    ack["deviceMessage"] = ackQueue[i].message;
  }

  String body;
  serializeJson(requestDoc, body);

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-id", DEVICE_ID);
  http.addHeader("x-device-key", DEVICE_KEY);
  http.setConnectTimeout(8000);
  http.setTimeout(10000);

  Serial.println("----- Sync Start -----");
  Serial.printf("ESP32 IP: %s\n", WiFi.localIP().toString().c_str());
  Serial.printf("Gateway: %s\n", WiFi.gatewayIP().toString().c_str());
  Serial.printf("POST URL: %s\n", SERVER_URL);
  Serial.printf("Payload: %s\n", body.c_str());

  int statusCode = http.POST(body);
  String response = http.getString();

  Serial.printf("HTTP %d\n", statusCode);
  if (statusCode <= 0) {
    Serial.printf("HTTP error: %s\n", http.errorToString(statusCode).c_str());
  }
  Serial.println("Response:");
  Serial.println(response);

  http.end();

  if (statusCode < 200 || statusCode >= 300) {
    Serial.println("Sync failed.");
    return;
  }

  clearAckQueue();

  DynamicJsonDocument responseDoc(4096);
  DeserializationError err = deserializeJson(responseDoc, response);
  if (err) {
    Serial.print("Response parse failed: ");
    Serial.println(err.c_str());
    return;
  }

  int heartbeatSec = responseDoc["controller"]["heartbeatIntervalSec"] | 60;
  syncIntervalMs = (heartbeatSec > 5 ? (heartbeatSec - 5) * 1000UL : 5000UL);
  if (syncIntervalMs < 5000UL) syncIntervalMs = 5000UL;

  Serial.printf("Next sync in %lu ms\n", syncIntervalMs);

  JsonArray pendingCommands = responseDoc["pendingCommands"].as<JsonArray>();
  processPendingCommands(pendingCommands);

  Serial.println("----- Sync End -----");
}

void setup() {
  Serial.begin(115200);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(PUMP_RELAY_PIN, OUTPUT);
  setPump(false);

  connectWiFi();
  syncDevice();
  lastSyncMs = millis();
}

void loop() {
  if (millis() - lastSyncMs >= syncIntervalMs) {
    lastSyncMs = millis();
    syncDevice();
  }
}
