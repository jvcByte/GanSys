/*
 * GanSys - Dual Soil Moisture Sensor with Automated Irrigation
 *
 * Hardware:
 *   - 2x Capacitive Soil Moisture Sensors (Analog)
 *   - 1x Relay Module (Solenoid Valve)
 *   - ESP32 Development Board
 *
 * Pin Config:
 *   - Soil Sensor 1 : GPIO 34 (ADC1_CH6)
 *   - Soil Sensor 2 : GPIO 35 (ADC1_CH7)
 *   - Relay (Valve) : GPIO 26
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>

// ============================================================================
// CONFIGURATION
// ============================================================================

// WiFi
const char* WIFI_SSID        = "Ikop";
const char* WIFI_PASSWORD    = "maxy1234";

// API
const char* API_ENDPOINT     = "https://gansystems.vercel.app/api/device/sync";
const char* DEVICE_ID        = "ESP32-DUAL-SOIL-01";
const char* DEVICE_KEY       = "YOUR-DEVICE-KEY-HERE";

// Pins
const uint8_t SOIL_PIN_1     = 34;
const uint8_t SOIL_PIN_2     = 35;
const uint8_t RELAY_PIN      = 26;

// Channel keys
const char* CH_SOIL_1        = "soil_moisture_1";
const char* CH_SOIL_2        = "soil_moisture_2";
const char* CH_VALVE         = "irrigation_valve";

// Calibration  (dry air = high ADC, water = low ADC)
const int    SOIL_DRY        = 3000;
const int    SOIL_WET        = 1200;

// Thresholds
const int    THRESHOLD_OPEN  = 35;   // Open valve if moisture below this
const int    THRESHOLD_CLOSE = 60;   // Close valve when BOTH sensors above this

// Intervals (ms)
const unsigned long SYNC_INTERVAL   = 30000UL;
const unsigned long READ_INTERVAL   = 5000UL;
const unsigned long WDT_TIMEOUT_S   = 60;     // Watchdog timeout in seconds

// ADC samples per reading
const int ADC_SAMPLES = 10;

// ============================================================================
// GLOBALS
// ============================================================================

unsigned long lastSyncTime       = 0;
unsigned long lastReadTime       = 0;

int  soil1Pct                    = 0;
int  soil2Pct                    = 0;
bool valveOpen                   = false;
bool manualOverride              = false;
unsigned long overrideExpiry     = 0;

// Pending ack queue (max 5 commands between syncs)
struct PendingAck {
  char id[64];
  char status[16];
};
PendingAck ackQueue[5];
int ackCount = 0;

// ============================================================================
// UTILITIES
// ============================================================================

int readADCAverage(uint8_t pin) {
  long total = 0;
  for (int i = 0; i < ADC_SAMPLES; i++) {
    total += analogRead(pin);
    delay(10);
  }
  return (int)(total / ADC_SAMPLES);
}

int rawToPercent(int raw) {
  // Capacitive: dry=high ADC, wet=low ADC -> invert mapping
  raw = constrain(raw, SOIL_WET, SOIL_DRY);
  return (int)((float)(SOIL_DRY - raw) / (SOIL_DRY - SOIL_WET) * 100.0f);
}

// ============================================================================
// VALVE CONTROL
// ============================================================================

void openValve() {
  if (!valveOpen) {
    digitalWrite(RELAY_PIN, HIGH);
    valveOpen = true;
    Serial.println("[VALVE] Opened");
  }
}

void closeValve() {
  if (valveOpen) {
    digitalWrite(RELAY_PIN, LOW);
    valveOpen = false;
    Serial.println("[VALVE] Closed");
  }
}

// ============================================================================
// SENSOR READING
// ============================================================================

void readSensors() {
  soil1Pct = rawToPercent(readADCAverage(SOIL_PIN_1));
  soil2Pct = rawToPercent(readADCAverage(SOIL_PIN_2));
}

// ============================================================================
// IRRIGATION LOGIC
// ============================================================================

void runIrrigationLogic() {
  if (manualOverride) {
    if (millis() >= overrideExpiry) {
      manualOverride = false;
      Serial.println("[AUTO] Manual override expired. Resuming automatic control.");
    } else {
      return; // Skip automatic control while override is active
    }
  }

  bool anyDry   = (soil1Pct < THRESHOLD_OPEN  || soil2Pct < THRESHOLD_OPEN);
  bool bothMoist = (soil1Pct >= THRESHOLD_CLOSE && soil2Pct >= THRESHOLD_CLOSE);

  if (anyDry)       openValve();
  else if (bothMoist) closeValve();
}

// ============================================================================
// WIFI
// ============================================================================

bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  Serial.print("[WiFi] Connecting");
  WiFi.disconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  for (int i = 0; i < 20; i++) {
    if (WiFi.status() == WL_CONNECTED) break;
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WiFi] Connected. IP: ");
    Serial.println(WiFi.localIP());
    return true;
  }

  Serial.println("[WiFi] Connection failed. Running offline.");
  return false;
}

// ============================================================================
// COMMAND PROCESSING
// ============================================================================

void processCommands(JsonArray commands) {
  for (JsonObject cmd : commands) {
    const char* cmdId      = cmd["id"]   | "";
    const char* channelKey = cmd["channelKey"] | "";

    if (strcmp(channelKey, CH_VALVE) == 0) {
      bool desired       = cmd["desiredBooleanState"] | false;
      int  overrideMins  = cmd["overrideMinutes"]     | 0;

      Serial.printf("[CMD] Valve -> %s\n", desired ? "OPEN" : "CLOSE");
      desired ? openValve() : closeValve();

      if (overrideMins > 0) {
        manualOverride = true;
        overrideExpiry = millis() + (unsigned long)overrideMins * 60000UL;
        Serial.printf("[CMD] Manual override: %d min\n", overrideMins);
      }

      // Queue acknowledgement
      if (ackCount < 5 && strlen(cmdId) > 0) {
        strncpy(ackQueue[ackCount].id,     cmdId,    sizeof(ackQueue[ackCount].id)     - 1);
        strncpy(ackQueue[ackCount].status, "executed", sizeof(ackQueue[ackCount].status) - 1);
        ackCount++;
      }
    }
  }
}

// ============================================================================
// DASHBOARD SYNC
// ============================================================================

void syncWithDashboard() {
  if (!connectWiFi()) return;

  HTTPClient http;
  http.begin(API_ENDPOINT);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-id",  DEVICE_ID);
  http.addHeader("x-device-key", DEVICE_KEY);
  http.setTimeout(10000); // 10s timeout

  // Build payload
  StaticJsonDocument<1024> doc;
  doc["firmwareVersion"] = "1.1.0";

  JsonArray readings = doc.createNestedArray("readings");

  // Soil 1
  JsonObject s1 = readings.createNestedObject();
  s1["channelKey"]   = CH_SOIL_1;
  s1["numericValue"] = soil1Pct;
  s1["status"]       = "ok";

  // Soil 2
  JsonObject s2 = readings.createNestedObject();
  s2["channelKey"]   = CH_SOIL_2;
  s2["numericValue"] = soil2Pct;
  s2["status"]       = "ok";

  // Valve
  JsonObject v = readings.createNestedObject();
  v["channelKey"]   = CH_VALVE;
  v["booleanState"] = valveOpen;
  v["numericValue"] = valveOpen ? 1 : 0;
  v["status"]       = "ok";

  // Bundle any pending acks
  JsonArray acks = doc.createNestedArray("acknowledgements");
  for (int i = 0; i < ackCount; i++) {
    JsonObject ack = acks.createNestedObject();
    ack["commandId"]  = ackQueue[i].id;
    ack["status"]     = ackQueue[i].status;
    ack["executedAt"] = millis();
  }
  ackCount = 0; // Clear queue after bundling

  String payload;
  serializeJson(doc, payload);

  Serial.println("[SYNC] Sending data...");
  int code = http.POST(payload);

  if (code == 200) {
    Serial.printf("[SYNC] OK (%d)\n", code);
    String response = http.getString();

    StaticJsonDocument<2048> resDoc;
    if (!deserializeJson(resDoc, response)) {
      JsonArray commands = resDoc["pendingCommands"];
      if (commands.size() > 0) {
        Serial.printf("[SYNC] %d command(s) received\n", (int)commands.size());
        processCommands(commands);
      }
    }
  } else {
    Serial.printf("[SYNC] Failed. HTTP code: %d\n", code);
  }

  http.end();
}

// ============================================================================
// STATUS PRINT
// ============================================================================

void printStatus() {
  Serial.println("--- Status ---");
  Serial.printf("  Soil 1  : %d%%\n", soil1Pct);
  Serial.printf("  Soil 2  : %d%%\n", soil2Pct);
  Serial.printf("  Valve   : %s\n",   valveOpen ? "OPEN" : "CLOSED");
  Serial.printf("  Mode    : %s\n",   manualOverride ? "MANUAL" : "AUTO");
  if (manualOverride) {
    Serial.printf("  Expires : %lu s\n", (overrideExpiry - millis()) / 1000UL);
  }
  Serial.println("--------------");
}

// ============================================================================
// SETUP
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n=== GanSys Dual Soil Irrigation ===");

  // Watchdog: reset ESP32 if it hangs for >60s
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
  esp_task_wdt_add(NULL);

  // Pins
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW); // Valve closed on boot

  // ADC (set per-pin attenuation - correct ESP32 method)
  analogReadResolution(12);
  analogSetPinAttenuation(SOIL_PIN_1, ADC_11db);
  analogSetPinAttenuation(SOIL_PIN_2, ADC_11db);

  connectWiFi();

  Serial.println("System ready.\n");
}

// ============================================================================
// LOOP
// ============================================================================

void loop() {
  esp_task_wdt_reset(); // Feed watchdog

  unsigned long now = millis();

  // Read sensors and run irrigation logic
  if (now - lastReadTime >= READ_INTERVAL) {
    lastReadTime = now;
    readSensors();
    runIrrigationLogic();
    printStatus();
  }

  // Sync with dashboard
  if (now - lastSyncTime >= SYNC_INTERVAL) {
    lastSyncTime = now;
    syncWithDashboard();
  }

  delay(100);
}