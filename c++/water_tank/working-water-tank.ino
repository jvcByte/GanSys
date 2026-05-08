#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <RTClib.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <time.h>
#include <string.h>

// =============================================================================
//  GanSys Tank Controller – ESP32 + DS3231 Time Master
//  - Ultrasonic tank level sensing
//  - Pump control with manual override
//  - DS3231 RTC for reliable local time
//  - NTP sync with correct timezone
//  - mDNS hostname for slave ESP32 time sharing
// =============================================================================

const char* WIFI_SSID        = "Ikop";
const char* WIFI_PASSWORD    = "maxy1234";

const char* SERVER_URL       = "https://gansystems.vercel.app/api/device/sync";
const char* DEVICE_ID        = "ESP32-CONTROLLER";
const char* DEVICE_KEY       = "rX0Wb8B8MyynWss9-gjLSSyiktDcc8gO";
const char* FIRMWARE_VERSION = "1.0.0";

const char* TANK_CHANNEL_KEY = "tank_main";
const char* PUMP_CHANNEL_KEY = "pump_main";

// mDNS hostname for slaves: http://rtc-master.local/time
const char* MDNS_HOSTNAME    = "rtc-master";

// DS3231 I2C pins
constexpr uint8_t I2C_SDA_PIN = 21;
constexpr uint8_t I2C_SCL_PIN = 22;

// Hardware pins
constexpr uint8_t TRIG_PIN        = 5;
constexpr uint8_t ECHO_PIN        = 18;
constexpr uint8_t PUMP_RELAY_PIN  = 26;

// Flip this if your relay logic is opposite
constexpr bool RELAY_ACTIVE_LOW = false;

// Tank calibration
constexpr float TANK_EMPTY_DISTANCE_CM = 60.0f;
constexpr float TANK_FULL_DISTANCE_CM   = 20.0f;

// Auto control thresholds
constexpr float TANK_PUMP_ON_PERCENT  = 20.0f;
constexpr float TANK_PUMP_OFF_PERCENT = 90.0f;

// Timezone: Nigeria / WAT = UTC+1, no DST
constexpr long GMT_OFFSET_SEC = 3600;
constexpr int  DAYLIGHT_OFFSET_SEC = 0;

// Timing
constexpr uint32_t SYNC_INTERVAL_MS         = 3000UL;
constexpr uint32_t MANUAL_OVERRIDE_MS       = 60000UL;
constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS  = 15000UL;
constexpr uint32_t HTTP_CONNECT_TIMEOUT_MS  = 8000UL;
constexpr uint32_t HTTP_TIMEOUT_MS          = 10000UL;
constexpr uint32_t FAILURE_RETRY_MS         = 3000UL;
constexpr uint32_t SENSOR_READ_INTERVAL_MS  = 1000UL;
constexpr uint32_t LOCAL_CONTROL_INTERVAL_MS = 1000UL;

// Acknowledgements
constexpr size_t ACK_QUEUE_SIZE = 8;
constexpr size_t COMMAND_ID_LEN = 48;
constexpr size_t ACK_STATUS_LEN  = 16;
constexpr size_t ACK_MESSAGE_LEN = 96;

struct AckItem {
  bool used;
  char commandId[COMMAND_ID_LEN];
  char status[ACK_STATUS_LEN];
  char message[ACK_MESSAGE_LEN];
};

AckItem ackQueue[ACK_QUEUE_SIZE];

// RTC / Web server
RTC_DS3231 rtc;
WebServer server(80);
bool rtcReady  = false;
bool mdnsReady = false;
bool webReady   = false;

// Runtime state
uint32_t nextSyncDelayMs = SYNC_INTERVAL_MS;
uint32_t lastSyncMs      = 0;
uint32_t lastSensorMs    = 0;
uint32_t lastControlMs   = 0;

bool pumpState = false;

