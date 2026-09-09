export type ChannelTemplateId =
  | "tank_level"
  | "soil_moisture"
  | "turbidity"
  | "fish_tank_level"
  | "pump"
  | "irrigation_valve"
  | "flush_valve"
  | "inlet_valve"
  | "battery_voltage"
  | "spray_pump"
  | "uv_zapper"
  | "camera_snapshot"
  | "water_ph"
  | "water_temperature"
  | "custom";

export type ChannelKind = "sensor" | "actuator" | "hybrid";

export type TemplateDefinition = {
  id: ChannelTemplateId;
  label: string;
  kind: ChannelKind;
  unit: string;
  minValue: number;
  maxValue: number;
  warningLow: number | null;
  warningHigh: number | null;
  thresholdLow: number | null;
  thresholdHigh: number | null;
  config: Record<string, unknown>;
  calibration: Record<string, unknown>;
};

export type SetupChannelPreset = {
  channelKey: string;
  name: string;
  template: ChannelTemplateId;
  config?: Record<string, unknown>;
};

export type SetupPreset = {
  id: "custom" | "tank_automation" | "irrigation_zone" | "aquaculture_tank" | "full_gansystems" | "pest_control";
  label: string;
  description: string;
  channels: SetupChannelPreset[];
};

export const CHANNEL_TEMPLATES: TemplateDefinition[] = [
  {
    id: "tank_level",
    label: "Main Tank Level",
    kind: "sensor",
    unit: "%",
    minValue: 0,
    maxValue: 100,
    warningLow: 35,
    warningHigh: null,
    thresholdLow: 20,
    thresholdHigh: null,
    config: { rawUnit: "cm", safeRangeMax: 400, display: "gauge" },
    calibration: { tankHeightCm: 180, emptyDistanceCm: 160, fullDistanceCm: 20, offsetCm: 0 },
  },
  {
    id: "soil_moisture",
    label: "Soil Moisture",
    kind: "sensor",
    unit: "%",
    minValue: 0,
    maxValue: 100,
    warningLow: 40,
    warningHigh: null,
    thresholdLow: 30,
    thresholdHigh: null,
    config: { display: "bar", model: "Capacitive Soil Sensor v1.2" },
    calibration: { dryAdc: 3200, wetAdc: 1400 },
  },
  {
    id: "turbidity",
    label: "Water Turbidity",
    kind: "sensor",
    unit: "NTU",
    minValue: 0,
    maxValue: 100,
    warningLow: null,
    warningHigh: 55,
    thresholdLow: null,
    thresholdHigh: 70,
    config: { display: "line", target: "aquaculture" },
    calibration: { cleanWaterOffset: 0 },
  },
  {
    id: "fish_tank_level",
    label: "Fish Tank Level",
    kind: "sensor",
    unit: "%",
    minValue: 0,
    maxValue: 100,
    warningLow: 35,
    warningHigh: 95,
    thresholdLow: 20,
    thresholdHigh: 100,
    config: { rawUnit: "cm", safeRangeMax: 400, display: "gauge" },
    calibration: { tankHeightCm: 120, emptyDistanceCm: 100, fullDistanceCm: 15, offsetCm: 0 },
  },
  {
    id: "pump",
    label: "Water Pump",
    kind: "actuator",
    unit: "state",
    minValue: 0,
    maxValue: 1,
    warningLow: null,
    warningHigh: null,
    thresholdLow: null,
    thresholdHigh: null,
    config: { onLabel: "On", offLabel: "Off", display: "toggle" },
    calibration: {},
  },
  {
    id: "irrigation_valve",
    label: "Irrigation Valve",
    kind: "actuator",
    unit: "state",
    minValue: 0,
    maxValue: 1,
    warningLow: null,
    warningHigh: null,
    thresholdLow: null,
    thresholdHigh: null,
    config: { onLabel: "Open", offLabel: "Closed", display: "toggle" },
    calibration: {},
  },
  {
    id: "flush_valve",
    label: "Flush Valve",
    kind: "actuator",
    unit: "state",
    minValue: 0,
    maxValue: 1,
    warningLow: null,
    warningHigh: null,
    thresholdLow: null,
    thresholdHigh: null,
    config: { onLabel: "Open", offLabel: "Closed", display: "toggle" },
    calibration: {},
  },
  {
    id: "inlet_valve",
    label: "Inlet Valve",
    kind: "actuator",
    unit: "state",
    minValue: 0,
    maxValue: 1,
    warningLow: null,
    warningHigh: null,
    thresholdLow: null,
    thresholdHigh: null,
    config: { onLabel: "Open", offLabel: "Closed", display: "toggle" },
    calibration: {},
  },
  {
    id: "battery_voltage",
    label: "Battery Voltage",
    kind: "sensor",
    unit: "V",
    minValue: 0,
    maxValue: 15,
    warningLow: 11.2,
    warningHigh: null,
    thresholdLow: 10.8,
    thresholdHigh: null,
    config: { display: "line" },
    calibration: { voltageDividerRatio: 5 },
  },
  {
    id: "spray_pump",
    label: "Spray Pump",
    kind: "actuator",
    unit: "state",
    minValue: 0,
    maxValue: 1,
    warningLow: null,
    warningHigh: null,
    thresholdLow: null,
    thresholdHigh: null,
    config: { onLabel: "Spraying", offLabel: "Idle", display: "toggle" },
    calibration: {},
  },
  {
    id: "uv_zapper",
    label: "UV Zapper",
    kind: "actuator",
    unit: "state",
    minValue: 0,
    maxValue: 1,
    warningLow: null,
    warningHigh: null,
    thresholdLow: null,
    thresholdHigh: null,
    config: { onLabel: "Active", offLabel: "Off", display: "toggle" },
    calibration: {},
  },
  {
    id: "camera_snapshot",
    label: "Camera Snapshot",
    kind: "hybrid",
    unit: "image",
    minValue: 0,
    maxValue: 1,
    warningLow: null,
    warningHigh: null,
    thresholdLow: null,
    thresholdHigh: null,
    config: { display: "image" },
    calibration: {},
  },
  {
    id: "water_ph",
    label: "Water pH",
    kind: "sensor",
    unit: "pH",
    minValue: 0,
    maxValue: 14,
    warningLow: 6.5,
    warningHigh: 8.5,
    thresholdLow: 5,
    thresholdHigh: 10,
    config: { display: "gauge", sensorType: "analog pH probe" },
    calibration: { offset: 0 },
  },
  {
    id: "water_temperature",
    label: "Water Temperature",
    kind: "sensor",
    unit: "°C",
    minValue: 0,
    maxValue: 45,
    warningLow: 20,
    warningHigh: 32,
    thresholdLow: 12,
    thresholdHigh: 36,
    config: { display: "line", sensorType: "DS18B20" },
    calibration: { offset: 0 },
  },
  {
    id: "custom",
    label: "Custom Channel",
    kind: "sensor",
    unit: "unit",
    minValue: 0,
    maxValue: 100,
    warningLow: null,
    warningHigh: null,
    thresholdLow: null,
    thresholdHigh: null,
    config: {},
    calibration: {},
  },
];

