// =============================================================================
//  Fish Tank Water Controller – ESP32  v2.0.2
//  ─────────────────────────────────────────────────────────────────────────────
//  Sensors  : TSW-20M turbidity (ADC1) · HC-SR04 ultrasonic tank level
//  Actuators: Inlet solenoid · Outlet solenoid · Spray pump
//  Cloud    : GAN Systems sync every 3 s · server-time scheduling (UTC+1)
//  Cleaning : inlet ON + outlet ON when water is dirty
//             outlet OFF if water gets too low (15 cm)
//             outlet ON again when water level rises back
//  Serial   : calibration + manual control via Serial Monitor
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
static const char* WIFI_SSID        = "Ikop";
static const char* WIFI_PASSWORD    = "maxy1234";
static const char* SERVER_URL       = "https://gansystems.vercel.app/api/device/sync";
static const char* DEVICE_ID        = "ESP32-FISH-TANK-PESTICIDE-";
static const char* DEVICE_KEY       = "iCO4fplm0G1coupS9IRYsFpMM_Bf-Eau";
static const char* FIRMWARE_VERSION = "2.0.2";

// Nigeria WAT = UTC+1
constexpr int32_t TZ_OFFSET_SEC = 3600;

// ─────────────────────────────────────────────────────────────────────────────
//  Channel keys
// ─────────────────────────────────────────────────────────────────────────────
static const char* CH_CLARITY   = "turbidity_fish";
static const char* CH_LEVEL     = "fish_tank_level";
static const char* CH_INLET     = "inlet_valve_fish";
static const char* CH_OUTLET    = "flush_valve_fish";
static const char* CH_PUMP      = "spray_pump";

// ─────────────────────────────────────────────────────────────────────────────
//  Hardware pins
// ─────────────────────────────────────────────────────────────────────────────
constexpr uint8_t PIN_TURBIDITY  = 34;
constexpr uint8_t PIN_TRIG       = 5;
constexpr uint8_t PIN_ECHO       = 18;
constexpr uint8_t PIN_INLET      = 26;
constexpr uint8_t PIN_OUTLET     = 27;
constexpr uint8_t PIN_PUMP       = 25;

// Flip per board if active-LOW relay
constexpr bool INLET_ACT_LOW  = false;
constexpr bool OUTLET_ACT_LOW = false;
constexpr bool PUMP_ACT_LOW   = false;

// ─────────────────────────────────────────────────────────────────────────────
//  Sensor parameters
// ─────────────────────────────────────────────────────────────────────────────
constexpr int     ADC_SAMPLES    = 15;   // must be odd for median
constexpr int     ADC_DELAY_MS    = 4;
constexpr int     US_SAMPLES      = 5;
constexpr uint32_t US_TIMEOUT_US  = 30000UL;

constexpr float TANK_EMPTY_CM = 22.0f;
constexpr float TANK_FULL_CM  = 8.0f;

// ─────────────────────────────────────────────────────────────────────────────
//  Default calibration
// ─────────────────────────────────────────────────────────────────────────────
constexpr int DEF_CLEAR_ADC = 3200;
constexpr int DEF_DIRTY_ADC = 1200;

// ─────────────────────────────────────────────────────────────────────────────
//  Thresholds
// ─────────────────────────────────────────────────────────────────────────────
constexpr float CLARITY_START_CLEAN  = 45.0f;
constexpr float CLARITY_STOP_CLEAN   = 75.0f;
constexpr float LEVEL_OPEN_INLET     = 70.0f;
constexpr float LEVEL_CLOSE_INLET    = 90.0f;

constexpr float CLEAN_CLOSE_OUTLET_CM  = 15.0f;
constexpr float CLEAN_REOPEN_OUTLET_CM = 14.0f;

// ─────────────────────────────────────────────────────────────────────────────
//  Timing (ms)
// ─────────────────────────────────────────────────────────────────────────────
constexpr uint32_t SYNC_MS          = 3000UL;
constexpr uint32_t SENSOR_MS        = 1000UL;
constexpr uint32_t SCHED_CHECK_MS   = 1000UL;
constexpr uint32_t HTTP_CONN_MS     = 8000UL;
constexpr uint32_t HTTP_RESP_MS     = 10000UL;
constexpr uint32_t RETRY_MS         = 3000UL;
constexpr uint32_t OVERRIDE_MS      = 60000UL;
constexpr uint32_t CLEANING_ON_MS   = 30000UL;
constexpr uint32_t SETTLE_MS        = 2000UL;
constexpr uint32_t WIFI_BACKOFF_CAP = 60000UL;

// ─────────────────────────────────────────────────────────────────────────────
//  Queue / storage sizes
// ─────────────────────────────────────────────────────────────────────────────
constexpr size_t ACK_Q_SIZE   = 8;
constexpr size_t MAX_SCHED    = 12;
constexpr size_t CMD_ID_LEN   = 48;
constexpr size_t ACK_STAT_LEN = 16;
constexpr size_t ACK_MSG_LEN  = 96;
constexpr size_t CH_KEY_LEN   = 32;
constexpr size_t NOTE_LEN     = 96;

// JSON buffer size (bytes)
#define REQ_JSON_CAP  3584
#define RESP_JSON_CAP 8192

// =============================================================================
//  Data types
// =============================================================================