// Manual override state uses RTC epoch time
bool manualOverrideActive         = false;
bool manualOverrideDesiredState   = false;
uint32_t manualOverrideExpiresAtEpoch = 0;

float cachedDistanceCm = -1.0f;
float cachedTankPercent = -1.0f;

// =============================================================================
//  Helpers
// =============================================================================
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

String formatDateTime(const DateTime& dt) {
  char buf[32];
  snprintf(buf, sizeof(buf), "%04d-%02d-%02d %02d:%02d:%02d",
           dt.year(), dt.month(), dt.day(),
           dt.hour(), dt.minute(), dt.second());
  return String(buf);
}

uint32_t currentEpoch() {
  if (rtcReady) {
    return rtc.now().unixtime();
  }
  return millis() / 1000UL;
}

String currentIsoTime() {
  if (rtcReady) {
    return formatDateTime(rtc.now());
  }
  return String("RTC_NOT_READY");
}

// =============================================================================
//  ACK queue
// =============================================================================
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
      copyText(ackQueue[i].status,    sizeof(ackQueue[i].status),    status);
      copyText(ackQueue[i].message,   sizeof(ackQueue[i].message),   message);
      return true;
    }
  }

  Serial.println("[ACK] Queue full; dropping acknowledgement.");
  return false;
}

// =============================================================================
//  Valve / pump
// =============================================================================
void setPump(bool on) {
  digitalWrite(PUMP_RELAY_PIN, RELAY_ACTIVE_LOW ? !on : on);
  pumpState = on;
  Serial.printf("[PUMP] %s\n", on ? "ON" : "OFF");
}

void cancelManualOverride() {
  manualOverrideActive = false;
  manualOverrideDesiredState = false;
  manualOverrideExpiresAtEpoch = 0;
}

bool manualOverrideValid(uint32_t nowEpoch) {
  if (!manualOverrideActive) return false;

  if ((int32_t)(nowEpoch - manualOverrideExpiresAtEpoch) >= 0) {
    cancelManualOverride();
    return false;
  }
  return true;
}

// =============================================================================
//  RTC / mDNS / Web server
// =============================================================================
void handleRoot() {
  String msg = "GanSys RTC Master is running.\n";
  msg += "Time endpoint: /time\n";
  msg += "Epoch endpoint: /epoch\n";
  msg += "Health endpoint: /health\n";
  server.send(200, "text/plain", msg);
}

void handleTime() {
  uint32_t epoch = currentEpoch();

  DynamicJsonDocument doc(256);
  doc["deviceId"] = DEVICE_ID;
  doc["rtcReady"] = rtcReady;
  doc["epoch"] = epoch;
  doc["iso"] = currentIsoTime();
  doc["mdnsHost"] = String(MDNS_HOSTNAME) + ".local";

  String body;
  serializeJson(doc, body);
  server.send(200, "application/json", body);
}

void handleEpoch() {
  server.send(200, "text/plain", String(currentEpoch()));
}

void handleHealth() {
  DynamicJsonDocument doc(256);
  doc["ok"] = true;
  doc["wifi"] = (WiFi.status() == WL_CONNECTED);
  doc["rtcReady"] = rtcReady;
  doc["pumpState"] = pumpState;
  doc["mdnsReady"] = mdnsReady;
  doc["webReady"] = webReady;

  String body;
  serializeJson(doc, body);
  server.send(200, "application/json", body);
}

void startWebServices() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (webReady) return;

  if (!mdnsReady) {
    mdnsReady = MDNS.begin(MDNS_HOSTNAME);
    if (mdnsReady) {
      MDNS.addService("http", "tcp", 80);
      Serial.printf("[mDNS] Started as http://%s.local\n", MDNS_HOSTNAME);
    } else {
      Serial.println("[mDNS] Failed to start.");
    }
  }

  server.on("/", HTTP_GET, handleRoot);
  server.on("/time", HTTP_GET, handleTime);
  server.on("/epoch", HTTP_GET, handleEpoch);
  server.on("/health", HTTP_GET, handleHealth);
  server.begin();
  webReady = true;

  Serial.println("[HTTP] Time server started on port 80");
}

