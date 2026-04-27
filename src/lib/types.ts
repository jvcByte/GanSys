import type { ChannelKind, ChannelTemplateId } from "@/lib/templates";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  farmName: string;
  location: string;
  createdAt: string;
  updatedAt: string;
};

export type ControllerStatus = "online" | "stale" | "offline";
export type AlertSeverity = "info" | "warning" | "critical";

export type ChannelView = {
  id: string;
  controllerId: string;
  channelKey: string;
  name: string;
  template: ChannelTemplateId;
  kind: ChannelKind;
  unit: string;
  minValue: number;
  maxValue: number;
  latestNumericValue: number | null;
  latestBooleanState: boolean | null;
  latestStatus: string;
  lastSampleAt: string | null;
  thresholdLow: number | null;
  thresholdHigh: number | null;
  warningLow: number | null;
  warningHigh: number | null;
  config: Record<string, unknown>;
  calibration: Record<string, unknown>;
  sortOrder: number;
};

export type CommandView = {
  id: string;
  channelId: string;
  commandType: string;
  desiredBooleanState: boolean | null;
  desiredNumericValue: number | null;
  note: string;
  status: string;
  overrideUntil: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  deviceMessage: string | null;
};

export type ScheduledCommandView = {
  id: string;
  controllerId: string;
  channelId: string;
  channelName: string;
  commandType: string;
  desiredBooleanState: boolean | null;
  desiredNumericValue: number | null;
  note: string;
  scheduledFor: string;
  status: string;
  executedCommandId: string | null;
  createdAt: string;
  executedAt: string | null;
  cancelledAt: string | null;
  failureReason: string | null;
};

export type AlertView = {
  id: string;
  controllerId: string;
  channelId: string | null;
  type: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  status: string;
  openedAt: string;
  resolvedAt: string | null;
  meta: Record<string, unknown>;
};

export type ControllerCard = {
  id: string;
  name: string;
  hardwareId: string;
  location: string;
  description: string;
  firmwareVersion: string;
  heartbeatIntervalSec: number;
  lastSeenAt: string | null;
  status: ControllerStatus;
  createdAt: string;
  updatedAt: string;
  channelCount: number;
  openAlertCount: number;
  sensorCount: number;
  actuatorCount: number;
  channels: ChannelView[];
};

export type DashboardSummary = {
  controllerCount: number;
  onlineControllers: number;
  staleControllers: number;
  criticalAlerts: number;
  warningAlerts: number;
  openCommands: number;
  avgSoilMoisture: number | null;
  avgTankLevel: number | null;
  avgTurbidity: number | null;
};

export type DashboardSnapshot = {
  user: SessionUser;
  summary: DashboardSummary;
  controllers: ControllerCard[];
  alerts: AlertView[];
};

export type ControllerSnapshot = {
  user: SessionUser;
  controller: ControllerCard;
  alerts: AlertView[];
  commands: CommandView[];
  scheduledCommands: ScheduledCommandView[];
  pestSchedule: PestControlSchedule | null;
  pestLog: PestLogEntry[];
  latestSnapshots: Record<string, SnapshotPayload>;
};

export type HistoryPoint = {
  recordedAt: string;
  numericValue: number;
};

export type SprayEntry = {
  startTime: string;       // "HH:MM" 24-hour format
  durationMinutes: number; // 1–120
};

export type PestControlSchedule = {
  controllerId: string;
  enabled: boolean;
  sprayEntries: SprayEntry[];
  sprayPumpStartTime: string | null;  // "HH:MM" - Auto turn on time
  sprayPumpEndTime: string | null;    // "HH:MM" - Auto turn off time
  uvStartTime: string | null;
  uvEndTime: string | null;
  updatedAt: string;
};

export type SnapshotPayload = {
  imageUrl: string | null;
  imageBase64: string | null;
};

export type PestLogEntry = {
  channelId: string;
  channelName: string;
  activationType: "manual" | "scheduled";
  booleanState: boolean;
  recordedAt: string;
};

export type WsMessage =
  | { type: "controller_update"; data: ControllerCard }
  | { type: "alert_opened"; data: AlertView }
  | { type: "alert_resolved"; data: { alertId: string } }
  | { type: "snapshot_update"; data: { channelId: string; snapshot: SnapshotPayload } }
  | { type: "pest_log_entry"; data: PestLogEntry };

export type DeviceReadingInput = {
  channelKey: string;
  numericValue?: number;
  booleanState?: boolean;
  rawValue?: number;
  rawUnit?: string;
  status?: string;
  payload?: Record<string, unknown>;
};

export type DeviceAckInput = {
  commandId: string;
  status: string;
  executedAt?: string;
  deviceMessage?: string;
};

export type DeviceSyncRequest = {
  firmwareVersion?: string;
  readings: DeviceReadingInput[];
  acknowledgements?: DeviceAckInput[];
};