struct AckItem {
  bool used;
  char commandId[CMD_ID_LEN];
  char status[ACK_STAT_LEN];
  char message[ACK_MSG_LEN];
};

struct ScheduledCmd {
  bool     active;
  char     commandId[CMD_ID_LEN];
  char     channelKey[CH_KEY_LEN];
  char     cmdType[16];
  bool     desiredBool;
  float    desiredNum;
  uint32_t scheduledEpoch;
  uint32_t overrideMs;
  char     note[NOTE_LEN];
};

struct ActuatorDef {
  const char* name;
  const char* channelKey;
  uint8_t     pin;
  bool        activeLow;
  bool        state;
  bool        ovActive;
  bool        ovDesired;
  uint32_t    ovExpiresEpoch;
};

enum class CleanState : uint8_t {
  IDLE,
  DRAINING,
  SETTLING,
};

struct WaterReading { int adc; float clarityPct; bool fault; };
struct TankReading  { float distanceCm; float levelPct; bool fault; };

// =============================================================================
//  Global state
// =============================================================================
static AckItem      ackQueue[ACK_Q_SIZE];
static ScheduledCmd scheduledCmds[MAX_SCHED];

enum ActIdx : uint8_t { ACT_INLET = 0, ACT_OUTLET, ACT_PUMP, ACT_COUNT };

static ActuatorDef actuators[ACT_COUNT] = {
  { "INLET",  CH_INLET,  PIN_INLET,  INLET_ACT_LOW,  false, false, false, 0 },
  { "OUTLET", CH_OUTLET, PIN_OUTLET, OUTLET_ACT_LOW, false, false, false, 0 },
  { "PUMP",   CH_PUMP,   PIN_PUMP,   PUMP_ACT_LOW,   false, false, false, 0 },
};

static Preferences prefs;

static bool     timeSynced      = false;
static uint32_t lastKnownEpoch   = 0;
static uint32_t lastEpochSyncMs  = 0;
static String   lastServerTimeRaw;

static uint32_t lastSyncMs        = 0;
static uint32_t nextSyncDelayMs   = SYNC_MS;
static uint32_t lastSensorMs      = 0;
static uint32_t lastSchedCheckMs  = 0;
static uint32_t lastWiFiAttemptMs = 0;
static uint32_t wifiBackoffMs     = 5000UL;
static bool     wifiWasConnected  = false;

static int  clearAdc        = DEF_CLEAR_ADC;
static int  dirtyAdc        = DEF_DIRTY_ADC;
static bool calLockedByUser = false;

static WaterReading cachedWater = { -1, -1.0f, true };
static TankReading  cachedTank  = { -1.0f, -1.0f, true };

static CleanState cleanState   = CleanState::IDLE;
static uint32_t   cleanPhaseMs = 0;

static String serialLine;

// =============================================================================
//  Forward declarations
// =============================================================================
static void printCalibration();
static void refreshSensorCache();
static uint32_t currentEpoch();
static void setActuator(ActIdx idx, bool on);
static void clearManualOverride(ActIdx idx);
static bool manualOverrideValid(ActIdx idx, uint32_t nowEpoch);
static void applyCleaningControl(const WaterReading& w, const TankReading& t);
static void applyTankLevelControl(const TankReading& t, uint32_t nowEpoch);
static void applyManualOverrides(uint32_t nowEpoch);
static bool processPendingCommands(JsonArray commands);
static void syncDevice();