export const TEMPLATE_MAP = Object.fromEntries(CHANNEL_TEMPLATES.map((template) => [template.id, template]));

export const CONTROLLER_SETUP_PRESETS: SetupPreset[] = [
  {
    id: "custom",
    label: "Custom Setup",
    description: "Create an empty ESP32 controller and add channels manually.",
    channels: [],
  },
  {
    id: "tank_automation",
    label: "Tank + Pump",
    description: "Adds a tank level sensor and its refill pump on one controller.",
    channels: [
      {
        channelKey: "tank_main",
        name: "Main Tank Level",
        template: "tank_level",
        config: { linkedActuatorChannelKeys: ["pump_main"] },
      },
      {
        channelKey: "pump_main",
        name: "Main Pump",
        template: "pump",
      },
    ],
  },
  {
    id: "irrigation_zone",
    label: "Soil + Irrigation Valve",
    description: "Adds a soil moisture channel and the matching irrigation valve control.",
    channels: [
      {
        channelKey: "soil_zone_1",
        name: "Zone 1 Soil Moisture",
        template: "soil_moisture",
        config: { linkedActuatorChannelKeys: ["irrigation_valve_1"] },
      },
      {
        channelKey: "irrigation_valve_1",
        name: "Zone 1 Irrigation Valve",
        template: "irrigation_valve",
      },
    ],
  },
  {
    id: "aquaculture_tank",
    label: "Aquaculture Tank",
    description: "Adds turbidity, fish tank level, and the inlet/flush valves needed for water cycling.",
    channels: [
      {
        channelKey: "turbidity_fish",
        name: "Fish Tank Turbidity",
        template: "turbidity",
        config: { linkedActuatorChannelKeys: ["flush_valve_fish", "inlet_valve_fish"] },
      },
      {
        channelKey: "fish_tank_level",
        name: "Fish Tank Level",
        template: "fish_tank_level",
        config: { linkedActuatorChannelKeys: ["inlet_valve_fish"] },
      },
      {
        channelKey: "flush_valve_fish",
        name: "Fish Tank Flush Valve",
        template: "flush_valve",
      },
      {
        channelKey: "inlet_valve_fish",
        name: "Fish Tank Inlet Valve",
        template: "inlet_valve",
      },
    ],
  },
  {
    id: "full_gansystems",
    label: "Full GanSystems Starter",
    description: "Creates a ready-to-demo controller with tank, irrigation, aquaculture, and battery channels.",
    channels: [
      {
        channelKey: "tank_main",
        name: "Main Tank Level",
        template: "tank_level",
        config: { linkedActuatorChannelKeys: ["pump_main"] },
      },
      {
        channelKey: "pump_main",
        name: "Main Pump",
        template: "pump",
      },
      {
        channelKey: "soil_zone_1",
        name: "Zone 1 Soil Moisture",
        template: "soil_moisture",
        config: { linkedActuatorChannelKeys: ["irrigation_valve_1"] },
      },
      {
        channelKey: "irrigation_valve_1",
        name: "Zone 1 Irrigation Valve",
        template: "irrigation_valve",
      },
      {
        channelKey: "turbidity_fish",
        name: "Fish Tank Turbidity",
        template: "turbidity",
        config: { linkedActuatorChannelKeys: ["flush_valve_fish", "inlet_valve_fish"] },
      },
      {
        channelKey: "fish_tank_level",
        name: "Fish Tank Level",
        template: "fish_tank_level",
        config: { linkedActuatorChannelKeys: ["inlet_valve_fish"] },
      },
      {
        channelKey: "flush_valve_fish",
        name: "Fish Tank Flush Valve",
        template: "flush_valve",
      },
      {
        channelKey: "inlet_valve_fish",
        name: "Fish Tank Inlet Valve",
        template: "inlet_valve",
      },
      {
        channelKey: "battery_main",
        name: "Battery Voltage",
        template: "battery_voltage",
      },
      {
        channelKey: "spray_pump_main",
        name: "Spray Pump",
        template: "spray_pump",
      },
      {
        channelKey: "uv_zapper_main",
        name: "UV Zapper",
        template: "uv_zapper",
      },
    ],
  },
  {
    id: "pest_control",
    label: "Pest Control",
    description: "Adds a spray pump and UV zapper for automated pest management.",
    channels: [
      {
        channelKey: "spray_pump_main",
        name: "Spray Pump",
        template: "spray_pump",
      },
      {
        channelKey: "uv_zapper_main",
        name: "UV Zapper",
        template: "uv_zapper",
      },
    ],
  },
];

export const SETUP_PRESET_MAP = Object.fromEntries(CONTROLLER_SETUP_PRESETS.map((preset) => [preset.id, preset]));

export function getTemplate(templateId: string) {
  return TEMPLATE_MAP[templateId as ChannelTemplateId] ?? TEMPLATE_MAP.custom;
}

export function getSetupPreset(presetId: string) {
  return SETUP_PRESET_MAP[presetId as SetupPreset["id"]] ?? SETUP_PRESET_MAP.custom;
}
