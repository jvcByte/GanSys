#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <string.h>

const char* WIFI_SSID = "Ikop";
const char* WIFI_PASSWORD = "maxy1234";

const char* SERVER_URL = "https://gansystems.vercel.app/api/device/sync";
const char* DEVICE_ID = "ESP32-CONTROLLER";
const char* DEVICE_KEY = "rX0Wb8B8MyynWss9-gjLSSyiktDcc8gO";
const char* FIRMWARE_VERSION = "1.0.0";

const char* TANK_CHANNEL_KEY = "tank_main";
const char* PUMP_CHANNEL_KEY = "pump_main";

constexpr uint8_t TRIG_PIN = 5;
constexpr uint8_t ECHO_PIN = 18;
constexpr uint8_t PUMP_RELAY_PIN = 26;

// Flip this if your relay LED / pump logic is opposite
constexpr bool RELAY_ACTIVE_LOW = false;

// Tank calibration
constexpr float TANK_EMPTY_DISTANCE_CM = 60.0f;
constexpr float TANK_FULL_DISTANCE_CM  = 20.0f;

// Auto control thresholds
constexpr float TANK_PUMP_ON_PERCENT  = 20.0f;
constexpr float TANK_PUMP_OFF_PERCENT = 90.0f;

// Timing
constexpr uint32_t SYNC_INTERVAL_MS = 3000UL;          // 3 seconds
constexpr uint32_t MANUAL_OVERRIDE_MS = 60000UL;       // 60 seconds
constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 15000UL;
constexpr uint32_t HTTP_CONNECT_TIMEOUT_MS = 8000UL;
constexpr uint32_t HTTP_TIMEOUT_MS = 10000UL;
constexpr uint32_t FAILURE_RETRY_MS = 3000UL;

// Acknowledgements
constexpr size_t ACK_QUEUE_SIZE = 8;
constexpr size_t COMMAND_ID_LEN = 48;
constexpr size_t ACK_STATUS_LEN = 16;
constexpr size_t ACK_MESSAGE_LEN = 96;

struct AckItem {
  bool used;
  char commandId[COMMAND_ID_LEN];
  char status[ACK_STATUS_LEN];
  char message[ACK_MESSAGE_LEN];
};

AckItem ackQueue[ACK_QUEUE_SIZE];

uint32_t nextSyncDelayMs = SYNC_INTERVAL_MS;
uint32_t lastSyncMs = 0;

bool pumpState = false;

// Manual override state
bool manualOverrideActive = false;
bool manualOverrideDesiredState = false;
uint32_t manualOverrideExpiresAtMs = 0;

float clampf(float value, float low, float high) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

void copyText(char* dest, size_t destSize, const char* src) {
  if (destSize == 0) return;
  if (src == nullptr) src = "";
  strncpy(dest, src, destSize - 1);
  dest[destSize - 1] = '\0';
}

void clearAckQueue() {
  for (size_t i = 0; i < ACK_QUEUE_SIZE; i++) {
    ackQueue[i].used = false;
    ackQueue[i].commandId[0] = '\0';
    ackQueue[i].status[0] = '\0';
    ackQueue[i].message[0] = '\0';
  }
}

bool hasPendingAcks() {
  for (size_t i = 0; i < ACK_QUEUE_SIZE; i++) {
    if (ackQueue[i].used) return true;
  }
  return false;
}

bool ackQueuedFor(const char* commandId) {
  if (commandId == nullptr || commandId[0] == '\0') return false;

  for (size_t i = 0; i < ACK_QUEUE_SIZE; i++) {
    if (ackQueue[i].used && strcmp(ackQueue[i].commandId, commandId) == 0) {
      return true;
    }
  }
  return false;
}

bool queueAck(const char* commandId, const char* status, const char* message) {
  if (commandId == nullptr || commandId[0] == '\0') return false;

  for (size_t i = 0; i < ACK_QUEUE_SIZE; i++) {
    if (!ackQueue[i].used) {
      ackQueue[i].used = true;
      copyText(ackQueue[i].commandId, sizeof(ackQueue[i].commandId), commandId);
      copyText(ackQueue[i].status, sizeof(ackQueue[i].status), status);
      copyText(ackQueue[i].message, sizeof(ackQueue[i].message), message);
      return true;
    }
  }

  Serial.println("Ack queue full; dropping acknowledgement.");
  return false;
}