void initRTC() {
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  if (!rtc.begin()) {
    rtcReady = false;
    Serial.println("[RTC] DS3231 not found.");
    return;
  }

  rtcReady = true;

  if (rtc.lostPower()) {
    Serial.println("[RTC] Lost power; setting to compile time.");
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  }

  Serial.print("[RTC] Current time: ");
  Serial.println(formatDateTime(rtc.now()));
}

void syncRTCFromNTP() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[NTP] Wi-Fi not connected; skipping NTP sync.");
    return;
  }

  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, "pool.ntp.org", "time.nist.gov");

  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 10000)) {
    Serial.println("[NTP] Failed to get local time.");
    return;
  }

  rtc.adjust(DateTime(
    timeinfo.tm_year + 1900,
    timeinfo.tm_mon + 1,
    timeinfo.tm_mday,
    timeinfo.tm_hour,
    timeinfo.tm_min,
    timeinfo.tm_sec
  ));

  Serial.println("[NTP] RTC updated from network time.");
  Serial.print("[RTC] New time: ");
  Serial.println(formatDateTime(rtc.now()));
}

// =============================================================================
//  Wi-Fi
// =============================================================================
bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("[WiFi] Connecting");
  uint32_t start = millis();

  while (WiFi.status() != WL_CONNECTED &&
         (millis() - start) < WIFI_CONNECT_TIMEOUT_MS) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WiFi] Connected. IP: ");
    Serial.println(WiFi.localIP());
    startWebServices();
    syncRTCFromNTP();
    return true;
  }

  Serial.println("[WiFi] Connection failed.");
  return false;
}

// =============================================================================
//  Tank sensor
// =============================================================================
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

void refreshTankReading() {
  cachedDistanceCm = readTankDistanceCm();
  cachedTankPercent = readTankPercent(cachedDistanceCm);

  Serial.printf("[TANK] Distance: %.1f cm | Level: %.1f%%\n",
                cachedDistanceCm, cachedTankPercent);
}

// =============================================================================
//  Pump control logic
// =============================================================================
void applyPumpControl(float tankPercent, uint32_t nowEpoch) {
  if (tankPercent < 0.0f) {
    setPump(false);
    cancelManualOverride();
    return;
  }

  if (tankPercent >= TANK_PUMP_OFF_PERCENT) {
    setPump(false);
    cancelManualOverride();
    return;
  }

  if (tankPercent <= TANK_PUMP_ON_PERCENT) {
    setPump(true);
    return;
  }

  if (manualOverrideValid(nowEpoch)) {
    setPump(manualOverrideDesiredState);
    return;
  }

  // Middle zone: keep current state
}

// =============================================================================
//  Command processing
// =============================================================================
bool processPendingCommands(JsonArray commands, float tankPercent, uint32_t nowEpoch) {
  if (commands.isNull()) return false;

  bool queuedAnyAck = false;

  for (JsonObject cmd : commands) {
    const char* commandId   = cmd["commandId"] | cmd["id"] | "";
    const char* channelKey   = cmd["channelKey"] | "";
    const char* commandType  = cmd["commandType"] | "";

    if (commandId[0] == '\0') continue;
    if (ackQueuedFor(commandId)) continue;

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

    if (desiredState && tankPercent >= TANK_PUMP_OFF_PERCENT) {
      queuedAnyAck |= queueAck(commandId, "failed", "Pump blocked: tank already full");
      continue;
    }

    uint32_t overrideMs = MANUAL_OVERRIDE_MS;
    if (!cmd["overrideSeconds"].isNull()) {
      int s = cmd["overrideSeconds"].as<int>();
      if (s > 0) overrideMs = (uint32_t)s * 1000UL;
    } else if (!cmd["overrideMinutes"].isNull()) {
      int m = cmd["overrideMinutes"].as<int>();
      if (m > 0) overrideMs = (uint32_t)m * 60000UL;
    }

    manualOverrideActive = true;
    manualOverrideDesiredState = desiredState;
    manualOverrideExpiresAtEpoch = nowEpoch + (overrideMs / 1000UL);

    queuedAnyAck |= queueAck(commandId, "acknowledged", "Manual override active");

    Serial.printf("[CMD] %s → manual override %s for %lu s\n",
                  commandId, desiredState ? "ON" : "OFF",
                  (unsigned long)(overrideMs / 1000UL));
  }

  return queuedAnyAck;
}

