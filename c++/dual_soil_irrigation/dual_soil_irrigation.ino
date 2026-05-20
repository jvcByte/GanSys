// =============================================================================
//  Soil Irrigation Controller – ESP32 (Slave Time Client)
//  1× Capacitive Soil Sensor → 1× Solenoid Valve + 1× Spray Pump
//  Syncs to GAN Systems cloud API every 3 seconds
//  Uses cloud serverTime for scheduling
//  Calibration can be changed from Serial Monitor and saved in ESP32 memory
// =============================================================================

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <string.h>
#include <math.h>

// ─────────────────────────────────────────────────────────────────────────────
//  Network & API
// ─────────────────────────────────────────────────────────────────────────────
const char* WIFI_SSID        = "Ikop";
const char* WIFI_PASSWORD    = "maxy1234";

const char* SERVER_URL       = "https://gansystems.vercel.app/api/device/sync";
const char* DEVICE_ID        = "ESP32-SOIL-IRRIGATION";
const char* DEVICE_KEY       = "t-La6ONbo9xahSp1sczrZkQjw27yZwW2";
const char* FIRMWARE_VERSION = "1.0.0";

// Nigeria / WAT = UTC+1
constexpr int32_t SERVER_TIME_OFFSET_SEC = 3600;

// ─────────────────────────────────────────────────────────────────────────────
//  Channel keys
// ─────────────────────────────────────────────────────────────────────────────
const char* SOIL_CHANNEL_KEY   = "soil_zone_1";
const char* VALVE_CHANNEL_KEY  = "irrigation_valve_1";
const char* PUMP_CHANNEL_KEY   = "spray_pump";

// ─────────────────────────────────────────────────────────────────────────────
//  Hardware pins
// ─────────────────────────────────────────────────────────────────────────────
constexpr uint8_t SOIL_SENSOR_PIN      = 34;
constexpr uint8_t VALVE_RELAY_PIN      = 26;
constexpr uint8_t SPRAY_PUMP_RELAY_PIN = 27;

// Flip to true if your relay board uses active-LOW logic
constexpr bool RELAY_ACTIVE_LOW = false;

// ─────────────────────────────────────────────────────────────────────────────
//  Default sensor calibration
// ─────────────────────────────────────────────────────────────────────────────
constexpr int DEFAULT_SOIL_ADC_DRY = 2700;
constexpr int DEFAULT_SOIL_ADC_WET = 1200;

constexpr int ADC_SAMPLES          = 20;
constexpr int ADC_SAMPLE_DELAY_MS   = 10;

// ─────────────────────────────────────────────────────────────────────────────
//  Auto-irrigation thresholds
// ─────────────────────────────────────────────────────────────────────────────
constexpr float VALVE_OPEN_THRESHOLD_PCT  = 35.0f;
constexpr float VALVE_CLOSE_THRESHOLD_PCT  = 70.0f;

// ─────────────────────────────────────────────────────────────────────────────
//  Timing
// ─────────────────────────────────────────────────────────────────────────────
constexpr uint32_t SYNC_INTERVAL_MS           = 3000UL;
constexpr uint32_t SENSOR_READ_INTERVAL_MS    = 1000UL;
constexpr uint32_t SCHEDULE_CHECK_INTERVAL_MS  = 1000UL;
constexpr uint32_t MANUAL_OVERRIDE_MS          = 60000UL;
constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS    = 15000UL;
constexpr uint32_t HTTP_CONNECT_TIMEOUT_MS    = 8000UL;
constexpr uint32_t HTTP_TIMEOUT_MS            = 10000UL;
constexpr uint32_t FAILURE_RETRY_MS           = 3000UL;
constexpr uint32_t MAX_VALVE_OPEN_MS          = 300000UL;

// ─────────────────────────────────────────────────────────────────────────────
//  Acknowledgement queue
// ─────────────────────────────────────────────────────────────────────────────
constexpr size_t ACK_QUEUE_SIZE  = 8;
constexpr size_t COMMAND_ID_LEN   = 48;
constexpr size_t ACK_STATUS_LEN   = 16;
constexpr size_t ACK_MESSAGE_LEN  = 96;

struct AckItem {
  bool used;
  char commandId[COMMAND_ID_LEN];
  char status[ACK_STATUS_LEN];
  char message[ACK_MESSAGE_LEN];
};

AckItem ackQueue[ACK_QUEUE_SIZE];

