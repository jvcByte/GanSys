# Quick Start Guide - Dual Soil Irrigation

Get your automated irrigation system running in 15 minutes!

## 📋 What You Need

- ESP32 board
- 2x Capacitive soil moisture sensors
- 1x Relay module (5V)
- 1x Solenoid valve (12V)
- 12V power supply for valve
- USB cable for ESP32

## 🔌 Quick Wiring

```
ESP32 Connections:
├─ GPIO 34 → Soil Sensor 1 (AOUT)
├─ GPIO 35 → Soil Sensor 2 (AOUT)
├─ GPIO 26 → Relay (IN)
├─ 3.3V    → Both Sensors (VCC)
├─ 5V      → Relay (VCC)
└─ GND     → All Components (GND)

Relay to Valve:
├─ COM → 12V Power (+)
└─ NO  → Valve (+)

Valve (-) → 12V Power (-)
```

## 🖥️ Dashboard Setup (5 minutes)

### 1. Create Controller
```
Settings → Register Controller
Name: Garden Irrigation
Hardware ID: ESP32-DUAL-SOIL-01
Location: Garden Zone A
```
**💾 SAVE THE DEVICE KEY!**

### 2. Add 3 Channels

**Channel 1:**
- Key: `soil_moisture_1`
- Name: Soil Moisture 1
- Template: Soil Moisture

**Channel 2:**
- Key: `soil_moisture_2`
- Name: Soil Moisture 2
- Template: Soil Moisture

**Channel 3:**
- Key: `irrigation_valve`
- Name: Irrigation Valve
- Template: Irrigation Valve

## 💻 Code Setup (5 minutes)

### 1. Install Arduino IDE
- Download from arduino.cc
- Install ESP32 board support

### 2. Install Library
```
Tools → Manage Libraries → Search "ArduinoJson" → Install
```

### 3. Update Configuration

Open `dual_soil_irrigation.ino` and change:

```cpp
// Line 28-29: Your WiFi
const char* WIFI_SSID = "YourWiFiName";
const char* WIFI_PASSWORD = "YourPassword";

// Line 32-34: Your Dashboard
const char* API_ENDPOINT = "https://your-domain.com/api/device/sync";
const char* DEVICE_ID = "ESP32-DUAL-SOIL-01";
const char* DEVICE_KEY = "paste-your-device-key-here";
```

### 4. Upload
```
1. Connect ESP32 via USB
2. Select: Tools → Board → ESP32 Dev Module
3. Select: Tools → Port → (your COM port)
4. Click Upload ⬆️
```

## 🧪 Testing (5 minutes)

### 1. Open Serial Monitor
```
Tools → Serial Monitor
Set to: 115200 baud
```

### 2. Check Output
You should see:
```
✓ WiFi connected!
✓ Response code: 200
Soil 1: 45% | Soil 2: 42% | Valve: CLOSED
```

### 3. Test Dashboard Control
- Go to your controller page
- Click the valve toggle
- Watch relay click and Serial Monitor update

### 4. Test Automatic Mode
- Put one sensor in dry soil
- Watch valve automatically open
- Put sensor in water
- Watch valve close when both sensors are wet

## ⚙️ How It Works

### Automatic Logic:
```
IF any sensor < 35% moisture:
  → Open valve (start watering)

IF both sensors > 60% moisture:
  → Close valve (stop watering)
```

### Manual Override:
- Dashboard commands override automatic mode
- Set override duration (e.g., 2 minutes)
- Automatic mode resumes after timeout

## 🎯 Calibration (Optional)

For better accuracy, calibrate your sensors:

### 1. Dry Calibration
```cpp
// Keep sensor in air, note ADC value from Serial Monitor
const int SOIL_DRY_VALUE = 3000;  // Update this
```

### 2. Wet Calibration
```cpp
// Put sensor in water, note ADC value
const int SOIL_WET_VALUE = 1200;  // Update this
```

### 3. Adjust Thresholds
```cpp
const int MOISTURE_THRESHOLD = 35;  // Open valve at 35%
const int MOISTURE_STOP = 60;       // Close valve at 60%
```

## 🚨 Troubleshooting

### WiFi Won't Connect
- Check SSID and password
- Ensure 2.4GHz network (not 5GHz)
- Move closer to router

### Sensors Read 0% or 100%
- Check 3.3V power connection
- Verify wiring to GPIO 34 and 35
- Try recalibration

### Valve Doesn't Operate
- Check relay power (5V)
- Verify GPIO 26 connection
- Test relay with LED first
- Ensure 12V supply for valve

### Dashboard Shows Offline
- Check API endpoint URL
- Verify device ID matches
- Confirm device key is correct
- Check Serial Monitor for errors

## 📊 Dashboard Features

Once running, you can:
- ✅ View real-time moisture levels
- ✅ See valve status (open/closed)
- ✅ Control valve manually
- ✅ View historical trends
- ✅ Set up alerts
- ✅ Schedule irrigation times

## 🔧 Customization

### Add More Sensors
```cpp
// Use GPIO 32, 33, 36, or 39 for additional sensors
const int SOIL_SENSOR_3_PIN = 32;
```

### Change Pins
```cpp
// If GPIO 34/35 are in use, try:
const int SOIL_SENSOR_1_PIN = 32;  // ADC1_CH4
const int SOIL_SENSOR_2_PIN = 33;  // ADC1_CH5
```

### Adjust Timing
```cpp
const unsigned long SYNC_INTERVAL = 30000;      // Dashboard sync
const unsigned long SENSOR_READ_INTERVAL = 5000; // Sensor reading
```

## 📱 Next Steps

1. **Monitor for 24 hours** - Observe automatic cycles
2. **Fine-tune thresholds** - Adjust based on your soil
3. **Set up alerts** - Get notified of issues
4. **Add scheduling** - Use dashboard scheduled commands
5. **Expand system** - Add more sensors or zones

## 💡 Pro Tips

- Place sensors at different depths for better coverage
- Use waterproof enclosure for outdoor installation
- Add manual shutoff valve as backup
- Monitor water usage with flow meter
- Set up rain sensor to pause irrigation

## 📚 Full Documentation

- `README.md` - Complete setup guide
- `PINOUT.md` - Detailed wiring diagrams
- `dual_soil_irrigation.ino` - Commented source code

## 🆘 Need Help?

Check Serial Monitor output first - it shows:
- WiFi connection status
- Sensor readings
- Valve operations
- Dashboard sync status
- Error messages

---

**Ready to grow! 🌱💧**
