// =============================================================================
//  Soil Irrigation Controller – ESP32 (Slave Time Client)
//  2× Capacitive Soil Sensors → 1× Solenoid Valve
//  Syncs to GAN Systems cloud API every 3 seconds
//  Gets time from master ESP32 over mDNS + HTTP
// =============================================================================

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <string.h>

// ─────────────────────────────────────────────────────────────────────────────
//  Network & API
// ─────────────────────────────────────────────────────────────────────────────
const char* WIFI_SSID              = "Ikop";
const char* WIFI_PASSWORD          = "maxy1234";

const char* SERVER_URL             = "https://gansystems.vercel.app/api/device/sync";
const char* DEVICE_ID              = "ESP32-SOIL-IRRIGATION";
const char* DEVICE_KEY             = "t-La6ONbo9xahSp1sczrZkQjw27yZwW2";
const char* FIRMWARE_VERSION       = "1.0.0";

// Master time source over LAN
const char* MASTER_HOSTNAME        = "rtc-master";   // resolves to rtc-master.local
const char* MASTER_TIME_PATH       = "/epoch";       // master returns plain epoch seconds

// ─────────────────────────────────────────────────────────────────────────────
//  Channel keys (must match dashboard exactly)
// ─────────────────────────────────────────────────────────────────────────────
const char* SOIL_ZONE1_KEY         = "soil_zone_1";    // Sensor 1
const char* SOIL_MOISTURE_KEY      = "soil_moisture";   // Sensor 2
const char* VALVE_CHANNEL_KEY      = "irrigation_valve_1";

// ─────────────────────────────────────────────────────────────────────────────
//  Hardware pins
// ─────────────────────────────────────────────────────────────────────────────
constexpr uint8_t SOIL_SENSOR1_PIN  = 34;   // ADC1 channel – capacitive sensor 1
constexpr uint8_t SOIL_SENSOR2_PIN  = 35;   // ADC1 channel – capacitive sensor 2
constexpr uint8_t VALVE_RELAY_PIN   = 26;   // Solenoid valve relay

// Flip to true if your relay board uses active-LOW logic
constexpr bool RELAY_ACTIVE_LOW     = false;

// ─────────────────────────────────────────────────────────────────────────────
//  Sensor calibration
// ─────────────────────────────────────────────────────────────────────────────
constexpr int   SOIL_ADC_DRY        = 2500;   // ADC reading in dry soil / air
constexpr int   SOIL_ADC_WET        = 1000;   // ADC reading in saturated soil
constexpr int   ADC_SAMPLES         = 10;
constexpr int   ADC_SAMPLE_DELAY_MS = 5;

// ─────────────────────────────────────────────────────────────────────────────
//  Auto-irrigation thresholds
// ─────────────────────────────────────────────────────────────────────────────
constexpr float VALVE_OPEN_THRESHOLD_PCT  = 30.0f;
constexpr float VALVE_CLOSE_THRESHOLD_PCT = 70.0f;

// ─────────────────────────────────────────────────────────────────────────────
//  Timing
// ─────────────────────────────────────────────────────────────────────────────
constexpr uint32_t SYNC_INTERVAL_MS          = 3000UL;
constexpr uint32_t TIME_SYNC_INTERVAL_MS     = 15000UL;  // resync slave clock every 15 s
constexpr uint32_t MANUAL_OVERRIDE_MS        = 60000UL;
constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS   = 15000UL;
constexpr uint32_t HTTP_CONNECT_TIMEOUT_MS   = 8000UL;
constexpr uint32_t HTTP_TIMEOUT_MS           = 10000UL;
constexpr uint32_t FAILURE_RETRY_MS          = 3000UL;
constexpr uint32_t MAX_VALVE_OPEN_MS         = 300000UL;  // 5 minutes

// ─────────────────────────────────────────────────────────────────────────────
//  Acknowledgement queue
// ─────────────────────────────────────────────────────────────────────────────
constexpr size_t ACK_QUEUE_SIZE    = 8;
constexpr size_t COMMAND_ID_LEN    = 48;
constexpr size_t ACK_STATUS_LEN    = 16;
constexpr size_t ACK_MESSAGE_LEN   = 96;

struct AckItem {
  bool used;
  char commandId[COMMAND_ID_LEN];
  char status[ACK_STATUS_LEN];
  char message[ACK_MESSAGE_LEN];
};

AckItem ackQueue[ACK_QUEUE_SIZE];

// ─────────────────────────────────────────────────────────────────────────────
//  Runtime state
// ─────────────────────────────────────────────────────────────────────────────
bool valveState                 = false;
uint32_t valveOpenedAtEpoch     = 0;

// Manual override state uses master epoch time
bool manualOverrideActive       = false;
bool manualOverrideDesiredState = false;
uint32_t manualOverrideExpiresAtEpoch = 0;