// ─────────────────────────────────────────────────────────────────────────────
//  Scheduled commands storage
// ─────────────────────────────────────────────────────────────────────────────
constexpr size_t MAX_SCHEDULED_COMMANDS = 10;
constexpr size_t CHANNEL_KEY_LEN = 32;
constexpr size_t NOTE_LEN = 96;

struct ScheduledCommand {
  bool active;
  char commandId[COMMAND_ID_LEN];
  char channelKey[CHANNEL_KEY_LEN];
  char commandType[16];
  bool desiredBooleanState;
  float desiredNumericValue;
  uint32_t scheduledEpoch;
  char note[NOTE_LEN];
};

ScheduledCommand scheduledCommands[MAX_SCHEDULED_COMMANDS];

// ─────────────────────────────────────────────────────────────────────────────
//  Runtime state
// ─────────────────────────────────────────────────────────────────────────────
Preferences prefs;

bool valveState = false;
uint32_t valveOpenedAtEpoch = 0;

bool pumpState = false;

bool manualOverrideActive = false;
bool manualOverrideDesiredState = false;
uint32_t manualOverrideExpiresAtEpoch = 0;

bool timeSynced = false;
uint32_t lastKnownEpoch = 0;
uint32_t lastEpochSyncMs = 0;
String lastServerTimeRaw = "";

uint32_t lastSyncMs = 0;
uint32_t nextSyncDelayMs = SYNC_INTERVAL_MS;
uint32_t lastSensorReadMs = 0;
uint32_t lastScheduleCheckMs = 0;

int soilAdcDry = DEFAULT_SOIL_ADC_DRY;
int soilAdcWet = DEFAULT_SOIL_ADC_WET;
bool calibrationLockedByUser = false;

struct SoilReading {
  int adc;
  float percent;
  bool fault;
};

SoilReading cachedSensor = { -1, -1.0f, true };
String serialLine;