// =============================================================================
//  Utility helpers
// =============================================================================
static float clampf(float v, float lo, float hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

static float round1(float v) { return roundf(v * 10.0f) / 10.0f; }

static void copyText(char* dst, size_t cap, const char* src) {
  if (!cap) return;
  strncpy(dst, src ? src : "", cap - 1);
  dst[cap - 1] = '\0';
}

static int64_t daysFromCivil(int y, unsigned m, unsigned d) {
  y -= (m <= 2);
  const int era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return (int64_t)era * 146097 + (int64_t)doe - 719468;
}

static void civilFromDays(int64_t z, int& y, unsigned& m, unsigned& d) {
  z += 719468;
  const int era = (int)((z >= 0 ? z : z - 146096) / 146097);
  const unsigned doe = (unsigned)(z - (int64_t)era * 146097);
  const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  y = (int)yoe + era * 400;
  const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const unsigned mp = (5 * doy + 2) / 153;
  d = doy - (153 * mp + 2) / 5 + 1;
  m = mp + (mp < 10 ? 3 : -9);
  y += (m <= 2);
}

static String epochToLocalIso(uint32_t epoch) {
  const uint32_t days = epoch / 86400UL;
  uint32_t rem = epoch % 86400UL;
  int y; unsigned mo, d;
  civilFromDays((int64_t)days, y, mo, d);
  char buf[24];
  snprintf(buf, sizeof(buf), "%04d-%02u-%02u %02u:%02u:%02u",
           y, mo, d, rem / 3600UL, (rem % 3600UL) / 60UL, rem % 60UL);
  return String(buf);
}

static bool parseIsoUtcEpoch(const String& s, uint32_t& out) {
  if (s.length() < 19) return false;
  int Y, M, D, h, m, sec;
  if (sscanf(s.c_str(), "%d-%d-%dT%d:%d:%d", &Y, &M, &D, &h, &m, &sec) != 6)
    return false;
  if (Y < 1970 || M < 1 || M > 12 || D < 1 || D > 31) return false;
  if (h < 0 || h > 23 || m < 0 || m > 59 || sec < 0 || sec > 60) return false;
  int64_t e = daysFromCivil(Y, (unsigned)M, (unsigned)D) * 86400LL
              + (int64_t)h * 3600LL + (int64_t)m * 60LL + sec;
  if (e <= 0 || e > (int64_t)0xFFFFFFFFLL) return false;
  out = (uint32_t)e;
  return true;
}

static bool parseIsoLocalEpoch(const String& s, uint32_t& out) {
  uint32_t utc = 0;
  if (!parseIsoUtcEpoch(s, utc)) return false;
  int64_t local = (int64_t)utc + TZ_OFFSET_SEC;
  if (local <= 0 || local > (int64_t)0xFFFFFFFFLL) return false;
  out = (uint32_t)local;
  return true;
}

static uint32_t currentEpoch() {
  if (timeSynced) {
    return lastKnownEpoch + (millis() - lastEpochSyncMs) / 1000UL;
  }
  return millis() / 1000UL + (uint32_t)TZ_OFFSET_SEC;
}

// =============================================================================
//  Calibration persistence
// =============================================================================
static void saveCalibration() {
  prefs.putInt("clear", clearAdc);
  prefs.putInt("dirty", dirtyAdc);
  prefs.putBool("locked", calLockedByUser);
}

static void loadCalibration() {
  prefs.begin("watercal", false);
  clearAdc        = prefs.getInt("clear", DEF_CLEAR_ADC);
  dirtyAdc        = prefs.getInt("dirty", DEF_DIRTY_ADC);
  calLockedByUser = prefs.getBool("locked", false);

  if (clearAdc <= 0 || dirtyAdc <= 0 || clearAdc == dirtyAdc) {
    clearAdc        = DEF_CLEAR_ADC;
    dirtyAdc        = DEF_DIRTY_ADC;
    calLockedByUser = false;
    saveCalibration();
  }
  if (clearAdc < dirtyAdc) { int t = clearAdc; clearAdc = dirtyAdc; dirtyAdc = t; }
}

static void lockUserCalibration() { calLockedByUser = true; saveCalibration(); }

static void resetCalibration() {
  clearAdc = DEF_CLEAR_ADC;
  dirtyAdc = DEF_DIRTY_ADC;
  calLockedByUser = false;
  saveCalibration();
  Serial.println("[CAL] Reset to defaults.");
  printCalibration();
}

static void printCalibration() {
  Serial.println();
  Serial.println("=== Calibration ===");
  Serial.printf("Clear ADC : %d\n", clearAdc);
  Serial.printf("Dirty ADC : %d\n", dirtyAdc);
  Serial.printf("Source    : %s\n", calLockedByUser ? "USER/NVS" : "SERVER/DEFAULT");
  Serial.println("Commands: show | clear | dirty | set clear N | set dirty N | reset | help");
  Serial.println("Actuators: inlet on/off | outlet on/off | pump on/off");
  Serial.println();
}

// =============================================================================
//  Sensor reading
// =============================================================================
static int readTurbidityADC() {
  int s[ADC_SAMPLES];
  for (int i = 0; i < ADC_SAMPLES; i++) {
    s[i] = analogRead(PIN_TURBIDITY);
    delay(ADC_DELAY_MS);
  }

  for (int i = 1; i < ADC_SAMPLES; i++) {
    int key = s[i], j = i - 1;
    while (j >= 0 && s[j] > key) { s[j + 1] = s[j]; j--; }
    s[j + 1] = key;
  }

  const int start = ADC_SAMPLES / 3;
  const int end   = ADC_SAMPLES - start;
  long total = 0;
  for (int i = start; i < end; i++) total += s[i];
  return (int)(total / (end - start));
}

static float adcToClarity(int adc) {
  if (clearAdc == dirtyAdc) return -1.0f;
  float pct = 100.0f * (float)(adc - dirtyAdc) / (float)(clearAdc - dirtyAdc);
  return round1(clampf(pct, 0.0f, 100.0f));
}

static WaterReading readWater() {
  WaterReading r;
  r.adc        = readTurbidityADC();
  r.clarityPct = adcToClarity(r.adc);
  r.fault      = (r.clarityPct < 0.0f);
  return r;
}

static float readUsSample() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(3);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  unsigned long dur = pulseIn(PIN_ECHO, HIGH, US_TIMEOUT_US);
  return (dur == 0) ? -1.0f : (dur * 0.0343f) / 2.0f;
}

static TankReading readTankLevel() {
  float total = 0.0f;
  int valid = 0;

  for (int i = 0; i < US_SAMPLES; i++) {
    float d = readUsSample();
    if (d > 0.0f && d < 500.0f) {
      total += d;
      valid++;
    }
    if (i < US_SAMPLES - 1) delay(20);
  }

  TankReading t;
  if (valid == 0) {
    t.distanceCm = -1;
    t.levelPct = -1;
    t.fault = true;
    return t;
  }

  t.distanceCm = total / valid;
  float pct = 100.0f * (TANK_EMPTY_CM - t.distanceCm) / (TANK_EMPTY_CM - TANK_FULL_CM);
  t.levelPct  = round1(clampf(pct, 0.0f, 100.0f));
  t.fault     = false;
  return t;
}

