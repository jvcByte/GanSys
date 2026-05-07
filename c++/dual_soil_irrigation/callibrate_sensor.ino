// ESP32 Capacitive Soil Moisture Sensor Calibration
// Read raw values in air and in water

const int sensorPin = 34;   // Use ADC1 pin: 32, 33, 34, 35, 36, 39

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);               // 0 - 4095
  analogSetPinAttenuation(sensorPin, ADC_11db);
}

int readAverage() {
  long total = 0;
  const int samples = 20;

  for (int i = 0; i < samples; i++) {
    total += analogRead(sensorPin);
    delay(10);
  }

  return total / samples;
}

void loop() {
  int rawValue = readAverage();

  Serial.print("Raw sensor value: ");
  Serial.println(rawValue);

  delay(1000);
}