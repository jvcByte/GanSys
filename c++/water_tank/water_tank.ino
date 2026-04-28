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

constexpr bool RELAY_ACTIVE_LOW = true;
constexpr float TANK_EMPTY_DISTANCE_CM = 160.0f;
constexpr float TANK_FULL_DISTANCE_CM = 20.0f;

constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 15000;
constexpr uint32_t HTTP_CONNECT_TIMEOUT_MS = 8000;
constexpr uint32_t HTTP_TIMEOUT_MS = 10000;
constexpr uint32_t FAILURE_RETRY_MS = 5000;
constexpr uint32_t COMMAND_ACK_RETRY_MS = 1000;

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

uint32_t normalSyncDelayMs = 30000;
uint32_t nextSyncDelayMs = 5000;
uint32_t lastSyncMs = 0;
bool pumpState = false;

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
    if (ackQueue[i].used && strcmp(ackQueue[i].commandId, commandId) == 0) {
      copyText(ackQueue[i].status, sizeof(ackQueue[i].status), status);
      copyText(ackQueue[i].message, sizeof(ackQueue[i].message), message);
      return true;
    }
  }

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
  uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - started) < WIFI_CONNECT_TIMEOUT_MS) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected. ESP32 IP: ");
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

void sortAscending(float* values, int count) {
  for (int i = 0; i < count - 1; i++) {
    for (int j = i + 1; j < count; j++) {
      if (values[j] < values[i]) {
        float temp = values[i];
        values[i] = values[j];
        values[j] = temp;
      }
    }
  }
}

float readTankDistanceCm() {
  float samples[5];
  int count = 0;

  for (int i = 0; i < 5; i++) {
    float sample = readDistanceOnceCm();
    if (sample > 0.0f && sample < 500.0f) {
      samples[count++] = sample;
    }
    delay(60);
  }

  if (count == 0) return -1.0f;

  sortAscending(samples, count);
  return samples[count / 2];
}

float readTankPercent(float distanceCm) {
  if (distanceCm < 0.0f) return -1.0f;

  float percent = 100.0f * (TANK_EMPTY_DISTANCE_CM - distanceCm) /
                  (TANK_EMPTY_DISTANCE_CM - TANK_FULL_DISTANCE_CM);

  return clampf(percent, 0.0f, 100.0f);
}

uint32_t computeNormalSyncDelayMs(int heartbeatSec) {
  if (heartbeatSec < 15) heartbeatSec = 15;

  uint32_t delayMs = (heartbeatSec > 5)
    ? static_cast<uint32_t>(heartbeatSec - 5) * 1000UL
    : 5000UL;

  if (delayMs < 5000UL) delayMs = 5000UL;
  return delayMs;
}

bool processPendingCommands(JsonArray commands) {
  if (commands.isNull()) return false;

  bool queuedAnyAck = false;

  for (JsonObject cmd : commands) {
    const char* commandId = cmd["commandId"] | "";
    const char* channelKey = cmd["channelKey"] | "";
    const char* commandType = cmd["commandType"] | "";

    if (commandId[0] == '\0') continue;

    if (ackQueuedFor(commandId)) {
      Serial.printf("Command %s already applied; waiting to deliver ack.\n", commandId);
      continue;
    }

    if (strcmp(channelKey, PUMP_CHANNEL_KEY) != 0) {
      queuedAnyAck |= queueAck(commandId, "failed", "Unsupported channel for this firmware");
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

    bool nextState = cmd["desiredBooleanState"].as<bool>();
    setPump(nextState);

    queuedAnyAck |= queueAck(
      commandId,
      "acknowledged",
      nextState ? "Pump turned on" : "Pump turned off"
    );

    Serial.printf("Applied command %s: pump %s\n", commandId, nextState ? "ON" : "OFF");
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

  const bool useTls = strncmp(SERVER_URL, "https://", 8) == 0;
  WiFiClient plainClient;
  WiFiClientSecure secureClient;
  HTTPClient http;

  if (useTls) {
    // Replace with a real CA certificate for production.
    secureClient.setInsecure();
    if (!http.begin(secureClient, SERVER_URL)) {
      Serial.println("HTTPS begin failed.");
      nextSyncDelayMs = FAILURE_RETRY_MS;
      return;
    }
  } else {
    if (!http.begin(plainClient, SERVER_URL)) {
      Serial.println("HTTP begin failed.");
      nextSyncDelayMs = FAILURE_RETRY_MS;
      return;
    }
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-id", DEVICE_ID);
  http.addHeader("x-device-key", DEVICE_KEY);
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);

  Serial.println("----- Sync Start -----");
  Serial.print("POST URL: ");
  Serial.println(SERVER_URL);
  Serial.print("Transport: ");
  Serial.println(useTls ? "HTTPS" : "HTTP");
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

  int heartbeatSec = responseDoc["controller"]["heartbeatIntervalSec"] | 60;
  normalSyncDelayMs = computeNormalSyncDelayMs(heartbeatSec);

  JsonArray pendingCommands = responseDoc["pendingCommands"].as<JsonArray>();
  processPendingCommands(pendingCommands);

  nextSyncDelayMs = hasPendingAcks() ? COMMAND_ACK_RETRY_MS : normalSyncDelayMs;

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