static void refreshSensorCache() {
  cachedWater  = readWater();
  cachedTank   = readTankLevel();
  lastSensorMs = millis();
}

// =============================================================================
//  Server calibration
// =============================================================================
static void applyServerCalibration(JsonArray cfg) {
  if (cfg.isNull() || calLockedByUser) {
    if (calLockedByUser) Serial.println("[CAL] User lock active; skipping server cal.");
    return;
  }

  for (JsonObject ch : cfg) {
    if (strcmp(ch["channelKey"] | "", CH_CLARITY) != 0) continue;
    JsonObject cal = ch["calibration"];
    if (cal.isNull()) return;

    int sC = cal["clearAdc"] | 0;
    int sD = cal["dirtyAdc"] | 0;
    if (sC > 0 && sD > 0 && sC != sD && (sC != clearAdc || sD != dirtyAdc)) {
      clearAdc = sC;
      dirtyAdc = sD;
      saveCalibration();
      Serial.printf("[CAL] Server update → Clear:%d  Dirty:%d\n", clearAdc, dirtyAdc);
    }
    return;
  }
}

// =============================================================================
//  Acknowledgement queue
// =============================================================================
static void clearAckQueue() {
  for (auto& a : ackQueue) {
    a.used = false;
    a.commandId[0] = '\0';
  }
}

static bool hasPendingAcks() {
  for (const auto& a : ackQueue) if (a.used) return true;
  return false;
}

static bool ackQueuedFor(const char* id) {
  if (!id || !id[0]) return false;
  for (const auto& a : ackQueue)
    if (a.used && strcmp(a.commandId, id) == 0) return true;
  return false;
}

static bool queueAck(const char* id, const char* status, const char* msg) {
  if (!id || !id[0]) return false;
  for (auto& a : ackQueue) {
    if (!a.used) {
      a.used = true;
      copyText(a.commandId, sizeof(a.commandId), id);
      copyText(a.status,    sizeof(a.status),    status);
      copyText(a.message,   sizeof(a.message),   msg);
      return true;
    }
  }
  Serial.println("[ACK] Queue full.");
  return false;
}

// =============================================================================
//  Scheduled command store
// =============================================================================
static void clearScheduledCmds() {
  for (auto& s : scheduledCmds) {
    s.active = false;
    s.commandId[0] = '\0';
  }
}

static bool isScheduledStored(const char* id) {
  if (!id || !id[0]) return false;
  for (const auto& s : scheduledCmds)
    if (s.active && strcmp(s.commandId, id) == 0) return true;
  return false;
}

static bool storeScheduledCmd(JsonObject cmd, uint32_t epoch, uint32_t ovrMs) {
  const char* id = cmd["commandId"] | "";
  if (!id[0] || isScheduledStored(id)) return true;

  for (auto& s : scheduledCmds) {
    if (!s.active) {
      s.active = true;
      copyText(s.commandId,  sizeof(s.commandId),  id);
      copyText(s.channelKey, sizeof(s.channelKey), cmd["channelKey"] | "");
      copyText(s.cmdType,    sizeof(s.cmdType),    cmd["commandType"] | "");
      copyText(s.note,       sizeof(s.note),       cmd["note"] | "");
      s.desiredBool    = cmd["desiredBooleanState"] | false;
      s.desiredNum     = cmd["desiredNumericValue"]  | 0.0f;
      s.scheduledEpoch = epoch;
      s.overrideMs     = ovrMs;
      Serial.printf("[SCHED] Stored %s → epoch %lu\n", id, (unsigned long)epoch);
      return true;
    }
  }
  Serial.println("[SCHED] Storage full.");
  return false;
}

static void removeScheduledCmd(size_t i) {
  if (i < MAX_SCHED) scheduledCmds[i].active = false;
}

static uint32_t parseOverrideMs(JsonObject cmd) {
  if (!cmd["overrideSeconds"].isNull()) {
    int s = cmd["overrideSeconds"].as<int>();
    if (s > 0) return (uint32_t)s * 1000UL;
  }
  if (!cmd["overrideMinutes"].isNull()) {
    int m = cmd["overrideMinutes"].as<int>();
    if (m > 0) return (uint32_t)m * 60000UL;
  }
  return OVERRIDE_MS;
}

static const char* getScheduledTimeStr(JsonObject cmd) {
  for (const char* key : {"scheduledFor", "executeAt", "runAt"}) {
    const char* v = cmd[key] | "";
    if (v[0]) return v;
  }
  return "";
}

// =============================================================================
//  Actuator control
// =============================================================================
static void setActuator(ActIdx idx, bool on) {
  ActuatorDef& a = actuators[idx];
  if (a.state == on) return;
  digitalWrite(a.pin, a.activeLow ? !on : on);
  a.state = on;
  Serial.printf("[%s] %s\n", a.name, on ? "ON/OPEN" : "OFF/CLOSED");
}

static void clearManualOverride(ActIdx idx) {
  auto& a = actuators[idx];
  a.ovActive = false;
  a.ovDesired = false;
  a.ovExpiresEpoch = 0;
}

static void clearAllOverrides() {
  for (uint8_t i = 0; i < ACT_COUNT; i++) clearManualOverride((ActIdx)i);
}

static bool manualOverrideValid(ActIdx idx, uint32_t nowEpoch) {
  auto& a = actuators[idx];
  if (!a.ovActive) return false;
  if ((int32_t)(nowEpoch - a.ovExpiresEpoch) >= 0) {
    clearManualOverride(idx);
    return false;
  }
  return true;
}