// =============================================================================
//  Utility helpers
// =============================================================================
float clampf(float v, float lo, float hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

float round1(float v) {
  return roundf(v * 10.0f) / 10.0f;
}

void copyText(char* dest, size_t destSize, const char* src) {
  if (destSize == 0) return;
  strncpy(dest, src ? src : "", destSize - 1);
  dest[destSize - 1] = '\0';
}

int64_t daysFromCivil(int y, unsigned m, unsigned d) {
  y -= (m <= 2);
  const int era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return (int64_t)era * 146097 + (int64_t)doe - 719468;
}

void civilFromDays(int64_t z, int& y, unsigned& m, unsigned& d) {
  z += 719468;
  const int era = (z >= 0 ? z : z - 146096) / 146097;
  const unsigned doe = (unsigned)(z - (int64_t)era * 146097);
  const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  y = (int)yoe + era * 400;
  const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const unsigned mp = (5 * doy + 2) / 153;
  d = doy - (153 * mp + 2) / 5 + 1;
  m = mp + (mp < 10 ? 3 : -9);
  y += (m <= 2);
}

String epochToIsoLike(uint32_t epoch) {
  uint32_t days = epoch / 86400UL;
  uint32_t rem = epoch % 86400UL;

  int year;
  unsigned month, day;
  civilFromDays((int64_t)days, year, month, day);

  uint32_t hh = rem / 3600UL;
  rem %= 3600UL;
  uint32_t mm = rem / 60UL;
  uint32_t ss = rem % 60UL;

  char buf[32];
  snprintf(buf, sizeof(buf), "%04d-%02u-%02u %02u:%02u:%02u",
           year, month, day, hh, mm, ss);
  return String(buf);
}

bool parseIsoToEpochWithOffset(const String& isoTime, uint32_t& epochOut) {
  String s = isoTime;
  s.trim();
  if (s.length() < 19) return false;

  int Y = 0, M = 0, D = 0, h = 0, m = 0, sec = 0;
  if (sscanf(s.c_str(), "%d-%d-%dT%d:%d:%d", &Y, &M, &D, &h, &m, &sec) != 6) {
    return false;
  }

  if (Y < 1970 || M < 1 || M > 12 || D < 1 || D > 31 ||
      h < 0 || h > 23 || m < 0 || m > 59 || sec < 0 || sec > 60) {
    return false;
  }

  int64_t days = daysFromCivil(Y, (unsigned)M, (unsigned)D);
  int64_t epoch =
      days * 86400LL +
      (int64_t)h * 3600LL +
      (int64_t)m * 60LL +
      (int64_t)sec;

  epoch += SERVER_TIME_OFFSET_SEC;

  if (epoch <= 0 || epoch > 0xFFFFFFFFLL) return false;

  epochOut = (uint32_t)epoch;
  return true;
}

uint32_t currentEpoch() {
  if (timeSynced) {
    uint32_t elapsedSec = (millis() - lastEpochSyncMs) / 1000UL;
    return lastKnownEpoch + elapsedSec;
  }
  return (millis() / 1000UL) + SERVER_TIME_OFFSET_SEC;
}

// =============================================================================
//  Calibration persistence
// =============================================================================
void printCalibration();

void saveCalibration() {
  prefs.putInt("dry", soilAdcDry);
  prefs.putInt("wet", soilAdcWet);
  prefs.putBool("locked", calibrationLockedByUser);
}

void loadCalibration() {
  prefs.begin("soilcal", false);

  soilAdcDry = prefs.getInt("dry", DEFAULT_SOIL_ADC_DRY);
  soilAdcWet = prefs.getInt("wet", DEFAULT_SOIL_ADC_WET);
  calibrationLockedByUser = prefs.getBool("locked", false);

  if (soilAdcDry <= 0 || soilAdcWet <= 0 || soilAdcDry == soilAdcWet) {
    soilAdcDry = DEFAULT_SOIL_ADC_DRY;
    soilAdcWet = DEFAULT_SOIL_ADC_WET;
    calibrationLockedByUser = false;
    saveCalibration();
  }

  if (soilAdcDry < soilAdcWet) {
    int tmp = soilAdcDry;
    soilAdcDry = soilAdcWet;
    soilAdcWet = tmp;
  }
}

void lockUserCalibration() {
  calibrationLockedByUser = true;
  saveCalibration();
}

void resetCalibration() {
  soilAdcDry = DEFAULT_SOIL_ADC_DRY;
  soilAdcWet = DEFAULT_SOIL_ADC_WET;
  calibrationLockedByUser = false;
  saveCalibration();

  Serial.println("[CAL] Calibration reset to defaults.");
  printCalibration();
}

void printCalibration() {
  Serial.println();
  Serial.println("=== Calibration ===");
  Serial.printf("Dry value : %d\n", soilAdcDry);
  Serial.printf("Wet value : %d\n", soilAdcWet);
  Serial.printf("Source    : %s\n", calibrationLockedByUser ? "USER / NVS" : "SERVER / DEFAULT");
  Serial.println("Commands:");
  Serial.println("  show         -> show current calibration and sensor reading");
  Serial.println("  dry          -> save current sensor reading as DRY");
  Serial.println("  wet          -> save current sensor reading as WET");
  Serial.println("  set dry 2800 -> manually set dry value");
  Serial.println("  set wet 1200 -> manually set wet value");
  Serial.println("  reset        -> restore default calibration and allow server updates");
  Serial.println("  help         -> show commands");
  Serial.println();
}

bool normalizeCalibration() {
  if (soilAdcDry <= 0 || soilAdcWet <= 0 || soilAdcDry == soilAdcWet) {
    return false;
  }

  if (soilAdcDry < soilAdcWet) {
    int tmp = soilAdcDry;
    soilAdcDry = soilAdcWet;
    soilAdcWet = tmp;
  }

  return true;
}

int readSoilADC() {
  long total = 0;
  for (int i = 0; i < ADC_SAMPLES; i++) {
    total += analogRead(SOIL_SENSOR_PIN);
    delay(ADC_SAMPLE_DELAY_MS);
    yield();
  }
  return (int)(total / ADC_SAMPLES);
}

float adcToPercent(int adc) {
  if (!normalizeCalibration()) return -1.0f;

  float pct = 100.0f * (float)(soilAdcDry - adc) /
              (float)(soilAdcDry - soilAdcWet);

  pct = clampf(pct, 0.0f, 100.0f);
  return round1(pct);
}

SoilReading readSensor() {
  SoilReading r;
  r.adc = readSoilADC();
  r.percent = adcToPercent(r.adc);
  r.fault = (r.percent < 0.0f);
  return r;
}

void refreshSensorCache() {
  cachedSensor = readSensor();
  lastSensorReadMs = millis();
}

// =============================================================================
//  Server calibration
// =============================================================================
void applyServerCalibration(JsonArray channelConfig) {
  if (channelConfig.isNull()) return;
  if (calibrationLockedByUser) {
    Serial.println("[CAL] User calibration locked; skipping server calibration.");
    return;
  }

  for (JsonObject ch : channelConfig) {
    const char* key = ch["channelKey"] | "";
    if (strcmp(key, SOIL_CHANNEL_KEY) != 0) continue;

    JsonObject cal = ch["calibration"];
    if (cal.isNull()) return;

    int serverDry = cal["dryAdc"] | 0;
    int serverWet = cal["wetAdc"] | 0;

    if (serverDry > 0 && serverWet > 0 && serverDry != serverWet) {
      bool changed = (serverDry != soilAdcDry || serverWet != soilAdcWet);
      if (changed) {
        soilAdcDry = serverDry;
        soilAdcWet = serverWet;
        normalizeCalibration();
        saveCalibration();
        Serial.printf("[CAL] Updated from server – Dry: %d  Wet: %d\n",
                      soilAdcDry, soilAdcWet);
      }
    }
    return;
  }
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
      copyText(ackQueue[i].status, sizeof(ackQueue[i].status), status);
      copyText(ackQueue[i].message, sizeof(ackQueue[i].message), message);
      return true;
    }
  }

  Serial.println("[ACK] Queue full – dropping acknowledgement.");
  return false;
}

