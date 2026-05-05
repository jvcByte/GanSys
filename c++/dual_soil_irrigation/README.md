# Dual Soil Moisture Irrigation System

Automated irrigation system using 2 capacitive soil moisture sensors and 1 solenoid valve controlled by ESP32, integrated with GanSys dashboard.

## Hardware Requirements

- **ESP32 Development Board** (any variant with WiFi)
- **2x Capacitive Soil Moisture Sensors v1.2** (analog output)
- **1x Relay Module** (5V, active HIGH)
- **1x Solenoid Valve** (12V DC recommended)
- **Power Supply** (12V for valve, 5V for ESP32)
- **Jumper Wires**

## Wiring Diagram

```
ESP32 Pin Connections:
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Soil Sensor 1:                                         │
│    VCC  → 3.3V                                          │
│    GND  → GND                                           │
│    AOUT → GPIO 34 (ADC1_CH6)                            │
│                                                         │
│  Soil Sensor 2:                                         │
│    VCC  → 3.3V                                          │
│    GND  → GND                                           │
│    AOUT → GPIO 35 (ADC1_CH7)                            │
│                                                         │
│  Relay Module:                                          │
│    VCC  → 5V (or 3.3V depending on relay)               │
│    GND  → GND                                           │
│    IN   → GPIO 26                                       │
│                                                         │
│  Solenoid Valve:                                        │
│    Connect to relay COM and NO (Normally Open)          │
│    Power with external 12V supply through relay         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Detailed Wiring

```
┌──────────────┐
│   ESP32      │
│              │
│  GPIO 34 ────┼──→ Soil Sensor 1 (AOUT)
│  GPIO 35 ────┼──→ Soil Sensor 2 (AOUT)
│  GPIO 26 ────┼──→ Relay Module (IN)
│              │
│  3.3V    ────┼──→ Sensors VCC
│  GND     ────┼──→ Sensors GND + Relay GND
│  5V      ────┼──→ Relay VCC
└──────────────┘

┌──────────────┐
│ Relay Module │
│              │
│  COM ────────┼──→ 12V Power Supply (+)
│  NO  ────────┼──→ Solenoid Valve (+)
│              │
└──────────────┘

Solenoid Valve (-) → 12V Power Supply (-)
```

## Dashboard Setup

### 1. Create Controller in Dashboard

Go to **Settings** → **Register Controller**:

```
Name: Dual Soil Irrigation
Hardware ID: ESP32-DUAL-SOIL-01
Location: Garden Zone A
Heartbeat Interval: 60 seconds
```

**Save the Device Key** - you'll need it for the code!

### 2. Add Channels

Add these 3 channels to your controller:

#### Channel 1: Soil Moisture Sensor 1
```
Channel Key: soil_moisture_1
Name: Soil Moisture 1
Template: Soil Moisture
```

#### Channel 2: Soil Moisture Sensor 2
```
Channel Key: soil_moisture_2
Name: Soil Moisture 2
Template: Soil Moisture
```

#### Channel 3: Irrigation Valve
```
Channel Key: irrigation_valve
Name: Irrigation Valve
Template: Irrigation Valve
Config: {
  "linkedActuatorChannelKeys": [],
  "onLabel": "Open",
  "offLabel": "Closed"
}
```

### 3. Configure Code

Update these values in `dual_soil_irrigation.ino`:

```cpp
// WiFi Credentials
const char* WIFI_SSID = "YourWiFiName";
const char* WIFI_PASSWORD = "YourWiFiPassword";

// GanSys Dashboard API
const char* API_ENDPOINT = "https://your-gansys-domain.com/api/device/sync";
const char* DEVICE_ID = "ESP32-DUAL-SOIL-01";  // Match dashboard
const char* DEVICE_KEY = "YOUR-DEVICE-KEY-HERE";  // From dashboard