static ActIdx resolveActuator(const char* channelKey) {
  if (!channelKey) return ACT_COUNT;
  if (strcmp(channelKey, CH_INLET)  == 0) return ACT_INLET;
  if (strcmp(channelKey, CH_OUTLET) == 0) return ACT_OUTLET;
  if (strcmp(channelKey, CH_PUMP)    == 0) return ACT_PUMP;
  return ACT_COUNT;
}

static bool applyActuatorCmd(ActIdx idx, bool desired, const char* commandId,
                             uint32_t nowEpoch, uint32_t ovrMs, bool fromSched) {
  if (idx == ACT_INLET && desired) {
    if (cachedTank.fault || cachedTank.levelPct >= LEVEL_CLOSE_INLET) {
      return queueAck(commandId, "failed", "Inlet blocked: tank full or sensor fault");
    }
  }

  auto& a = actuators[idx];
  a.ovActive       = true;
  a.ovDesired      = desired;
  a.ovExpiresEpoch = nowEpoch + ovrMs / 1000UL;

  setActuator(idx, desired);
  return queueAck(commandId,
                  fromSched ? "executed" : "acknowledged",
                  fromSched ? "Scheduled command executed" : "Command accepted");
}

// =============================================================================
//  Clock sync from server response
// =============================================================================
static void syncClockFromServer(JsonDocument& resp) {
  if (resp["serverTime"].isNull()) return;
  lastServerTimeRaw = resp["serverTime"].as<String>();

  uint32_t epoch = 0;
  if (!parseIsoLocalEpoch(lastServerTimeRaw, epoch)) {
    Serial.printf("[TIME] Bad serverTime: %s\n", lastServerTimeRaw.c_str());
    return;
  }

  lastKnownEpoch  = epoch;
  lastEpochSyncMs = millis();
  timeSynced      = true;

  Serial.printf("[TIME] Synced %s  →  local %s\n",
                lastServerTimeRaw.c_str(), epochToLocalIso(epoch).c_str());
}

// =============================================================================
//  Cleaning state machine
// =============================================================================
static void stopCleaning() {
  cleanState = CleanState::IDLE;
  cleanPhaseMs = 0;
}

static void beginDraining() {
  clearAllOverrides();
  setActuator(ACT_INLET,  true);
  setActuator(ACT_OUTLET, true);
  cleanState   = CleanState::DRAINING;
  cleanPhaseMs = millis();
  Serial.println("[CLEAN] Draining: inlet ON + outlet ON");
}

static void beginSettling() {
  setActuator(ACT_OUTLET, false);
  setActuator(ACT_INLET,  false);
  cleanState   = CleanState::SETTLING;
  cleanPhaseMs = millis();
  Serial.println("[CLEAN] Settling: 2 s wait");
}

static void applyCleaningControl(const WaterReading& w, const TankReading& t) {
  uint32_t nowMs = millis();

  if (w.fault || t.fault) {
    setActuator(ACT_OUTLET, false);
    setActuator(ACT_INLET,  false);
    stopCleaning();
    clearAllOverrides();
    Serial.println("[CLEAN] Sensor fault – all off.");
    return;
  }

  switch (cleanState) {
    case CleanState::DRAINING: {
      setActuator(ACT_INLET, true);

      if (t.distanceCm >= CLEAN_CLOSE_OUTLET_CM) {
        if (actuators[ACT_OUTLET].state) {
          Serial.printf("[CLEAN] Water low (%.1f cm) -> outlet OFF\n", t.distanceCm);
        }
        setActuator(ACT_OUTLET, false);
      } else if (t.distanceCm <= CLEAN_REOPEN_OUTLET_CM) {
        setActuator(ACT_OUTLET, true);
      }

      if ((nowMs - cleanPhaseMs) >= CLEANING_ON_MS) {
        Serial.println("[CLEAN] Drain done -> settling");
        beginSettling();
      }
      break;
    }

    case CleanState::SETTLING:
      if ((nowMs - cleanPhaseMs) >= SETTLE_MS) {
        refreshSensorCache();

        if (cachedWater.fault) {
          Serial.println("[CLEAN] Fault after settle – stopping.");
          setActuator(ACT_OUTLET, false);
          setActuator(ACT_INLET,  false);
          stopCleaning();
          clearAllOverrides();
        } else if (cachedWater.clarityPct >= CLARITY_STOP_CLEAN) {
          Serial.printf("[CLEAN] Water clear (%.1f%%) – done.\n", cachedWater.clarityPct);
          stopCleaning();
          clearAllOverrides();
        } else {
          Serial.printf("[CLEAN] Still dirty (%.1f%%) – another cycle.\n", cachedWater.clarityPct);
          beginDraining();
        }
      }
      break;

    case CleanState::IDLE:
    default:
      setActuator(ACT_OUTLET, false);
      if (w.clarityPct <= CLARITY_START_CLEAN) {
        Serial.printf("[CLEAN] Dirty (%.1f%%) – starting cycle.\n", w.clarityPct);
        beginDraining();
      }
      break;
  }
}

