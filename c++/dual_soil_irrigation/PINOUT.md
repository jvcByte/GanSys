# ESP32 Pinout Reference - Dual Soil Irrigation

## Quick Pin Reference

| Component | ESP32 Pin | Type | Notes |
|-----------|-----------|------|-------|
| Soil Sensor 1 | GPIO 34 | Analog Input | ADC1_CH6, 12-bit resolution |
| Soil Sensor 2 | GPIO 35 | Analog Input | ADC1_CH7, 12-bit resolution |
| Relay (Valve) | GPIO 26 | Digital Output | Active HIGH |
| Sensors VCC | 3.3V | Power | Both sensors |
| Relay VCC | 5V | Power | Or 3.3V depending on relay |
| Common GND | GND | Ground | All components |

## Visual Pinout

```
                    ┌─────────────────┐
                    │                 │
                    │     ESP32       │
                    │                 │
         3.3V ──────┤ 3V3         GND ├────── GND (Common)
                    │                 │
  Soil 1 AOUT ──────┤ GPIO 34     5V  ├────── Relay VCC
  Soil 2 AOUT ──────┤ GPIO 35         │
                    │                 │
   Relay IN   ──────┤ GPIO 26         │
                    │                 │
                    │                 │
                    └─────────────────┘
```

## Sensor Connections (Both Identical)

```
Capacitive Soil Moisture Sensor
┌──────────────────┐
│  [  Sensor PCB  ]│
│                  │
│  VCC  GND  AOUT  │
└───┬───┬─────┬────┘
    │   │     │
    │   │     └──→ ESP32 GPIO 34 or 35
    │   └────────→ ESP32 GND
    └────────────→ ESP32 3.3V
```

## Relay Module Connection

```
Relay Module (5V, Active HIGH)
┌──────────────────┐
│   Relay Module   │
│                  │
│  VCC  GND   IN   │
└───┬───┬─────┬────┘
    │   │     │
    │   │     └──→ ESP32 GPIO 26
    │   └────────→ ESP32 GND
    └────────────→ ESP32 5V

│  COM   NO   NC   │
└───┬────┬────┬────┘
    │    │    │
    │    │    └──→ Not used
    │    └───────→ Solenoid Valve (+)
    └────────────→ 12V Power Supply (+)
```

## Complete System Wiring

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Soil       │     │   ESP32      │     │   Relay      │
│  Sensor 1   │     │              │     │   Module     │
│             │     │              │     │              │
│  VCC ───────┼─────┤ 3.3V         │     │              │
│  GND ───────┼─────┤ GND ─────────┼─────┤ GND          │
│  AOUT ──────┼─────┤ GPIO 34      │     │              │
└─────────────┘     │              │     │  VCC ────────┼──→ 5V
                    │              │     │              │
┌─────────────┐     │              │     │  IN  ────────┼──→ GPIO 26
│  Soil       │     │              │     │              │
│  Sensor 2   │     │              │     │  COM ────────┼──→ 12V (+)
│             │     │              │     │  NO  ────────┼──→ Valve (+)
│  VCC ───────┼─────┤ 3.3V         │     │  NC          │
│  GND ───────┼─────┤ GND          │     └──────────────┘
│  AOUT ──────┼─────┤ GPIO 35      │              │
└─────────────┘     │              │              │
                    │  5V ─────────┼──────────────┘
                    │              │
                    └──────────────┘
                                                   ┌──────────────┐
                                                   │  Solenoid    │
                                                   │  Valve       │
                                                   │              │
                                                   │  (+) ────────┼──→ Relay NO
                                                   │  (-) ────────┼──→ 12V (-)
                                                   └──────────────┘
