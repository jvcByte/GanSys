/*
 * GanSys - Dual Soil Moisture Sensor with Automated Irrigation
 * 
 * Hardware Setup:
 * - 2x Capacitive Soil Moisture Sensors (Analog)
 * - 1x Relay Module (for Solenoid Valve)
 * - ESP32 Development Board
 * 
 * Pin Configuration:
 * - Soil Sensor 1: GPIO 34 (ADC1_CH6)
 * - Soil Sensor 2: GPIO 35 (ADC1_CH7)
 * - Relay (Valve): GPIO 26
 * 
 * Logic:
 * - If ANY sensor reads below threshold (dry soil), open valve
 * - Valve stays open until BOTH sensors are above threshold (moist)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ============================================================================
// CONFIGURATION - Update these values for your setup
// ============================================================================

// WiFi Credentials
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// GanSys Dashboard API
const char* API_ENDPOINT = "https://your-domain.com/api/device/sync";
const char* DEVICE_ID = "ESP32-DUAL-SOIL-01";  // Match your controller's hardwareId
const char* DEVICE_KEY = "YOUR-DEVICE-KEY-HERE";  // From dashboard settings

// Pin Definitions
const int SOIL_SENSOR_1_PIN = 34;  // ADC1_CH6
const int SOIL_SENSOR_2_PIN = 35;  // ADC1_CH7
const int RELAY_PIN = 26;          // Digital output for relay

// Channel Keys (must match dashboard configuration)
const char* SOIL_1_CHANNEL_KEY = "soil_moisture_1";
const char* SOIL_2_CHANNEL_KEY = "soil_moisture_2";
const char* VALVE_CHANNEL_KEY = "irrigation_valve";

// Sensor Calibration (adjust based on your sensors)
const int SOIL_DRY_VALUE = 3000;    // ADC value when sensor is in air (dry)
const int SOIL_WET_VALUE = 1200;    // ADC value when sensor is in water (wet)

// Automation Settings
const int MOISTURE_THRESHOLD = 35;  // Open valve if moisture < 35%
const int MOISTURE_STOP = 60;       // Close valve when moisture > 60%

// Timing
const unsigned long SYNC_INTERVAL = 30000;      // Sync every 30 seconds
const unsigned long SENSOR_READ_INTERVAL = 5000; // Read sensors every 5 seconds

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

unsigned long lastSyncTime = 0;
unsigned long lastSensorReadTime = 0;

int soil1Moisture = 0;
int soil2Moisture = 0;
bool valveState = false;
bool manualOverride = false;
unsigned long overrideExpiry = 0;

// ============================================================================
// SETUP
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n\n=================================");
  Serial.println("GanSys Dual Soil Irrigation System");
  Serial.println("=================================\n");

  // Configure pins
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);  // Relay OFF (valve closed)
  
  pinMode(SOIL_SENSOR_1_PIN, INPUT);
  pinMode(SOIL_SENSOR_2_PIN, INPUT);

  // Configure ADC
  analogReadResolution(12);  // 12-bit resolution (0-4095)
  analogSetAttenuation(ADC_11db);  // Full range: 0-3.3V

  // Connect to WiFi
  connectWiFi();

  Serial.println("\nSystem ready!");
  Serial.println("Monitoring soil moisture and controlling irrigation...\n");
}

// ============================================================================
// MAIN LOOP
// ============================================================================

void loop() {
  unsigned long currentTime = millis();

  // Read sensors periodically
  if (currentTime - lastSensorReadTime >= SENSOR_READ_INTERVAL) {
    lastSensorReadTime = currentTime;
    readSensors();
    
    // Check if manual override has expired
    if (manualOverride && currentTime >= overrideExpiry) {
      manualOverride = false;
      Serial.println("Manual override expired. Resuming automatic control.");
    }
    
    // Automatic irrigation control (if not in manual override)
    if (!manualOverride) {
      automaticIrrigationControl();
    }
    
    printStatus();
  }

  // Sync with dashboard periodically
  if (currentTime - lastSyncTime >= SYNC_INTERVAL) {
    lastSyncTime = currentTime;
    syncWithDashboard();
  }

  delay(100);
}

// ============================================================================
// SENSOR READING
// ============================================================================

void readSensors() {
  // Read raw ADC values (multiple samples for stability)
  int raw1 = 0, raw2 = 0;
  for (int i = 0; i < 10; i++) {
    raw1 += analogRead(SOIL_SENSOR_1_PIN);
    raw2 += analogRead(SOIL_SENSOR_2_PIN);
    delay(10);
  }
  raw1 /= 10;
  raw2 /= 10;

  // Convert to percentage (0% = dry, 100% = wet)
  soil1Moisture = map(raw1, SOIL_DRY_VALUE, SOIL_WET_VALUE, 0, 100);
  soil2Moisture = map(raw2, SOIL_DRY_VALUE, SOIL_WET_VALUE, 0, 100);

  // Constrain to valid range
  soil1Moisture = constrain(soil1Moisture, 0, 100);
  soil2Moisture = constrain(soil2Moisture, 0, 100);
}

// ============================================================================
// AUTOMATIC IRRIGATION CONTROL
// ============================================================================

void automaticIrrigationControl() {
  // Open valve if ANY sensor is below threshold (dry soil detected)
  if (soil1Moisture < MOISTURE_THRESHOLD || soil2Moisture < MOISTURE_THRESHOLD) {
    if (!valveState) {
      openValve();
      Serial.println("🚰 AUTO: Opening valve - Dry soil detected!");
    }
  }
  // Close valve only when BOTH sensors are above stop threshold
  else if (soil1Moisture >= MOISTURE_STOP && soil2Moisture >= MOISTURE_STOP) {
    if (valveState) {
      closeValve();
      Serial.println("✓ AUTO: Closing valve - Soil adequately moist!");
    }
  }
}

// ============================================================================
// VALVE CONTROL
// ============================================================================

void openValve() {
  digitalWrite(RELAY_PIN, HIGH);  // Relay ON
  valveState = true;
}

void closeValve() {
  digitalWrite(RELAY_PIN, LOW);   // Relay OFF
  valveState = false;
}

// ============================================================================
// DASHBOARD SYNC
// ============================================================================

void syncWithDashboard() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected. Reconnecting...");
    connectWiFi();
    return;
  }

  HTTPClient http;
  http.begin(API_ENDPOINT);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-id", DEVICE_ID);
  http.addHeader("x-device-key", DEVICE_KEY);

  // Build JSON payload
  StaticJsonDocument<1024> doc;
  doc["firmwareVersion"] = "1.0.0";

  JsonArray readings = doc.createNestedArray("readings");

  // Soil Sensor 1
  JsonObject soil1 = readings.createNestedObject();
  soil1["channelKey"] = SOIL_1_CHANNEL_KEY;
  soil1["numericValue"] = soil1Moisture;
  soil1["rawValue"] = analogRead(SOIL_SENSOR_1_PIN);
  soil1["rawUnit"] = "adc";
  soil1["status"] = "ok";

  // Soil Sensor 2
  JsonObject soil2 = readings.createNestedObject();
  soil2["channelKey"] = SOIL_2_CHANNEL_KEY;
  soil2["numericValue"] = soil2Moisture;
  soil2["rawValue"] = analogRead(SOIL_SENSOR_2_PIN);
  soil2["rawUnit"] = "adc";
  soil2["status"] = "ok";

  // Irrigation Valve
  JsonObject valve = readings.createNestedObject();
  valve["channelKey"] = VALVE_CHANNEL_KEY;
  valve["booleanState"] = valveState;
  valve["numericValue"] = valveState ? 1 : 0;
  valve["status"] = "ok";

  // Acknowledgements (empty for now, will be populated if commands exist)
  JsonArray acks = doc.createNestedArray("acknowledgements");

  String payload;
  serializeJson(doc, payload);

  // Send request
  Serial.println("\n📡 Syncing with dashboard...");
  int httpCode = http.POST(payload);

  if (httpCode > 0) {
    String response = http.getString();
    Serial.printf("✓ Response code: %d\n", httpCode);

    if (httpCode == 200) {
      // Parse response for pending commands
      StaticJsonDocument<2048> responseDoc;
      DeserializationError error = deserializeJson(responseDoc, response);

      if (!error) {
        JsonArray commands = responseDoc["pendingCommands"];
        if (commands.size() > 0) {
          Serial.printf("📋 Received %d pending command(s)\n", commands.size());
          processPendingCommands(commands);
        }
      }
    }
  } else {
    Serial.printf("✗ HTTP Error: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
}

// ============================================================================
// COMMAND PROCESSING
// ============================================================================

void processPendingCommands(JsonArray commands) {
  for (JsonObject cmd : commands) {
    String commandId = cmd["id"].as<String>();
    String channelKey = cmd["channelKey"].as<String>();
    
    if (channelKey == VALVE_CHANNEL_KEY) {
      bool desiredState = cmd["desiredBooleanState"].as<bool>();
      int overrideMinutes = cmd["overrideMinutes"] | 0;

      Serial.printf("🎮 Manual command: %s valve\n", desiredState ? "OPEN" : "CLOSE");

      if (desiredState) {
        openValve();
      } else {
        closeValve();
      }

      // Set manual override if specified
      if (overrideMinutes > 0) {
        manualOverride = true;
        overrideExpiry = millis() + (overrideMinutes * 60000UL);
        Serial.printf("⏱️  Manual override active for %d minutes\n", overrideMinutes);
      }

      // Send acknowledgement
      sendCommandAcknowledgement(commandId, "executed");
    }
  }
}

// ============================================================================
// COMMAND ACKNOWLEDGEMENT
// ============================================================================

void sendCommandAcknowledgement(String commandId, String status) {
  HTTPClient http;
  http.begin(API_ENDPOINT);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-id", DEVICE_ID);
  http.addHeader("x-device-key", DEVICE_KEY);

  StaticJsonDocument<512> doc;
  doc["firmwareVersion"] = "1.0.0";
  
  JsonArray readings = doc.createNestedArray("readings");
  
  JsonArray acks = doc.createNestedArray("acknowledgements");
  JsonObject ack = acks.createNestedObject();
  ack["commandId"] = commandId;
  ack["status"] = status;
  ack["executedAt"] = millis();

  String payload;
  serializeJson(doc, payload);

  int httpCode = http.POST(payload);
  if (httpCode == 200) {
    Serial.printf("✓ Command %s acknowledged\n", commandId.c_str());
  }

  http.end();
}

// ============================================================================
// WIFI CONNECTION
// ============================================================================

void connectWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✓ WiFi connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n✗ WiFi connection failed!");
  }
}

// ============================================================================
// STATUS DISPLAY
// ============================================================================

void printStatus() {
  Serial.println("\n--- System Status ---");
  Serial.printf("Soil 1: %d%% | Soil 2: %d%% | Valve: %s\n", 
                soil1Moisture, soil2Moisture, valveState ? "OPEN" : "CLOSED");
  
  if (manualOverride) {
    unsigned long remaining = (overrideExpiry - millis()) / 1000;
    Serial.printf("Mode: MANUAL (expires in %lu seconds)\n", remaining);
  } else {
    Serial.println("Mode: AUTOMATIC");
  }
  
  Serial.println("--------------------\n");
}