// =============================================================================
//  Tank level control (inlet)
// =============================================================================
static void applyTankLevelControl(const TankReading& t, uint32_t nowEpoch) {
  if (cleanState != CleanState::IDLE) {
    return;
  }

  if (t.fault) {
    setActuator(ACT_INLET, false);
    clearManualOverride(ACT_INLET);
    return;
  }

  if (t.levelPct >= LEVEL_CLOSE_INLET) {
    setActuator(ACT_INLET, false);
    clearManualOverride(ACT_INLET);
    return;
  }

  if (manualOverrideValid(ACT_INLET, nowEpoch)) {
    bool open = actuators[ACT_INLET].ovDesired && (t.levelPct < LEVEL_CLOSE_INLET);
    setActuator(ACT_INLET, open);
    return;
  }

  if (t.levelPct <= LEVEL_OPEN_INLET) {
    setActuator(ACT_INLET, true);
  }
}

// =============================================================================
//  Manual override tick
// =============================================================================
static void applyManualOverrides(uint32_t nowEpoch) {
  if (cleanState == CleanState::IDLE) {
    if (manualOverrideValid(ACT_OUTLET, nowEpoch))
      setActuator(ACT_OUTLET, actuators[ACT_OUTLET].ovDesired);
  }

  if (manualOverrideValid(ACT_PUMP, nowEpoch))
    setActuator(ACT_PUMP, actuators[ACT_PUMP].ovDesired);
}

// =============================================================================
//  Scheduled command execution
// =============================================================================
static void checkAndExecuteScheduled(uint32_t nowEpoch) {
  for (size_t i = 0; i < MAX_SCHED; i++) {
    auto& sc = scheduledCmds[i];
    if (!sc.active || nowEpoch < sc.scheduledEpoch) continue;

    Serial.printf("[SCHED] Executing %s\n", sc.commandId);

    ActIdx idx = resolveActuator(sc.channelKey);
    if (idx == ACT_COUNT) {
      queueAck(sc.commandId, "failed", "Unsupported channel");
    } else {
      applyActuatorCmd(idx, sc.desiredBool, sc.commandId,
                       nowEpoch,
                       sc.overrideMs > 0 ? sc.overrideMs : OVERRIDE_MS,
                       true);
    }

    removeScheduledCmd(i);
  }
}

// =============================================================================
//  Dashboard command processing
// =============================================================================
static bool processPendingCommands(JsonArray cmds) {
  if (cmds.isNull()) return false;
  bool queued = false;
  uint32_t nowEp = currentEpoch();

  for (JsonObject cmd : cmds) {
    const char* id  = cmd["commandId"] | cmd["id"] | "";
    const char* ch  = cmd["channelKey"] | "";
    const char* ct  = cmd["commandType"] | "";

    if (!id[0] || ackQueuedFor(id)) continue;

    ActIdx idx = resolveActuator(ch);
    if (idx == ACT_COUNT) {
      queued |= queueAck(id, "failed", "Unsupported channel");
      continue;
    }
    if (strcmp(ct, "set_state") != 0) {
      queued |= queueAck(id, "failed", "Unsupported command type");
      continue;
    }
    if (cmd["desiredBooleanState"].isNull()) {
      queued |= queueAck(id, "failed", "desiredBooleanState missing");
      continue;
    }

    bool desired   = cmd["desiredBooleanState"].as<bool>();
    uint32_t ovrMs = parseOverrideMs(cmd);

    const char* schedStr = getScheduledTimeStr(cmd);
    if (schedStr[0]) {
      uint32_t schedEp = 0;
      if (!parseIsoLocalEpoch(String(schedStr), schedEp) || schedEp == 0) {
        queued |= queueAck(id, "failed", "Invalid scheduled time");
        continue;
      }
      if (schedEp > nowEp) {
        if (!storeScheduledCmd(cmd, schedEp, ovrMs))
          queued |= queueAck(id, "failed", "Scheduled storage full");
        continue;
      }
    }

    queued |= applyActuatorCmd(idx, desired, id, nowEp, ovrMs, false);
  }

  return queued;
}