// =============================================================================
//  Sync to cloud
// =============================================================================
void syncDevice() {
  if (!connectWiFi()) {
    nextSyncDelayMs = FAILURE_RETRY_MS;
    return;
  }

  uint32_t nowEpoch = currentEpoch();

  refreshTankReading();
  applyPumpControl(cachedTankPercent, nowEpoch);

  DynamicJsonDocument requestDoc(3072);
  requestDoc["firmwareVersion"] = FIRMWARE_VERSION;

  JsonObject clock = requestDoc.createNestedObject("clock");
  clock["rtcReady"] = rtcReady;
  clock["epoch"] = nowEpoch;
  clock["iso"] = currentIsoTime();
  clock["mdnsHost"] = String(MDNS_HOSTNAME) + ".local";

  JsonArray readings = requestDoc.createNestedArray("readings");

  JsonObject tank = readings.createNestedObject();
  tank["channelKey"] = TANK_CHANNEL_KEY;
  if (cachedTankPercent >= 0.0f) {
    tank["numericValue"] = cachedTankPercent;
    tank["rawValue"] = cachedDistanceCm;
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
    Serial.println("[SYNC] Request JSON overflowed.");
    nextSyncDelayMs = FAILURE_RETRY_MS;
    return;
  }

  String body;
  serializeJson(requestDoc, body);

  WiFiClientSecure secureClient;
  secureClient.setInsecure();

  HTTPClient http;
  if (!http.begin(secureClient, SERVER_URL)) {
    Serial.println("[SYNC] HTTPS begin failed.");
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
  processPendingCommands(pendingCommands, cachedTankPercent, nowEpoch);

  applyPumpControl(cachedTankPercent, nowEpoch);

  nextSyncDelayMs = SYNC_INTERVAL_MS;
  if (hasPendingAcks()) {
    nextSyncDelayMs = 1000UL;
  }

  Serial.printf("Next sync in %lu ms\n", (unsigned long)nextSyncDelayMs);
  Serial.println("----- Sync End -----");
}

// =============================================================================
//  Arduino entry points
// =============================================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n=== GanSys Tank Controller + DS3231 Time Master ===");

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(PUMP_RELAY_PIN, OUTPUT);

  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);

  clearAckQueue();
  setPump(false);

  initRTC();

  connectWiFi();

  refreshTankReading();
  lastSyncMs = millis();
  lastSensorMs = millis();
  lastControlMs = millis();

  if (WiFi.status() == WL_CONNECTED) {
    startWebServices();
  }

  syncDevice();
}

void loop() {
  if (webReady) {
    server.handleClient();
  }

  uint32_t nowMs = millis();

  if ((uint32_t)(nowMs - lastSensorMs) >= SENSOR_READ_INTERVAL_MS) {
    lastSensorMs = nowMs;
    refreshTankReading();
  }

  if ((uint32_t)(nowMs - lastControlMs) >= LOCAL_CONTROL_INTERVAL_MS) {
    lastControlMs = nowMs;
    applyPumpControl(cachedTankPercent, currentEpoch());
  }

  if ((uint32_t)(nowMs - lastSyncMs) >= nextSyncDelayMs) {
    lastSyncMs = nowMs;
    syncDevice();
  }

  if (WiFi.status() == WL_CONNECTED && !webReady) {
    startWebServices();
  }
}