// Slave time state
bool timeSynced                 = false;
uint32_t lastKnownEpoch         = 0;      // epoch obtained from master
uint32_t lastEpochSyncMs        = 0;      // local millis when master time was fetched
uint32_t lastTimeSyncAttemptMs  = 0;

uint32_t lastSyncMs             = 0;
uint32_t nextSyncDelayMs        = SYNC_INTERVAL_MS;

// Sensor cache
struct SoilReading {
  int   adc;        // raw ADC value
  float percent;    // 0–100 %, -1 = fault
  bool  fault;
};

// =============================================================================
//  Utility helpers
// =============================================================================
float clampf(float v, float lo, float hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

void copyText(char* dest, size_t destSize, const char* src) {
  if (destSize == 0) return;
  strncpy(dest, src ? src : "", destSize - 1);
  dest[destSize - 1] = '\0';
}

void formatEpoch(uint32_t epoch, char* out, size_t outSize) {
  snprintf(out, outSize, "%lu", (unsigned long)epoch);
}

uint32_t currentEpoch() {
  if (timeSynced) {
    uint32_t elapsedSec = (millis() - lastEpochSyncMs) / 1000UL;
    return lastKnownEpoch + elapsedSec;
  }
  return millis() / 1000UL;
}

// =============================================================================
//  Acknowledgement queue helpers
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

  Serial.println("[ACK] Queue full – dropping acknowledgement.");
  return false;
}