// =============================================================================
//  Scheduled Commands Management
// =============================================================================
void clearScheduledCommands() {
  for (size_t i = 0; i < MAX_SCHEDULED_COMMANDS; i++) {
    scheduledCommands[i].active = false;
    scheduledCommands[i].commandId[0] = '\0';
    scheduledCommands[i].channelKey[0] = '\0';
    scheduledCommands[i].commandType[0] = '\0';
    scheduledCommands[i].desiredBooleanState = false;
    scheduledCommands[i].desiredNumericValue = 0.0f;
    scheduledCommands[i].scheduledEpoch = 0;
    scheduledCommands[i].note[0] = '\0';
  }
}

uint32_t parseScheduledTimeToEpoch(const char* isoTime) {
  if (isoTime == nullptr || strlen(isoTime) < 19) return 0;

  int year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0;
  if (sscanf(isoTime, "%d-%d-%dT%d:%d:%d",
             &year, &month, &day, &hour, &minute, &second) != 6) {
    return 0;
  }

  int64_t days = daysFromCivil(year, (unsigned)month, (unsigned)day);
  int64_t epoch =
      days * 86400LL +
      (int64_t)hour * 3600LL +
      (int64_t)minute * 60LL +
      (int64_t)second;

  epoch += SERVER_TIME_OFFSET_SEC;

  if (epoch <= 0 || epoch > 0xFFFFFFFFLL) return 0;
  return (uint32_t)epoch;
}

bool isScheduledCommandStored(const char* commandId) {
  if (commandId == nullptr || commandId[0] == '\0') return false;

  for (size_t i = 0; i < MAX_SCHEDULED_COMMANDS; i++) {
    if (scheduledCommands[i].active &&
        strcmp(scheduledCommands[i].commandId, commandId) == 0) {
      return true;
    }
  }
  return false;
}

bool commandHasScheduledTime(JsonObject cmd) {
  const char* s1 = cmd["scheduledFor"] | "";
  const char* s2 = cmd["executeAt"] | "";
  const char* s3 = cmd["runAt"] | "";
  return (s1[0] != '\0') || (s2[0] != '\0') || (s3[0] != '\0');
}

const char* getScheduledTimeField(JsonObject cmd) {
  const char* s1 = cmd["scheduledFor"] | "";
  if (s1[0] != '\0') return s1;
  const char* s2 = cmd["executeAt"] | "";
  if (s2[0] != '\0') return s2;
  const char* s3 = cmd["runAt"] | "";
  if (s3[0] != '\0') return s3;
  return "";
}

bool storeScheduledCommand(JsonObject cmd, uint32_t scheduledEpoch) {
  const char* commandId = cmd["commandId"] | "";
  const char* channelKey = cmd["channelKey"] | "";
  const char* commandType = cmd["commandType"] | "";
  const char* note = cmd["note"] | "";

  if (commandId[0] == '\0' || channelKey[0] == '\0' || commandType[0] == '\0') {
    Serial.println("[SCHED] Invalid scheduled command data.");
    return false;
  }

  if (isScheduledCommandStored(commandId)) {
    return true;
  }

  for (size_t i = 0; i < MAX_SCHEDULED_COMMANDS; i++) {
    if (!scheduledCommands[i].active) {
      scheduledCommands[i].active = true;
      copyText(scheduledCommands[i].commandId, sizeof(scheduledCommands[i].commandId), commandId);
      copyText(scheduledCommands[i].channelKey, sizeof(scheduledCommands[i].channelKey), channelKey);
      copyText(scheduledCommands[i].commandType, sizeof(scheduledCommands[i].commandType), commandType);
      copyText(scheduledCommands[i].note, sizeof(scheduledCommands[i].note), note);

      scheduledCommands[i].desiredBooleanState = cmd["desiredBooleanState"] | false;
      scheduledCommands[i].desiredNumericValue = cmd["desiredNumericValue"] | 0.0f;
      scheduledCommands[i].scheduledEpoch = scheduledEpoch;

      Serial.printf("[SCHED] Stored command %s for epoch %lu\n",
                    commandId, (unsigned long)scheduledEpoch);
      return true;
    }
  }

  Serial.println("[SCHED] Storage full; cannot store more scheduled commands.");
  return false;
}