// =============================================================================
//  Serial calibration / manual control
// =============================================================================
static void processSerialCommand(const String& input) {
  String cmd = input;
  cmd.trim();
  if (!cmd.length()) return;
  String lo = cmd;
  lo.toLowerCase();

  if (lo == "help") {
    printCalibration();
    return;
  }

  if (lo == "show") {
    WaterReading lw = readWater();
    TankReading  lt = readTankLevel();
    Serial.println("\n=== Status ===");
    Serial.printf("Turbidity ADC : %d\n",   lw.adc);
    Serial.printf("Clarity       : %.1f%%\n", lw.clarityPct);
    Serial.printf("Tank distance : %.1f cm\n", lt.distanceCm);
    Serial.printf("Tank level    : %.1f%%\n", lt.levelPct);
    for (uint8_t i = 0; i < ACT_COUNT; i++)
      Serial.printf("%-8s      : %s\n", actuators[i].name, actuators[i].state ? "ON/OPEN" : "OFF/CLOSED");
    Serial.printf("Clean state   : %s\n",
      cleanState == CleanState::DRAINING ? "DRAINING" :
      cleanState == CleanState::SETTLING  ? "SETTLING"  : "IDLE");
    Serial.printf("Time src      : %s  Epoch:%lu\n",
      timeSynced ? "serverTime" : "boot+tz", (unsigned long)currentEpoch());
    printCalibration();
    return;
  }

  if (lo == "clear") {
    int a = readTurbidityADC();
    if (a > 0) { clearAdc = a; lockUserCalibration();
      Serial.printf("[CAL] CLEAR → %d\n", clearAdc); printCalibration(); }
    else Serial.println("[CAL] Sensor read failed.");
    return;
  }

  if (lo == "dirty") {
    int a = readTurbidityADC();
    if (a > 0) { dirtyAdc = a; lockUserCalibration();
      Serial.printf("[CAL] DIRTY → %d\n", dirtyAdc); printCalibration(); }
    else Serial.println("[CAL] Sensor read failed.");
    return;
  }

  if (lo.startsWith("set clear ")) {
    int v = cmd.substring(10).toInt();
    if (v > 0) { clearAdc = v; lockUserCalibration(); Serial.printf("[CAL] Clear=%d\n", clearAdc); }
    else Serial.println("[CAL] Invalid.");
    return;
  }

  if (lo.startsWith("set dirty ")) {
    int v = cmd.substring(10).toInt();
    if (v > 0) { dirtyAdc = v; lockUserCalibration(); Serial.printf("[CAL] Dirty=%d\n", dirtyAdc); }
    else Serial.println("[CAL] Invalid.");
    return;
  }

  if (lo == "reset") {
    resetCalibration();
    return;
  }

  struct { const char* cmd; ActIdx idx; bool state; } acts[] = {
    {"inlet on",   ACT_INLET,  true},
    {"inlet off",  ACT_INLET,  false},
    {"outlet on",  ACT_OUTLET, true},
    {"outlet off", ACT_OUTLET, false},
    {"pump on",    ACT_PUMP,   true},
    {"pump off",   ACT_PUMP,   false},
  };

  for (auto& e : acts) {
    if (lo == e.cmd) {
      applyActuatorCmd(e.idx, e.state, "SERIAL", currentEpoch(), OVERRIDE_MS, false);
      return;
    }
  }

  Serial.println("[SERIAL] Unknown command. Type 'help'.");
}

static void handleSerialInput() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      if (serialLine.length()) {
        processSerialCommand(serialLine);
        serialLine = "";
      }
    } else if (serialLine.length() < 120) {
      serialLine += c;
    }
  }
}

// =============================================================================
//  WiFi – exponential back-off reconnect
// =============================================================================
static void startWiFiConnection() {
  if (WiFi.status() == WL_CONNECTED) return;

  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true, false);
  delay(100);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWiFiAttemptMs = millis();
  Serial.println("[WiFi] Connecting...");
}