// Channel Keys (must match dashboard exactly)
const char* SOIL_1_CHANNEL_KEY = "soil_moisture_1";
const char* SOIL_2_CHANNEL_KEY = "soil_moisture_2";
const char* VALVE_CHANNEL_KEY = "irrigation_valve";
```

## Sensor Calibration

### Step 1: Calibrate Dry Value
1. Keep sensor in air (completely dry)
2. Upload code and open Serial Monitor
3. Note the raw ADC value
4. Update `SOIL_DRY_VALUE` in code

### Step 2: Calibrate Wet Value
1. Submerge sensor in water
2. Note the raw ADC value
3. Update `SOIL_WET_VALUE` in code

### Example Values:
```cpp
const int SOIL_DRY_VALUE = 3000;  // Sensor in air
const int SOIL_WET_VALUE = 1200;  // Sensor in water
```

## Automation Logic

### How It Works:

1. **Valve Opens When:**
   - ANY sensor reads below `MOISTURE_THRESHOLD` (default: 35%)
   - This ensures irrigation starts if any area is dry

2. **Valve Closes When:**
   - BOTH sensors read above `MOISTURE_STOP` (default: 60%)
   - This ensures all areas are adequately watered

3. **Manual Override:**
   - Dashboard commands can manually open/close valve
   - Override duration can be set (e.g., 2 minutes)
   - After override expires, automatic control resumes

### Adjustable Parameters:

```cpp
const int MOISTURE_THRESHOLD = 35;  // Open valve if < 35%
const int MOISTURE_STOP = 60;       // Close valve when > 60%
```

## Installation Steps

### 1. Hardware Assembly
- Connect all components as per wiring diagram
- Ensure proper power supply for solenoid valve
- Test relay operation before connecting valve

### 2. Software Upload
```bash
1. Open dual_soil_irrigation.ino in Arduino IDE
2. Install required libraries:
   - WiFi (built-in)
   - HTTPClient (built-in)
   - ArduinoJson (install via Library Manager)
3. Select board: ESP32 Dev Module
4. Select correct COM port
5. Upload code
```

### 3. Testing
```bash
1. Open Serial Monitor (115200 baud)
2. Verify WiFi connection
3. Check sensor readings
4. Test valve operation from dashboard
5. Monitor automatic irrigation cycles
```

## Serial Monitor Output

```
=================================
GanSys Dual Soil Irrigation System
=================================

Connecting to WiFi.....
✓ WiFi connected!
IP Address: 192.168.1.100

System ready!
Monitoring soil moisture and controlling irrigation...

--- System Status ---
Soil 1: 42% | Soil 2: 38% | Valve: CLOSED
Mode: AUTOMATIC
--------------------

📡 Syncing with dashboard...
✓ Response code: 200

--- System Status ---
Soil 1: 32% | Soil 2: 28% | Valve: OPEN
Mode: AUTOMATIC
--------------------

🚰 AUTO: Opening valve - Dry soil detected!
```

## Dashboard Features

### Real-time Monitoring
- View both soil moisture levels
- See valve status (Open/Closed)
- Track historical moisture trends

### Manual Control
- Open/close valve from dashboard
- Set override duration
- Emergency stop capability

### Alerts
- Low moisture warnings
- Valve stuck open/closed alerts
- Offline controller notifications

## Troubleshooting

### Sensors Always Read 0% or 100%
- Check wiring connections
- Verify sensor power (3.3V)
- Recalibrate dry/wet values

### Valve Not Operating
- Check relay wiring
- Verify relay power supply
- Test relay with LED first
- Check solenoid valve power (12V)

### WiFi Connection Issues
- Verify SSID and password
- Check WiFi signal strength
- Ensure 2.4GHz network (ESP32 doesn't support 5GHz)

### Dashboard Not Updating
- Verify API endpoint URL
- Check device ID matches dashboard
- Confirm device key is correct
- Check Serial Monitor for HTTP errors

## Safety Notes

⚠️ **Important Safety Information:**

1. **Electrical Safety:**
   - Use proper insulation for all connections
   - Keep electronics away from water
   - Use waterproof enclosures for outdoor installation

2. **Valve Safety:**
   - Install manual shutoff valve as backup
   - Test valve operation before deployment
   - Monitor for leaks regularly

3. **Power Supply:**
   - Use appropriate power ratings
   - Protect against short circuits
   - Consider battery backup for critical applications

## Advanced Features

### Add More Sensors
To add more soil sensors, simply:
1. Connect to available ADC pins (GPIO 32, 33, 36, 39)
2. Add channel in dashboard
3. Update code with new channel key
4. Modify automation logic as needed

### Scheduling
Use the dashboard's scheduled commands feature to:
- Set irrigation times
- Create watering schedules
- Implement time-based overrides

### Integration
- Link with weather API for rain detection
- Add flow meter for water usage tracking
- Integrate with other GanSys controllers

## License

This code is part of the GanSys project and follows the same license.

## Support

For issues or questions:
- Check Serial Monitor output
- Review dashboard logs
- Consult GanSys documentation