// =============================================================================
//  Valve control
// =============================================================================
void setValve(bool open) {
  digitalWrite(VALVE_RELAY_PIN, RELAY_ACTIVE_LOW ? !open : open);

  if (open && !valveState) {
    valveOpenedAtEpoch = currentEpoch();
  }

  valveState = open;
  Serial.printf("[VALVE] %s\n", open ? "OPEN" : "CLOSED");
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
//  Time sync from master
// =============================================================================
bool syncTimeFromMaster() {
  if (WiFi.status() != WL_CONNECTED) return false;

  IPAddress masterIP = MDNS.queryHost(MASTER_HOSTNAME, 2000);
  if (masterIP == IPAddress(0, 0, 0, 0)) {
    Serial.println("[TIME] Master not found via mDNS.");
    return false;
  }

  WiFiClient client;
  HTTPClient http;

  String url = String("http://") + masterIP.toString() + MASTER_TIME_PATH;
  if (!http.begin(client, url)) {
    Serial.println("[TIME] HTTP begin failed.");
    return false;
  }

  http.setTimeout(5000);
  int code = http.GET();
  if (code != 200) {
    Serial.printf("[TIME] Failed to fetch master time. HTTP %d\n", code);
    http.end();
    return false;
  }

  String payload = http.getString();
  http.end();

  uint32_t epoch = payload.toInt();
  if (epoch < 1000000000UL) {
    Serial.println("[TIME] Invalid epoch received from master.");
    return false;
  }

  lastKnownEpoch = epoch;
  lastEpochSyncMs = millis();
  timeSynced = true;

  Serial.printf("[TIME] Synced from master: %lu\n", (unsigned long)epoch);
  return true;
}

void maintainTimeSync() {
  uint32_t nowMs = millis();
  if (!timeSynced || (nowMs - lastTimeSyncAttemptMs) >= TIME_SYNC_INTERVAL_MS) {
    lastTimeSyncAttemptMs = nowMs;
    syncTimeFromMaster();
  }
}

// =============================================================================
//  Soil sensor reading
// =============================================================================
int readSoilADC(uint8_t pin) {
  long total = 0;
  for (int i = 0; i < ADC_SAMPLES; i++) {
    total += analogRead(pin);
    delay(ADC_SAMPLE_DELAY_MS);
  }
  return (int)(total / ADC_SAMPLES);
}

float adcToPercent(int adc) {
  if (adc <= 0) return -1.0f;  // sensor disconnected / fault

  float pct = 100.0f * (float)(SOIL_ADC_DRY - adc) /
                        (float)(SOIL_ADC_DRY - SOIL_ADC_WET);
  return clampf(pct, 0.0f, 100.0f);
}

SoilReading readSensor(uint8_t pin) {
  SoilReading r;
  r.adc     = readSoilADC(pin);
  r.percent = adcToPercent(r.adc);
  r.fault   = (r.percent < 0.0f);
  return r;
}

// =============================================================================
//  Auto irrigation logic
// =============================================================================
void applyIrrigationControl(const SoilReading& s1, const SoilReading& s2) {
  uint32_t nowEpoch = currentEpoch();

  // Fail-safe: sensor fault
  if (s1.fault || s2.fault) {
    Serial.println("[AUTO] Sensor fault – closing valve (fail-safe).");
    setValve(false);
    cancelManualOverride();
    return;
  }

  float avg = (s1.percent + s2.percent) / 2.0f;

  // Flood guard: max open duration
  if (valveState) {
    uint32_t openDuration = nowEpoch - valveOpenedAtEpoch;
    if (openDuration >= MAX_VALVE_OPEN_MS / 1000UL) {
      Serial.println("[AUTO] Max open time reached – closing valve (flood guard).");
      setValve(false);
      cancelManualOverride();
      return;
    }
  }

  // Hard stop: soil saturated
  if (avg >= VALVE_CLOSE_THRESHOLD_PCT) {
    setValve(false);
    cancelManualOverride();
    return;
  }

  // Hard start: soil very dry
  if (avg <= VALVE_OPEN_THRESHOLD_PCT) {
    setValve(true);
    return;
  }

  // Middle zone: manual override wins
  if (manualOverrideValid(nowEpoch)) {
    setValve(manualOverrideDesiredState);
    return;
  }

  // Middle zone, no override: keep current state
}

// =============================================================================
//  Command processing
// =============================================================================
bool processPendingCommands(JsonArray commands, float avgMoisturePct) {
  if (commands.isNull()) return false;

  bool queued = false;
  uint32_t nowEpoch = currentEpoch();

  for (JsonObject cmd : commands) {
    const char* commandId   = cmd["commandId"]   | "";
    const char* channelKey  = cmd["channelKey"]   | "";
    const char* commandType = cmd["commandType"]  | "";

    if (commandId[0] == '\0') continue;
    if (ackQueuedFor(commandId)) continue;

    if (strcmp(channelKey, VALVE_CHANNEL_KEY) != 0) {
      queued |= queueAck(commandId, "failed", "Unsupported channel");
      continue;
    }

    if (strcmp(commandType, "set_state") != 0) {
      queued |= queueAck(commandId, "failed", "Unsupported command type");
      continue;
    }

    if (cmd["desiredBooleanState"].isNull()) {
      queued |= queueAck(commandId, "failed", "desiredBooleanState missing");
      continue;
    }

    bool desired = cmd["desiredBooleanState"].as<bool>();

    // Block manual open if soil is already saturated
    if (desired && avgMoisturePct >= VALVE_CLOSE_THRESHOLD_PCT) {
      queued |= queueAck(commandId, "failed", "Valve blocked: soil already saturated");
      continue;
    }

    // Default override is 60 seconds
    uint32_t overrideMs = MANUAL_OVERRIDE_MS;
    if (!cmd["overrideSeconds"].isNull()) {
      int s = cmd["overrideSeconds"].as<int>();
      if (s > 0) overrideMs = (uint32_t)s * 1000UL;
    } else if (!cmd["overrideMinutes"].isNull()) {
      int m = cmd["overrideMinutes"].as<int>();
      if (m > 0) overrideMs = (uint32_t)m * 60000UL;
    }

    manualOverrideActive = true;
    manualOverrideDesiredState = desired;
    manualOverrideExpiresAtEpoch = nowEpoch + (overrideMs / 1000UL);

    queued |= queueAck(commandId, "acknowledged", "Manual override active");

    Serial.printf("[CMD] %s → manual override %s for %lu s\n",
                  commandId, desired ? "OPEN" : "CLOSE",
                  (unsigned long)(overrideMs / 1000UL));
  }

  return queued;
}

// =============================================================================
//  WiFi
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
    Serial.printf("[WiFi] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
    return true;
  }

  Serial.println("[WiFi] Connection failed.");
  return false;
}