void setPump(bool on) {
  digitalWrite(PUMP_RELAY_PIN, RELAY_ACTIVE_LOW ? !on : on);
  pumpState = on;
}

bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to WiFi");
  uint32_t start = millis();

  while (WiFi.status() != WL_CONNECTED &&
         (millis() - start) < WIFI_CONNECT_TIMEOUT_MS) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected. IP: ");
    Serial.println(WiFi.localIP());
    return true;
  }

  Serial.println("WiFi connection failed.");
  return false;
}

float readDistanceOnceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(3);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 30000UL);
  if (duration == 0) return -1.0f;

  return (duration * 0.0343f) / 2.0f;
}

float readTankDistanceCm() {
  float total = 0.0f;
  int valid = 0;

  for (int i = 0; i < 5; i++) {
    float d = readDistanceOnceCm();
    if (d > 0.0f && d < 500.0f) {
      total += d;
      valid++;
    }
    delay(50);
  }

  if (valid == 0) return -1.0f;
  return total / valid;
}

float readTankPercent(float distanceCm) {
  if (distanceCm < 0.0f) return -1.0f;

  float percent =
      100.0f * (TANK_EMPTY_DISTANCE_CM - distanceCm) /
      (TANK_EMPTY_DISTANCE_CM - TANK_FULL_DISTANCE_CM);

  return clampf(percent, 0.0f, 100.0f);
}

bool manualOverrideValid() {
  if (!manualOverrideActive) return false;

  // millis() wrap-safe check
  if ((int32_t)(millis() - manualOverrideExpiresAtMs) >= 0) {
    manualOverrideActive = false;
    manualOverrideDesiredState = false;
    manualOverrideExpiresAtMs = 0;
    return false;
  }

  return true;
}

void cancelManualOverride() {
  manualOverrideActive = false;
  manualOverrideDesiredState = false;
  manualOverrideExpiresAtMs = 0;
}

void applyPumpControl(float tankPercent) {
  // Sensor fault => fail safe OFF
  if (tankPercent < 0.0f) {
    setPump(false);
    cancelManualOverride();
    return;
  }

  // Hard safety stop: full / high tank always forces OFF
  if (tankPercent >= TANK_PUMP_OFF_PERCENT) {
    setPump(false);
    cancelManualOverride();
    return;
  }

  // Low tank always forces ON
  if (tankPercent <= TANK_PUMP_ON_PERCENT) {
    setPump(true);
    return;
  }

  // Middle zone: manual override only
  if (manualOverrideValid()) {
    setPump(manualOverrideDesiredState);
    return;
  }

  // Middle zone without manual override:
  // keep current pump state
}

bool processPendingCommands(JsonArray commands, float tankPercent) {
  if (commands.isNull()) return false;

  bool queuedAnyAck = false;

  for (JsonObject cmd : commands) {
    const char* commandId = cmd["commandId"] | "";
    const char* channelKey = cmd["channelKey"] | "";
    const char* commandType = cmd["commandType"] | "";

    if (commandId[0] == '\0') continue;

    if (ackQueuedFor(commandId)) {
      Serial.printf("Command %s already queued.\n", commandId);
      continue;
    }

    if (strcmp(channelKey, PUMP_CHANNEL_KEY) != 0) {
      queuedAnyAck |= queueAck(commandId, "failed", "Unsupported channel");
      continue;
    }

    if (strcmp(commandType, "set_state") != 0) {
      queuedAnyAck |= queueAck(commandId, "failed", "Unsupported command type");
      continue;
    }

    if (cmd["desiredBooleanState"].isNull()) {
      queuedAnyAck |= queueAck(commandId, "failed", "desiredBooleanState missing");
      continue;
    }

    bool desiredState = cmd["desiredBooleanState"].as<bool>();

    // Dashboard command cannot force ON when tank is already high/full
    if (tankPercent >= TANK_PUMP_OFF_PERCENT && desiredState) {
      queuedAnyAck |= queueAck(commandId, "failed", "Pump blocked: tank already full");
      continue;
    }

    // Manual override lasts 60 seconds, but auto control still wins at 90%+
    manualOverrideActive = true;
    manualOverrideDesiredState = desiredState;
    manualOverrideExpiresAtMs = millis() + MANUAL_OVERRIDE_MS;

    queuedAnyAck |= queueAck(
      commandId,
      "acknowledged",
      "Manual override active for 60 seconds"
    );

    Serial.printf("Applied command %s: manual override %s for 60s\n",
                  commandId, desiredState ? "ON" : "OFF");
  }

  return queuedAnyAck;
}