```

## ADC Pin Selection Notes

### Why GPIO 34 and 35?

These pins are part of **ADC1** which is recommended because:
- ADC2 pins conflict with WiFi usage
- ADC1 pins work reliably with WiFi enabled
- 12-bit resolution (0-4095 values)

### Alternative ADC1 Pins (if needed):
- GPIO 32 (ADC1_CH4)
- GPIO 33 (ADC1_CH5)
- GPIO 36 (ADC1_CH0) - Input only
- GPIO 39 (ADC1_CH3) - Input only

⚠️ **Avoid ADC2 pins when using WiFi:**
- GPIO 0, 2, 4, 12, 13, 14, 15, 25, 26, 27

## Relay Pin Selection

### Why GPIO 26?

- Safe digital output pin
- No boot mode conflicts
- Can source enough current for relay
- Not used by ADC2

### Alternative Output Pins:
- GPIO 25, 27, 32, 33
- Avoid: GPIO 0, 2, 12, 15 (boot mode pins)

## Power Requirements

| Component | Voltage | Current | Notes |
|-----------|---------|---------|-------|
| ESP32 | 5V (USB) or 3.3V | ~250mA | Via USB or regulator |
| Soil Sensors (each) | 3.3V | ~5mA | Very low power |
| Relay Module | 5V or 3.3V | ~70mA | Check your relay specs |
| Solenoid Valve | 12V DC | 300-500mA | Separate power supply |

### Power Supply Recommendations:

1. **ESP32 + Sensors + Relay:**
   - USB power (5V, 1A) is sufficient
   - Or use 5V wall adapter

2. **Solenoid Valve:**
   - Separate 12V DC power supply (1A minimum)
   - Do NOT power from ESP32!

## Testing Checklist

- [ ] Verify 3.3V on sensor VCC pins
- [ ] Check GND continuity across all components
- [ ] Test relay click with simple digitalWrite
- [ ] Measure sensor output voltage (should vary 0-3.3V)
- [ ] Confirm valve operates with 12V supply
- [ ] Test WiFi connection
- [ ] Verify dashboard communication

## Common Wiring Mistakes

❌ **Don't:**
- Connect sensors to 5V (use 3.3V only)
- Use ADC2 pins with WiFi enabled
- Power solenoid valve from ESP32
- Forget common ground between ESP32 and relay
- Mix up relay COM/NO/NC connections

✅ **Do:**
- Use 3.3V for sensors
- Use ADC1 pins (34, 35)
- Separate power supply for valve
- Connect all grounds together
- Test relay before connecting valve

## Troubleshooting by Pin

### Soil Sensor 1 (GPIO 34) Not Reading:
1. Check 3.3V power to sensor
2. Verify GND connection
3. Test sensor with multimeter (should read 0-3.3V)
4. Try different ADC1 pin

### Soil Sensor 2 (GPIO 35) Not Reading:
1. Same as Sensor 1 troubleshooting
2. Ensure both sensors have power

### Relay (GPIO 26) Not Switching:
1. Check 5V power to relay module
2. Verify GND connection
3. Test with LED instead of relay
4. Check relay IN pin connection
5. Verify relay is active HIGH (not LOW)

## Safety Reminders

⚠️ **Before Powering On:**
1. Double-check all connections
2. Verify no shorts between VCC and GND
3. Ensure proper polarity on all components
4. Test relay operation before connecting valve
5. Use proper wire gauge for valve current

🔌 **Power Sequence:**
1. Connect ESP32 to USB/power
2. Verify sensor readings in Serial Monitor
3. Test relay operation
4. Connect valve power supply
5. Test complete system

## Quick Reference Card

```
╔════════════════════════════════════════╗
║  DUAL SOIL IRRIGATION - PIN REFERENCE  ║
╠════════════════════════════════════════╣
║  Soil 1:  GPIO 34 (3.3V, GND)          ║
║  Soil 2:  GPIO 35 (3.3V, GND)          ║
║  Relay:   GPIO 26 (5V, GND)            ║
║  Valve:   12V via Relay COM→NO         ║
╠════════════════════════════════════════╣
║  Threshold: 35% (open valve)           ║
║  Stop:      60% (close valve)          ║
╚════════════════════════════════════════╝
```