void removeScheduledCommand(size_t index) {
  if (index >= MAX_SCHEDULED_COMMANDS) return;
  scheduledCommands[index].active = false;
}

int countActiveScheduledCommands() {
  int count = 0;
  for (size_t i = 0; i < MAX_SCHEDULED_COMMANDS; i++) {
    if (scheduledCommands[i].active) count++;
  }
  return count;
}

// =============================================================================
//  Actuators
// =============================================================================
void setValve(bool open) {
  digitalWrite(VALVE_RELAY_PIN, RELAY_ACTIVE_LOW ? !open : open);
  valveState = open;
  Serial.printf("[VALVE] %s\n", open ? "OPEN" : "CLOSED");
}

void setPump(bool on) {
  digitalWrite(SPRAY_PUMP_RELAY_PIN, RELAY_ACTIVE_LOW ? !on : on);
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

bool applyCommandToActuator(const char* channelKey,
                            bool desiredState,
                            const char* commandId,
                            float moisturePct,
                            uint32_t nowEpoch,
                            uint32_t overrideMs,
                            bool fromScheduled) {
  if (strcmp(channelKey, VALVE_CHANNEL_KEY) == 0) {
    if (desiredState && moisturePct >= VALVE_CLOSE_THRESHOLD_PCT) {
      queueAck(commandId, "failed", "Valve blocked: soil already saturated");
      return false;
    }

    manualOverrideActive = true;
    manualOverrideDesiredState = desiredState;
    manualOverrideExpiresAtEpoch = nowEpoch + (overrideMs / 1000UL);

    if (fromScheduled) {
      queueAck(commandId, "executed", "Scheduled valve command executed");
      Serial.printf("[SCHED] Valve %s\n", desiredState ? "OPEN" : "CLOSED");
    } else {
      queueAck(commandId, "acknowledged", "Valve command accepted");
      Serial.printf("[CMD] Valve %s for %lu s\n",
                    desiredState ? "OPEN" : "CLOSED",
                    (unsigned long)(overrideMs / 1000UL));
    }

    return true;
  }

  if (strcmp(channelKey, PUMP_CHANNEL_KEY) == 0) {
    setPump(desiredState);

    if (fromScheduled) {
      queueAck(commandId, "executed", "Scheduled pump command executed");
      Serial.printf("[SCHED] Pump %s\n", desiredState ? "ON" : "OFF");
    } else {
      queueAck(commandId, "acknowledged", "Pump command accepted");
      Serial.printf("[CMD] Pump %s\n", desiredState ? "ON" : "OFF");
    }

    return true;
  }

  queueAck(commandId, "failed", "Unsupported channel");
  return false;
}

// =============================================================================
//  Clock sync from serverTime
// =============================================================================
void syncClockFromServerTime(JsonDocument& resp) {
  if (resp["serverTime"].isNull()) return;

  lastServerTimeRaw = resp["serverTime"].as<String>();

  uint32_t epoch = 0;
  if (!parseIsoToEpochWithOffset(lastServerTimeRaw, epoch)) {
    Serial.println("[TIME] Invalid serverTime received.");
    Serial.println(lastServerTimeRaw);
    return;
  }

  lastKnownEpoch = epoch;
  lastEpochSyncMs = millis();
  timeSynced = true;

  Serial.println("========== TIME SYNC ==========");
  Serial.print("Raw UTC serverTime : ");
  Serial.println(lastServerTimeRaw);
  Serial.print("Corrected local    : ");
  Serial.println(epochToIsoLike(epoch));
  Serial.printf("Offset applied     : +%ld sec\n", (long)SERVER_TIME_OFFSET_SEC);
  Serial.println("================================");
}

// =============================================================================
//  Serial monitor calibration control
// =============================================================================
void processSerialCommand(const String& input) {
  String cmd = input;
  cmd.trim();
  if (cmd.length() == 0) return;

  String lower = cmd;
  lower.toLowerCase();

  SoilReading live = readSensor();

  if (lower == "help") {
    printCalibration();
    return;
  }

  if (lower == "show") {
    Serial.println();
    Serial.println("=== Current Status ===");
    Serial.printf("Raw ADC  : %d\n", live.adc);
    Serial.printf("Moisture : %.1f%%\n", live.percent);
    Serial.printf("Valve    : %s\n", valveState ? "OPEN" : "CLOSED");
    Serial.printf("Pump     : %s\n", pumpState ? "ON" : "OFF");
    Serial.printf("Time src : %s\n", timeSynced ? "serverTime" : "boot millis");
    Serial.printf("Epoch    : %lu\n", (unsigned long)currentEpoch());
    if (lastServerTimeRaw.length() > 0) {
      Serial.print("Last UTC : ");
      Serial.println(lastServerTimeRaw);
    }
    printCalibration();
    return;
  }

  if (lower == "dry") {
    if (live.adc > 0) {
      soilAdcDry = live.adc;
      normalizeCalibration();
      lockUserCalibration();
      Serial.printf("[CAL] Saved current reading %d as DRY.\n", soilAdcDry);
      printCalibration();
    } else {
      Serial.println("[CAL] Could not read sensor.");
    }
    return;
  }

  if (lower == "wet") {
    if (live.adc > 0) {
      soilAdcWet = live.adc;
      normalizeCalibration();
      lockUserCalibration();
      Serial.printf("[CAL] Saved current reading %d as WET.\n", soilAdcWet);
      printCalibration();
    } else {
      Serial.println("[CAL] Could not read sensor.");
    }
    return;
  }

  if (lower.startsWith("set dry ")) {
    int value = cmd.substring(8).toInt();
    if (value > 0) {
      soilAdcDry = value;
      normalizeCalibration();
      lockUserCalibration();
      Serial.printf("[CAL] Dry value set to %d.\n", soilAdcDry);
      printCalibration();
    } else {
      Serial.println("[CAL] Invalid dry value.");
    }
    return;
  }

  if (lower.startsWith("set wet ")) {
    int value = cmd.substring(8).toInt();
    if (value > 0) {
      soilAdcWet = value;
      normalizeCalibration();
      lockUserCalibration();
      Serial.printf("[CAL] Wet value set to %d.\n", soilAdcWet);
      printCalibration();
    } else {
      Serial.println("[CAL] Invalid wet value.");
    }
    return;
  }

  if (lower == "reset") {
    resetCalibration();
    return;
  }

  if (lower == "valve on") {
    setValve(true);
    return;
  }

  if (lower == "valve off") {
    setValve(false);
    return;
  }

  if (lower == "pump on") {
    setPump(true);
    return;
  }

  if (lower == "pump off") {
    setPump(false);
    return;
  }

  Serial.println("[SERIAL] Unknown command. Type 'help'.");
}

void handleSerialInput() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;

    if (c == '\n') {
      if (serialLine.length() > 0) {
        processSerialCommand(serialLine);
        serialLine = "";
      }
    } else {
      if (serialLine.length() < 120) {
        serialLine += c;
      }
    }
  }
}