static void maintainWiFi() {
  wl_status_t status = WiFi.status();

  if (status == WL_CONNECTED) {
    if (!wifiWasConnected) {
      wifiWasConnected = true;
      wifiBackoffMs    = 5000UL;
      Serial.printf("[WiFi] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
    }
    return;
  }

  if (wifiWasConnected) {
    wifiWasConnected = false;
    Serial.println("[WiFi] Disconnected.");
  }

  if ((millis() - lastWiFiAttemptMs) >= wifiBackoffMs) {
    Serial.printf("[WiFi] Retry (back-off %lu s)...\n", wifiBackoffMs / 1000UL);
    WiFi.disconnect(true, false);
    delay(100);
    startWiFiConnection();
    wifiBackoffMs = min(wifiBackoffMs * 2UL, WIFI_BACKOFF_CAP);
  }
}

// =============================================================================
//  Main sync cycle
// =============================================================================
static void syncDevice() {
  if (WiFi.status() != WL_CONNECTED) {
    nextSyncDelayMs = RETRY_MS;
    return;
  }

  if (cleanState == CleanState::IDLE) {
    if ((millis() - lastSensorMs) >= SENSOR_MS) refreshSensorCache();
  } else {
    cachedTank   = readTankLevel();
    cachedWater  = readWater();
    lastSensorMs = millis();
  }

  Serial.printf("[WATER] ADC:%d  Clarity:%.1f%%  (Clear:%d Dirty:%d)\n",
                cachedWater.adc, cachedWater.clarityPct, clearAdc, dirtyAdc);
  Serial.printf("[TANK]  %.1f cm  →  %.1f%%\n",
                cachedTank.distanceCm, cachedTank.levelPct);

  applyCleaningControl(cachedWater, cachedTank);
  uint32_t nowEp = currentEpoch();
  if (cleanState == CleanState::IDLE) {
    applyTankLevelControl(cachedTank, nowEp);
  }
  applyManualOverrides(nowEp);

  DynamicJsonDocument req(REQ_JSON_CAP);
  req["firmwareVersion"] = FIRMWARE_VERSION;

  JsonObject clk = req.createNestedObject("clock");
  clk["timeSyncedFromServer"] = timeSynced;
  clk["epoch"] = nowEp;
  clk["serverTimeRaw"] = lastServerTimeRaw;
  clk["localTime"] = epochToLocalIso(nowEp);

  JsonArray readings = req.createNestedArray("readings");

  auto addSensorReading = [&](const char* key, float val, float raw, const char* unit, bool fault) {
    JsonObject o = readings.createNestedObject();
    o["channelKey"] = key;
    if (!fault) {
      o["numericValue"] = val;
      o["rawValue"]     = raw;
      o["rawUnit"]      = unit;
      o["status"]       = "ok";
    } else {
      o["status"] = "fault";
    }
  };

  addSensorReading(CH_CLARITY, cachedWater.clarityPct, (float)cachedWater.adc, "adc", cachedWater.fault);
  addSensorReading(CH_LEVEL,   cachedTank.levelPct,    cachedTank.distanceCm,  "cm",  cachedTank.fault);

  for (uint8_t i = 0; i < ACT_COUNT; i++) {
    JsonObject o = readings.createNestedObject();
    o["channelKey"]   = actuators[i].channelKey;
    o["booleanState"]  = actuators[i].state;
    o["numericValue"]  = actuators[i].state ? 1 : 0;
    o["status"]       = "ok";
  }

  JsonArray acks = req.createNestedArray("acknowledgements");
  for (auto& a : ackQueue) {
    if (!a.used) continue;
    JsonObject o = acks.createNestedObject();
    o["commandId"]     = a.commandId;
    o["status"]        = a.status;
    o["deviceMessage"] = a.message;
  }

  if (req.overflowed()) {
    Serial.println("[SYNC] JSON buffer overflow!");
    nextSyncDelayMs = RETRY_MS;
    return;
  }

  String body;
  serializeJson(req, body);

  WiFiClientSecure sc;
  sc.setInsecure();

  HTTPClient http;
  if (!http.begin(sc, SERVER_URL)) {
    Serial.println("[SYNC] HTTPS begin failed.");
    nextSyncDelayMs = RETRY_MS;
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-id", DEVICE_ID);
  http.addHeader("x-device-key", DEVICE_KEY);
  http.setConnectTimeout(HTTP_CONN_MS);
  http.setTimeout(HTTP_RESP_MS);

  Serial.println("─── Sync ───");
  Serial.println(body);

  int code = http.POST(body);
  String response = (code > 0) ? http.getString() : "";
  http.end();

  Serial.printf("[SYNC] HTTP %d\n", code);
  if (response.length()) Serial.println(response);

  if (code < 200 || code >= 300) {
    Serial.println("[SYNC] Failed.");
    nextSyncDelayMs = RETRY_MS;
    return;
  }

  clearAckQueue();

  DynamicJsonDocument resp(RESP_JSON_CAP);
  if (deserializeJson(resp, response)) {
    Serial.println("[SYNC] JSON parse error.");
    nextSyncDelayMs = RETRY_MS;
    return;
  }

  syncClockFromServer(resp);
  applyServerCalibration(resp["channelConfig"].as<JsonArray>());
  processPendingCommands(resp["pendingCommands"].as<JsonArray>());

  JsonArray schedArr = resp["scheduledCommands"].as<JsonArray>();
  if (!schedArr.isNull()) {
    for (JsonObject cmd : schedArr) {
      const char* ts = getScheduledTimeStr(cmd);
      uint32_t ep = 0;
      if (ts[0] && parseIsoLocalEpoch(String(ts), ep) && ep > 0)
        storeScheduledCmd(cmd, ep, parseOverrideMs(cmd));
    }
  }

  checkAndExecuteScheduled(currentEpoch());

  nextSyncDelayMs = hasPendingAcks() ? 1000UL : SYNC_MS;
  Serial.printf("[SYNC] Next in %lu ms\n────────────\n", (unsigned long)nextSyncDelayMs);
}

// =============================================================================
//  Arduino entry points
// =============================================================================
void setup() {
  Serial.begin(115200);
  delay(400);
  Serial.println("\n=== GanSys Fish Tank Controller v2.0.2 ===");

  analogReadResolution(12);
  analogSetPinAttenuation(PIN_TURBIDITY, ADC_11db);
  pinMode(PIN_TURBIDITY, INPUT);
  pinMode(PIN_TRIG,   OUTPUT);
  pinMode(PIN_ECHO,   INPUT);
  pinMode(PIN_INLET,  OUTPUT);
  pinMode(PIN_OUTLET, OUTPUT);
  pinMode(PIN_PUMP,   OUTPUT);

  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);

  loadCalibration();
  clearAckQueue();
  clearScheduledCmds();

  for (uint8_t i = 0; i < ACT_COUNT; i++) setActuator((ActIdx)i, false);

  refreshSensorCache();
  printCalibration();

  startWiFiConnection();

  uint32_t wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - wifiStart) < 10000UL) {
    delay(100);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[SETUP] WiFi connected, performing initial sync...");
    syncDevice();
  }

  lastSyncMs = millis();
}

void loop() {
  handleSerialInput();
  maintainWiFi();

  uint32_t now = millis();
  uint32_t nowEp = currentEpoch();

  if ((now - lastSensorMs) >= SENSOR_MS) {
    if (cleanState == CleanState::IDLE) {
      refreshSensorCache();
    } else {
      cachedWater = readWater();
      cachedTank  = readTankLevel();
      lastSensorMs = now;
    }
  }

  applyCleaningControl(cachedWater, cachedTank);
  if (cleanState == CleanState::IDLE) {
    applyTankLevelControl(cachedTank, nowEp);
  }
  applyManualOverrides(nowEp);

  if (timeSynced && (now - lastSchedCheckMs) >= SCHED_CHECK_MS) {
    lastSchedCheckMs = now;
    checkAndExecuteScheduled(nowEp);
  }

  if ((now - lastSyncMs) >= nextSyncDelayMs) {
    lastSyncMs = now;
    syncDevice();
  }

  delay(5);
}