void syncDevice() {
  if (!connectWiFi()) {
    nextSyncDelayMs = FAILURE_RETRY_MS;
    return;
  }

  float distanceCm = readTankDistanceCm();
  float tankPercent = readTankPercent(distanceCm);

  // Apply local safety control before reporting
  applyPumpControl(tankPercent);

  DynamicJsonDocument requestDoc(2048);
  requestDoc["firmwareVersion"] = FIRMWARE_VERSION;

  JsonArray readings = requestDoc.createNestedArray("readings");

  JsonObject tank = readings.createNestedObject();
  tank["channelKey"] = TANK_CHANNEL_KEY;
  if (tankPercent >= 0.0f) {
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
  for (size_t i = 0; i < ACK_QUEUE_SIZE; i++) {
    if (!ackQueue[i].used) continue;

    JsonObject ack = acknowledgements.createNestedObject();
    ack["commandId"] = ackQueue[i].commandId;
    ack["status"] = ackQueue[i].status;
    ack["deviceMessage"] = ackQueue[i].message;
  }

  if (requestDoc.overflowed()) {
    Serial.println("Request JSON overflowed.");
    nextSyncDelayMs = FAILURE_RETRY_MS;
    return;
  }

  String body;
  serializeJson(requestDoc, body);

  WiFiClientSecure secureClient;
  secureClient.setInsecure();

  HTTPClient http;
  if (!http.begin(secureClient, SERVER_URL)) {
    Serial.println("HTTPS begin failed.");
    nextSyncDelayMs = FAILURE_RETRY_MS;
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-id", DEVICE_ID);
  http.addHeader("x-device-key", DEVICE_KEY);
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);

  Serial.println("----- Sync Start -----");
  Serial.print("Payload: ");
  Serial.println(body);

  int statusCode = http.POST(body);
  String errorText = (statusCode <= 0) ? http.errorToString(statusCode) : "";
  String response = (statusCode > 0) ? http.getString() : "";
  http.end();

  Serial.printf("HTTP %d\n", statusCode);
  if (response.length() > 0) {
    Serial.println("Response:");
    Serial.println(response);
  }

  if (statusCode < 200 || statusCode >= 300) {
    if (statusCode <= 0) {
      Serial.printf("HTTP error: %s\n", errorText.c_str());
    }
    Serial.println("Sync failed.");
    Serial.println("----- Sync End -----");
    nextSyncDelayMs = FAILURE_RETRY_MS;
    return;
  }

  // Server accepted the sync, so acknowledgements can be cleared
  clearAckQueue();

  DynamicJsonDocument responseDoc(8192);
  DeserializationError err = deserializeJson(responseDoc, response);
  if (err) {
    Serial.print("Response parse failed: ");
    Serial.println(err.c_str());
    Serial.println("----- Sync End -----");
    nextSyncDelayMs = FAILURE_RETRY_MS;
    return;
  }

  JsonArray pendingCommands = responseDoc["pendingCommands"].as<JsonArray>();
  processPendingCommands(pendingCommands, tankPercent);

  // Re-apply control after dashboard command handling
  applyPumpControl(tankPercent);

  // Fixed 3-second polling
  nextSyncDelayMs = SYNC_INTERVAL_MS;

  if (hasPendingAcks()) {
    nextSyncDelayMs = 1000UL;
  }

  Serial.printf("Next sync in %lu ms\n", nextSyncDelayMs);
  Serial.println("----- Sync End -----");
}

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(PUMP_RELAY_PIN, OUTPUT);

  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);

  clearAckQueue();
  setPump(false);

  syncDevice();
  lastSyncMs = millis();
}

void loop() {
  uint32_t now = millis();

  if ((uint32_t)(now - lastSyncMs) >= nextSyncDelayMs) {
    lastSyncMs = now;
    syncDevice();
  }
}