// =============================================================================
//  Main sync cycle
// =============================================================================
void syncDevice() {
  if (!connectWiFi()) {
    nextSyncDelayMs = FAILURE_RETRY_MS;
    return;
  }

  // Keep local clock aligned with master
  maintainTimeSync();

  // Read sensors
  SoilReading s1 = readSensor(SOIL_SENSOR1_PIN);
  SoilReading s2 = readSensor(SOIL_SENSOR2_PIN);

  float avgPct = (!s1.fault && !s2.fault)
                   ? (s1.percent + s2.percent) / 2.0f
                   : -1.0f;

  Serial.printf("[SENSOR] S1: %d adc / %.1f%%  |  S2: %d adc / %.1f%%  |  Avg: %.1f%%\n",
                s1.adc, s1.percent, s2.adc, s2.percent, avgPct);

  // Local safety control before reporting
  applyIrrigationControl(s1, s2);

  // Build request payload
  DynamicJsonDocument req(2048);
  req["firmwareVersion"] = FIRMWARE_VERSION;

  JsonObject clock = req.createNestedObject("clock");
  clock["timeSyncedFromMaster"] = timeSynced;
  clock["epoch"] = currentEpoch();

  JsonArray readings = req.createNestedArray("readings");

  // Sensor 1 → soil_zone_1
  JsonObject r1 = readings.createNestedObject();
  r1["channelKey"] = SOIL_ZONE1_KEY;
  if (!s1.fault) {
    r1["numericValue"] = (int)s1.percent;
    r1["rawValue"]     = s1.adc;
    r1["rawUnit"]      = "adc";
    r1["status"]       = "ok";
  } else {
    r1["status"]       = "fault";
  }

  // Sensor 2 → soil_moisture
  JsonObject r2 = readings.createNestedObject();
  r2["channelKey"] = SOIL_MOISTURE_KEY;
  if (!s2.fault) {
    r2["numericValue"] = (int)s2.percent;
    r2["rawValue"]     = s2.adc;
    r2["rawUnit"]      = "adc";
    r2["status"]       = "ok";
  } else {
    r2["status"]       = "fault";
  }

  // Valve
  JsonObject rv = readings.createNestedObject();
  rv["channelKey"]   = VALVE_CHANNEL_KEY;
  rv["booleanState"] = valveState;
  rv["numericValue"] = valveState ? 1 : 0;
  rv["status"]       = "ok";

  // Acknowledgements
  JsonArray acks = req.createNestedArray("acknowledgements");
  for (size_t i = 0; i < ACK_QUEUE_SIZE; i++) {
    if (!ackQueue[i].used) continue;
    JsonObject a = acks.createNestedObject();
    a["commandId"]    = ackQueue[i].commandId;
    a["status"]       = ackQueue[i].status;
    a["deviceMessage"] = ackQueue[i].message;
  }

  if (req.overflowed()) {
    Serial.println("[SYNC] JSON buffer overflow!");
    nextSyncDelayMs = FAILURE_RETRY_MS;
    return;
  }

  String body;
  serializeJson(req, body);

  // HTTP POST
  WiFiClientSecure secureClient;
  secureClient.setInsecure();

  HTTPClient http;
  if (!http.begin(secureClient, SERVER_URL)) {
    Serial.println("[SYNC] HTTPS begin failed.");
    nextSyncDelayMs = FAILURE_RETRY_MS;
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-id",  DEVICE_ID);
  http.addHeader("x-device-key", DEVICE_KEY);
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);

  Serial.println("─── Sync ───");
  Serial.println(body);

  int statusCode = http.POST(body);
  String response = (statusCode > 0) ? http.getString() : "";
  http.end();

  Serial.printf("[SYNC] HTTP %d\n", statusCode);
  if (response.length()) Serial.println(response);

  if (statusCode < 200 || statusCode >= 300) {
    Serial.println("[SYNC] Failed.");
    nextSyncDelayMs = FAILURE_RETRY_MS;
    return;
  }

  // Server accepted → clear sent acks
  clearAckQueue();

  // Parse response
  DynamicJsonDocument resp(8192);
  DeserializationError parseErr = deserializeJson(resp, response);
  if (parseErr) {
    Serial.printf("[SYNC] Parse error: %s\n", parseErr.c_str());
    nextSyncDelayMs = FAILURE_RETRY_MS;
    return;
  }

  JsonArray pendingCmds = resp["pendingCommands"].as<JsonArray>();
  processPendingCommands(pendingCmds, avgPct < 0 ? 0 : avgPct);

  // Re-apply control after command handling
  applyIrrigationControl(s1, s2);

  nextSyncDelayMs = SYNC_INTERVAL_MS;
  if (hasPendingAcks()) nextSyncDelayMs = 1000UL;

  Serial.printf("[SYNC] Next sync in %lu ms\n", (unsigned long)nextSyncDelayMs);
  Serial.println("────────────");
}

// =============================================================================
//  Arduino entry points
// =============================================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n=== GanSys Soil Irrigation Slave + Master Time Sync ===");

  // Configure analog input pins
  analogSetAttenuation(ADC_11db);
  pinMode(SOIL_SENSOR1_PIN, INPUT);
  pinMode(SOIL_SENSOR2_PIN, INPUT);

  pinMode(VALVE_RELAY_PIN, OUTPUT);

  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);

  clearAckQueue();
  setValve(false);   // Start with valve closed

  // Start mDNS stack for host lookup on the local network
  // Slave resolves rtc-master.local using the master hostname
  MDNS.begin("soil-slave");

  connectWiFi();
  maintainTimeSync();

  syncDevice();
  lastSyncMs = millis();
}

void loop() {
  uint32_t now = millis();

  if ((uint32_t)(now - lastTimeSyncAttemptMs) >= TIME_SYNC_INTERVAL_MS) {
    lastTimeSyncAttemptMs = now;
    syncTimeFromMaster();
  }

  if ((uint32_t)(now - lastSyncMs) >= nextSyncDelayMs) {
    lastSyncMs = now;
    syncDevice();
  }
}