// =============================================================================
//  Auto irrigation logic
// =============================================================================
void applyIrrigationControl(const SoilReading& s) {
  uint32_t nowEpoch = currentEpoch();

  if (s.fault) {
    Serial.println("[AUTO] Sensor fault – closing valve (fail-safe).");
    setValve(false);
    cancelManualOverride();
    return;
  }

  if (valveState) {
    uint32_t openDuration = nowEpoch - valveOpenedAtEpoch;
    if (openDuration >= MAX_VALVE_OPEN_MS / 1000UL) {
      Serial.println("[AUTO] Max open time reached – closing valve.");
      setValve(false);
      cancelManualOverride();
      return;
    }
  }

  if (s.percent >= VALVE_CLOSE_THRESHOLD_PCT) {
    setValve(false);
    cancelManualOverride();
    return;
  }

  if (s.percent <= VALVE_OPEN_THRESHOLD_PCT) {
    setValve(true);
    return;
  }

  if (manualOverrideValid(nowEpoch)) {
    setValve(manualOverrideDesiredState);
    return;
  }
}

// =============================================================================
//  Command processing from dashboard
// =============================================================================
bool processPendingCommands(JsonArray commands, float moisturePct) {
  if (commands.isNull()) return false;

  bool queued = false;
  uint32_t nowEpoch = currentEpoch();

  for (JsonObject cmd : commands) {
    const char* commandId  = cmd["commandId"] | "";
    const char* channelKey = cmd["channelKey"] | "";
    const char* commandType = cmd["commandType"] | "";

    if (commandId[0] == '\0') continue;
    if (ackQueuedFor(commandId)) continue;

    if (strcmp(channelKey, VALVE_CHANNEL_KEY) != 0 &&
        strcmp(channelKey, PUMP_CHANNEL_KEY) != 0) {
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

    uint32_t overrideMs = MANUAL_OVERRIDE_MS;
    if (!cmd["overrideSeconds"].isNull()) {
      int s = cmd["overrideSeconds"].as<int>();
      if (s > 0) overrideMs = (uint32_t)s * 1000UL;
    } else if (!cmd["overrideMinutes"].isNull()) {
      int m = cmd["overrideMinutes"].as<int>();
      if (m > 0) overrideMs = (uint32_t)m * 60000UL;
    }

    uint32_t scheduledEpoch = 0;
    bool hasSchedule = false;

    if (commandHasScheduledTime(cmd)) {
      const char* scheduledFor = getScheduledTimeField(cmd);
      scheduledEpoch = parseScheduledTimeToEpoch(scheduledFor);
      hasSchedule = (scheduledEpoch > 0);

      if (!hasSchedule) {
        queued |= queueAck(commandId, "failed", "Invalid scheduled time");
        continue;
      }

      if (scheduledEpoch > nowEpoch) {
        if (storeScheduledCommand(cmd, scheduledEpoch)) {
          Serial.printf("[SCHED] Stored future command %s for %lu\n",
                        commandId, (unsigned long)scheduledEpoch);
        }
        continue;
      }
    }

    if (!applyCommandToActuator(channelKey, desired, commandId, moisturePct, nowEpoch, overrideMs, false)) {
      queued = true;
      continue;
    }

    queued = true;
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
    yield();
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

  refreshSensorCache();

  Serial.printf("[SENSOR] ADC: %d  |  Moisture: %.1f%%  |  Dry:%d Wet:%d\n",
                cachedSensor.adc, cachedSensor.percent, soilAdcDry, soilAdcWet);

  applyIrrigationControl(cachedSensor);

  DynamicJsonDocument req(3072);
  req["firmwareVersion"] = FIRMWARE_VERSION;

  JsonObject clock = req.createNestedObject("clock");
  clock["timeSyncedFromServer"] = timeSynced;
  clock["epoch"] = currentEpoch();

  JsonArray readings = req.createNestedArray("readings");

  JsonObject soil = readings.createNestedObject();
  soil["channelKey"] = SOIL_CHANNEL_KEY;
  if (!cachedSensor.fault) {
    soil["numericValue"] = round1(cachedSensor.percent);
    soil["rawValue"]     = cachedSensor.adc;
    soil["rawUnit"]      = "adc";
    soil["status"]       = "ok";
  } else {
    soil["status"] = "fault";
  }

  JsonObject valve = readings.createNestedObject();
  valve["channelKey"]   = VALVE_CHANNEL_KEY;
  valve["booleanState"] = valveState;
  valve["numericValue"] = valveState ? 1 : 0;
  valve["status"]       = "ok";

  JsonObject pump = readings.createNestedObject();
  pump["channelKey"]   = PUMP_CHANNEL_KEY;
  pump["booleanState"] = pumpState;
  pump["numericValue"] = pumpState ? 1 : 0;
  pump["status"]       = "ok";

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

  clearAckQueue();

  DynamicJsonDocument resp(8192);
  DeserializationError parseErr = deserializeJson(resp, response);
  if (parseErr) {
    Serial.printf("[SYNC] Parse error: %s\n", parseErr.c_str());
    nextSyncDelayMs = FAILURE_RETRY_MS;
    return;
  }

  syncClockFromServerTime(resp);

  JsonArray channelConfig = resp["channelConfig"].as<JsonArray>();
  applyServerCalibration(channelConfig);

  JsonArray pendingCmds = resp["pendingCommands"].as<JsonArray>();
  processPendingCommands(pendingCmds, cachedSensor.fault ? 0 : cachedSensor.percent);

  JsonArray scheduledArray = resp["scheduledCommands"].as<JsonArray>();
  if (!scheduledArray.isNull()) {
    for (JsonObject cmd : scheduledArray) {
      const char* s = getScheduledTimeField(cmd);
      uint32_t scheduledEpoch = parseScheduledTimeToEpoch(s);
      if (scheduledEpoch > 0) {
        storeScheduledCommand(cmd, scheduledEpoch);
      }
    }
  }

  JsonArray pestArray = resp["pestControlSchedule"].as<JsonArray>();
  if (!pestArray.isNull()) {
    for (JsonObject cmd : pestArray) {
      const char* s = getScheduledTimeField(cmd);
      uint32_t scheduledEpoch = parseScheduledTimeToEpoch(s);
      if (scheduledEpoch > 0) {
        storeScheduledCommand(cmd, scheduledEpoch);
      }
    }
  }

  checkAndExecuteScheduledCommands(currentEpoch(), cachedSensor.fault ? 0 : cachedSensor.percent);
  applyIrrigationControl(cachedSensor);

  nextSyncDelayMs = SYNC_INTERVAL_MS;
  if (hasPendingAcks()) nextSyncDelayMs = 1000UL;

  Serial.printf("[SYNC] Next sync in %lu ms\n", (unsigned long)nextSyncDelayMs);
  Serial.println("────────────");
}

// =============================================================================
//  Scheduled command execution
// =============================================================================
void checkAndExecuteScheduledCommands(uint32_t nowEpoch, float moisturePct) {
  for (size_t i = 0; i < MAX_SCHEDULED_COMMANDS; i++) {
    if (!scheduledCommands[i].active) continue;

    if (nowEpoch < scheduledCommands[i].scheduledEpoch) continue;

    Serial.printf("[SCHED] Executing scheduled command: %s\n",
                  scheduledCommands[i].commandId);

    bool desiredState = scheduledCommands[i].desiredBooleanState;
    const char* channelKey = scheduledCommands[i].channelKey;

    if (strcmp(channelKey, VALVE_CHANNEL_KEY) == 0) {
      if (desiredState && moisturePct >= VALVE_CLOSE_THRESHOLD_PCT) {
        Serial.printf("[SCHED] Blocked: Soil already saturated (%.1f%%)\n", moisturePct);
        queueAck(scheduledCommands[i].commandId,
                 "failed",
                 "Valve blocked: soil already saturated");
      } else {
        manualOverrideActive = true;
        manualOverrideDesiredState = desiredState;
        manualOverrideExpiresAtEpoch = nowEpoch + (MANUAL_OVERRIDE_MS / 1000UL);

        Serial.printf("[SCHED] Valve set to %s for %lu seconds\n",
                      desiredState ? "OPEN" : "CLOSE",
                      (unsigned long)(MANUAL_OVERRIDE_MS / 1000UL));

        queueAck(scheduledCommands[i].commandId,
                 "executed",
                 "Scheduled valve command executed by ESP32");
      }
    } else if (strcmp(channelKey, PUMP_CHANNEL_KEY) == 0) {
      setPump(desiredState);
      queueAck(scheduledCommands[i].commandId,
               "executed",
               "Scheduled pump command executed by ESP32");

      Serial.printf("[SCHED] Pump %s\n", desiredState ? "ON" : "OFF");
    } else {
      Serial.printf("[SCHED] Unsupported channel: %s\n", scheduledCommands[i].channelKey);
      queueAck(scheduledCommands[i].commandId,
               "failed",
               "Unsupported channel");
    }

    removeScheduledCommand(i);
  }
}

// =============================================================================
//  Arduino entry points
// =============================================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n=== GanSys Soil Irrigation Slave + Server Time Sync ===");

  analogReadResolution(12);
  analogSetPinAttenuation(SOIL_SENSOR_PIN, ADC_11db);
  pinMode(SOIL_SENSOR_PIN, INPUT);

  pinMode(VALVE_RELAY_PIN, OUTPUT);
  pinMode(SPRAY_PUMP_RELAY_PIN, OUTPUT);

  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);

  loadCalibration();

  clearAckQueue();
  clearScheduledCommands();

  setValve(false);
  setPump(false);

  refreshSensorCache();
  printCalibration();

  connectWiFi();
  syncDevice();
  lastSyncMs = millis();
}

void loop() {
  handleSerialInput();

  uint32_t now = millis();

  if ((uint32_t)(now - lastSensorReadMs) >= SENSOR_READ_INTERVAL_MS) {
    refreshSensorCache();
    applyIrrigationControl(cachedSensor);
  }

  if ((uint32_t)(now - lastScheduleCheckMs) >= SCHEDULE_CHECK_INTERVAL_MS) {
    lastScheduleCheckMs = now;
    if (timeSynced) {
      checkAndExecuteScheduledCommands(currentEpoch(),
                                       cachedSensor.fault ? 0.0f : cachedSensor.percent);
    }
  }

  if ((uint32_t)(now - lastSyncMs) >= nextSyncDelayMs) {
    lastSyncMs = now;
    syncDevice();
  }

  delay(5);
}