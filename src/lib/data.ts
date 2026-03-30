import { addMinutes, differenceInSeconds, startOfMinute, subHours } from "date-fns";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { createId, createSecret, findUserByEmail, hashPassword, hashToken, normalizeEmail, sanitizeUser, verifyPassword } from "@/lib/auth";
import { db, sqlite } from "@/lib/db/client";
import { alerts, channels, commands, controllers, telemetrySamples, users } from "@/lib/db/schema";
import { getTemplate } from "@/lib/templates";
import type {
  AlertView,
  ChannelView,
  CommandView,
  ControllerCard,
  ControllerSnapshot,
  DashboardSnapshot,
  DashboardSummary,
  HistoryPoint,
} from "@/lib/types";
import { getBucketSize, getRangeStart, safeJsonParse, toJson } from "@/lib/utils";

type ChannelInput = {
  channelKey: string;
  name: string;
  template: string;
  kind: string;
  unit: string;
  minValue: number;
  maxValue: number;
  thresholdLow?: number | null;
  thresholdHigh?: number | null;
  warningLow?: number | null;
  warningHigh?: number | null;
  config?: Record<string, unknown>;
  calibration?: Record<string, unknown>;
};

type ControllerInput = {
  name: string;
  hardwareId: string;
  location: string;
  description?: string;
  heartbeatIntervalSec?: number;
};

export type DeviceAckInput = {
  commandId: string;
  status: string;
  executedAt?: string;
  deviceMessage?: string;
};

export type DeviceReadingInput = {
  channelKey: string;
  numericValue?: number;
  booleanState?: boolean;
  rawValue?: number;
  rawUnit?: string;
  status?: string;
  payload?: Record<string, unknown>;
};

export type DeviceSyncBody = {
  firmwareVersion?: string;
  readings: DeviceReadingInput[];
  acknowledgements?: DeviceAckInput[];
};

function nowIso() {
  return new Date().toISOString();
}

function computeControllerStatus(lastSeenAt: string | null, heartbeatIntervalSec: number): "online" | "stale" | "offline" {
  if (!lastSeenAt) {
    return "offline";
  }
  const age = differenceInSeconds(new Date(), new Date(lastSeenAt));
  if (age <= heartbeatIntervalSec) {
    return "online";
  }
  if (age <= heartbeatIntervalSec * 2) {
    return "stale";
  }
  return "offline";
}

function hydrateChannel(channel: typeof channels.$inferSelect) {
  return {
    id: channel.id,
    controllerId: channel.controllerId,
    channelKey: channel.channelKey,
    name: channel.name,
    template: channel.template as ChannelView["template"],
    kind: channel.kind as ChannelView["kind"],
    unit: channel.unit,
    minValue: channel.minValue,
    maxValue: channel.maxValue,
    latestNumericValue: channel.latestNumericValue ?? null,
    latestBooleanState: channel.latestBooleanState ?? null,
    latestStatus: channel.latestStatus,
    lastSampleAt: channel.lastSampleAt ?? null,
    thresholdLow: channel.thresholdLow ?? null,
    thresholdHigh: channel.thresholdHigh ?? null,
    warningLow: channel.warningLow ?? null,
    warningHigh: channel.warningHigh ?? null,
    config: safeJsonParse<Record<string, unknown>>(channel.configJson, {}),
    calibration: safeJsonParse<Record<string, unknown>>(channel.calibrationJson, {}),
    sortOrder: channel.sortOrder,
  } as const;
}

function hydrateAlert(alert: typeof alerts.$inferSelect): AlertView {
  return {
    id: alert.id,
    controllerId: alert.controllerId,
    channelId: alert.channelId ?? null,
    type: alert.type,
    severity: alert.severity as AlertView["severity"],
    title: alert.title,
    message: alert.message,
    status: alert.status,
    openedAt: alert.openedAt,
    resolvedAt: alert.resolvedAt ?? null,
    meta: safeJsonParse<Record<string, unknown>>(alert.metaJson, {}),
  };
}

function hydrateCommand(command: typeof commands.$inferSelect): CommandView {
  return {
    id: command.id,
    channelId: command.channelId,
    commandType: command.commandType,
    desiredBooleanState: command.desiredBooleanState ?? null,
    desiredNumericValue: command.desiredNumericValue ?? null,
    note: command.note,
    status: command.status,
    overrideUntil: command.overrideUntil ?? null,
    createdAt: command.createdAt,
    acknowledgedAt: command.acknowledgedAt ?? null,
    deviceMessage: command.deviceMessage ?? null,
  };
}

function getUserRecord(userId: string) {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    throw new Error("User not found.");
  }
  return user;
}

function getControllerOwnedByUser(userId: string, controllerId: string) {
  const controller = db
    .select()
    .from(controllers)
    .where(and(eq(controllers.id, controllerId), eq(controllers.userId, userId)))
    .get();
  if (!controller) {
    throw new Error("Controller not found.");
  }
  return controller;
}

function getChannelOwnedByUser(userId: string, channelId: string) {
  const row = db
    .select({
      channel: channels,
      userId: controllers.userId,
    })
    .from(channels)
    .innerJoin(controllers, eq(controllers.id, channels.controllerId))
    .where(eq(channels.id, channelId))
    .get();

  if (!row || row.userId !== userId) {
    throw new Error("Channel not found.");
  }
  return row.channel;
}

function upsertOpenAlert(params: {
  userId: string;
  controllerId: string;
  channelId?: string | null;
  type: string;
  severity: string;
  title: string;
  message: string;
  meta?: Record<string, unknown>;
}) {
  const channelCondition = params.channelId ? eq(alerts.channelId, params.channelId) : sql`${alerts.channelId} IS NULL`;
  const existing = db
    .select()
    .from(alerts)
    .where(
      and(
        eq(alerts.userId, params.userId),
        eq(alerts.controllerId, params.controllerId),
        channelCondition,
        eq(alerts.type, params.type),
        eq(alerts.status, "open")
      )
    )
    .get();

  if (existing) {
    db.update(alerts)
      .set({
        severity: params.severity,
        title: params.title,
        message: params.message,
        metaJson: toJson(params.meta ?? {}),
      })
      .where(eq(alerts.id, existing.id))
      .run();
    return;
  }

  db.insert(alerts)
    .values({
      id: createId("alert"),
      userId: params.userId,
      controllerId: params.controllerId,
      channelId: params.channelId ?? null,
      type: params.type,
      severity: params.severity,
      title: params.title,
      message: params.message,
      status: "open",
      openedAt: nowIso(),
      resolvedAt: null,
      metaJson: toJson(params.meta ?? {}),
    })
    .run();
}

function resolveOpenAlerts(userId: string, controllerId: string, type: string, channelId?: string | null) {
  const channelCondition = channelId ? eq(alerts.channelId, channelId) : sql`${alerts.channelId} IS NULL`;
  const openAlerts = db
    .select()
    .from(alerts)
    .where(and(eq(alerts.userId, userId), eq(alerts.controllerId, controllerId), channelCondition, eq(alerts.type, type), eq(alerts.status, "open")))
    .all();

  for (const alert of openAlerts) {
    db.update(alerts).set({ status: "resolved", resolvedAt: nowIso() }).where(eq(alerts.id, alert.id)).run();
  }
}

function updateControllerStatuses(userId: string) {
  const list = db.select().from(controllers).where(eq(controllers.userId, userId)).all();
  for (const controller of list) {
    const status = computeControllerStatus(controller.lastSeenAt ?? null, controller.heartbeatIntervalSec);
    if (status !== controller.status) {
      db.update(controllers).set({ status, updatedAt: nowIso() }).where(eq(controllers.id, controller.id)).run();
    }
    if (status === "online") {
      resolveOpenAlerts(userId, controller.id, "offline");
    } else if (status === "stale") {
      upsertOpenAlert({
        userId,
        controllerId: controller.id,
        type: "offline",
        severity: "warning",
        title: `${controller.name} missed a heartbeat`,
        message: `${controller.hardwareId} is stale and has not checked in on schedule.`,
      });
    } else {
      upsertOpenAlert({
        userId,
        controllerId: controller.id,
        type: "offline",
        severity: "critical",
        title: `${controller.name} is offline`,
        message: `${controller.hardwareId} has not synced for more than ${controller.heartbeatIntervalSec * 2} seconds.`,
      });
    }
  }
}

function buildControllerCard(
  controller: typeof controllers.$inferSelect,
  channelList: Array<ReturnType<typeof hydrateChannel>>,
  openAlertList: AlertView[]
): ControllerCard {
  return {
    id: controller.id,
    name: controller.name,
    hardwareId: controller.hardwareId,
    location: controller.location,
    description: controller.description,
    firmwareVersion: controller.firmwareVersion,
    heartbeatIntervalSec: controller.heartbeatIntervalSec,
    lastSeenAt: controller.lastSeenAt ?? null,
    status: computeControllerStatus(controller.lastSeenAt ?? null, controller.heartbeatIntervalSec),
    createdAt: controller.createdAt,
    updatedAt: controller.updatedAt,
    channelCount: channelList.length,
    openAlertCount: openAlertList.length,
    sensorCount: channelList.filter((channel) => channel.kind !== "actuator").length,
    actuatorCount: channelList.filter((channel) => channel.kind !== "sensor").length,
    channels: channelList,
  };
}

function buildSummary(userId: string, controllerCards: ControllerCard[], openAlerts: AlertView[]): DashboardSummary {
  const openCommands =
    db
      .select({ value: sql<number>`count(*)` })
      .from(commands)
      .innerJoin(controllers, eq(controllers.id, commands.controllerId))
      .where(and(eq(controllers.userId, userId), eq(commands.status, "pending")))
      .get()?.value ?? 0;

  const average = (values: number[]) => (values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)) : null);
  const soilValues = controllerCards.flatMap((controller) =>
    controller.channels.filter((channel) => channel.template === "soil_moisture" && channel.latestNumericValue !== null).map((channel) => channel.latestNumericValue as number)
  );
  const tankValues = controllerCards.flatMap((controller) =>
    controller.channels.filter((channel) => channel.template === "tank_level" && channel.latestNumericValue !== null).map((channel) => channel.latestNumericValue as number)
  );
  const turbidityValues = controllerCards.flatMap((controller) =>
    controller.channels.filter((channel) => channel.template === "turbidity" && channel.latestNumericValue !== null).map((channel) => channel.latestNumericValue as number)
  );

  return {
    controllerCount: controllerCards.length,
    onlineControllers: controllerCards.filter((controller) => controller.status === "online").length,
    staleControllers: controllerCards.filter((controller) => controller.status === "stale").length,
    criticalAlerts: openAlerts.filter((alert) => alert.severity === "critical").length,
    warningAlerts: openAlerts.filter((alert) => alert.severity === "warning").length,
    openCommands,
    avgSoilMoisture: average(soilValues),
    avgTankLevel: average(tankValues),
    avgTurbidity: average(turbidityValues),
  };
}

function getOpenAlertsByController(userId: string) {
  const map = new Map<string, AlertView[]>();
  const rows = db
    .select()
    .from(alerts)
    .where(and(eq(alerts.userId, userId), eq(alerts.status, "open")))
    .orderBy(desc(alerts.openedAt))
    .all();

  for (const row of rows) {
    const alert = hydrateAlert(row);
    const bucket = map.get(alert.controllerId) ?? [];
    bucket.push(alert);
    map.set(alert.controllerId, bucket);
  }

  return map;
}

function getUserControllers(userId: string) {
  updateControllerStatuses(userId);

  const controllerRows = db
    .select()
    .from(controllers)
    .where(eq(controllers.userId, userId))
    .orderBy(desc(controllers.updatedAt))
    .all();

  const controllerIds = controllerRows.map((controller) => controller.id);
  const channelRows = controllerIds.length
    ? db.select().from(channels).where(inArray(channels.controllerId, controllerIds)).orderBy(channels.sortOrder, channels.createdAt).all()
    : [];

  const channelMap = new Map<string, Array<ReturnType<typeof hydrateChannel>>>();
  for (const channel of channelRows) {
    const list = channelMap.get(channel.controllerId) ?? [];
    list.push(hydrateChannel(channel));
    channelMap.set(channel.controllerId, list);
  }

  const alertMap = getOpenAlertsByController(userId);
  return controllerRows.map((controller) => buildControllerCard(controller, channelMap.get(controller.id) ?? [], alertMap.get(controller.id) ?? []));
}

export function signupUser(input: { name: string; email: string; password: string; farmName: string; location: string }) {
  const email = normalizeEmail(input.email);
  if (findUserByEmail(email)) {
    throw new Error("An account with that email already exists.");
  }
  if (input.password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  const timestamp = nowIso();
  const userId = createId("user");
  db.insert(users)
    .values({
      id: userId,
      name: input.name.trim(),
      email,
      passwordHash: hashPassword(input.password),
      farmName: input.farmName.trim(),
      location: input.location.trim(),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  return sanitizeUser(getUserRecord(userId));
}

export function loginUser(input: { email: string; password: string }) {
  const user = findUserByEmail(input.email);
  if (!user || !verifyPassword(input.password, user.passwordHash)) {
    throw new Error("Invalid email or password.");
  }
  return sanitizeUser(user);
}

export function updateProfile(userId: string, input: { name: string; email: string; farmName: string; location: string }) {
  const email = normalizeEmail(input.email);
  const existing = findUserByEmail(email);
  if (existing && existing.id !== userId) {
    throw new Error("An account with that email already exists.");
  }

  db.update(users)
    .set({
      name: input.name.trim(),
      email,
      farmName: input.farmName.trim(),
      location: input.location.trim(),
      updatedAt: nowIso(),
    })
    .where(eq(users.id, userId))
    .run();

  return sanitizeUser(getUserRecord(userId));
}

export function getDashboardSnapshot(userId: string): DashboardSnapshot {
  const user = sanitizeUser(getUserRecord(userId));
  const controllerCards = getUserControllers(userId);
  const openAlerts = db
    .select()
    .from(alerts)
    .where(and(eq(alerts.userId, userId), eq(alerts.status, "open")))
    .orderBy(desc(alerts.openedAt))
    .all()
    .map(hydrateAlert);

  return {
    user,
    summary: buildSummary(userId, controllerCards, openAlerts),
    controllers: controllerCards,
    alerts: openAlerts.slice(0, 8),
  };
}

export function getControllerSnapshot(userId: string, controllerId: string): ControllerSnapshot {
  updateControllerStatuses(userId);
  const controller = getControllerOwnedByUser(userId, controllerId);
  const channelRows = db.select().from(channels).where(eq(channels.controllerId, controller.id)).orderBy(channels.sortOrder, channels.createdAt).all();
  const controllerAlerts = db
    .select()
    .from(alerts)
    .where(and(eq(alerts.userId, userId), eq(alerts.controllerId, controller.id), eq(alerts.status, "open")))
    .orderBy(desc(alerts.openedAt))
    .all()
    .map(hydrateAlert);
  const controllerCommands = db
    .select()
    .from(commands)
    .where(eq(commands.controllerId, controller.id))
    .orderBy(desc(commands.createdAt))
    .limit(10)
    .all()
    .map(hydrateCommand);

  return {
    user: sanitizeUser(getUserRecord(userId)),
    controller: buildControllerCard(controller, channelRows.map(hydrateChannel), controllerAlerts),
    alerts: controllerAlerts,
    commands: controllerCommands,
  };
}

export function createController(userId: string, input: ControllerInput) {
  const hardwareId = input.hardwareId.trim();
  if (db.select().from(controllers).where(eq(controllers.hardwareId, hardwareId)).get()) {
    throw new Error("That hardware ID is already registered.");
  }

  const timestamp = nowIso();
  const controllerId = createId("esp32");
  const deviceKey = createSecret();

  db.insert(controllers)
    .values({
      id: controllerId,
      userId,
      name: input.name.trim(),
      hardwareId,
      deviceKeyHash: hashToken(deviceKey),
      location: input.location.trim(),
      description: input.description?.trim() ?? "",
      firmwareVersion: "unknown",
      heartbeatIntervalSec: input.heartbeatIntervalSec ?? 60,
      lastSeenAt: null,
      status: "offline",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  return {
    controller: buildControllerCard(getControllerOwnedByUser(userId, controllerId), [], []),
    deviceKey,
  };
}

export function updateController(userId: string, controllerId: string, input: Partial<ControllerInput>) {
  const controller = getControllerOwnedByUser(userId, controllerId);
  if (input.hardwareId && input.hardwareId.trim() !== controller.hardwareId) {
    if (db.select().from(controllers).where(eq(controllers.hardwareId, input.hardwareId.trim())).get()) {
      throw new Error("That hardware ID is already registered.");
    }
  }

  db.update(controllers)
    .set({
      name: input.name?.trim() ?? controller.name,
      hardwareId: input.hardwareId?.trim() ?? controller.hardwareId,
      location: input.location?.trim() ?? controller.location,
      description: input.description?.trim() ?? controller.description,
      heartbeatIntervalSec: input.heartbeatIntervalSec ?? controller.heartbeatIntervalSec,
      updatedAt: nowIso(),
    })
    .where(eq(controllers.id, controller.id))
    .run();

  return getControllerSnapshot(userId, controller.id).controller;
}

export function deleteController(userId: string, controllerId: string) {
  getControllerOwnedByUser(userId, controllerId);
  db.delete(controllers).where(eq(controllers.id, controllerId)).run();
  return { ok: true };
}

export function resetControllerKey(userId: string, controllerId: string) {
  getControllerOwnedByUser(userId, controllerId);
  const deviceKey = createSecret();
  db.update(controllers).set({ deviceKeyHash: hashToken(deviceKey), updatedAt: nowIso() }).where(eq(controllers.id, controllerId)).run();
  return { deviceKey };
}

export function createChannel(userId: string, controllerId: string, input: Partial<ChannelInput>) {
  getControllerOwnedByUser(userId, controllerId);
  const template = getTemplate(input.template ?? "custom");
  const channelKey = input.channelKey?.trim();
  if (!channelKey) {
    throw new Error("Channel key is required.");
  }
  if (db.select().from(channels).where(and(eq(channels.controllerId, controllerId), eq(channels.channelKey, channelKey))).get()) {
    throw new Error("That channel key already exists on this controller.");
  }

  const sortOrder = db.select({ value: sql<number>`count(*)` }).from(channels).where(eq(channels.controllerId, controllerId)).get()?.value ?? 0;
  const timestamp = nowIso();
  const channelId = createId("channel");

  db.insert(channels)
    .values({
      id: channelId,
      controllerId,
      channelKey,
      name: input.name?.trim() || template.label,
      template: template.id,
      kind: input.kind ?? template.kind,
      unit: input.unit?.trim() || template.unit,
      minValue: input.minValue ?? template.minValue,
      maxValue: input.maxValue ?? template.maxValue,
      latestNumericValue: null,
      latestBooleanState: null,
      latestStatus: "unknown",
      lastSampleAt: null,
      thresholdLow: input.thresholdLow ?? template.thresholdLow,
      thresholdHigh: input.thresholdHigh ?? template.thresholdHigh,
      warningLow: input.warningLow ?? template.warningLow,
      warningHigh: input.warningHigh ?? template.warningHigh,
      configJson: toJson(input.config ?? template.config),
      calibrationJson: toJson(input.calibration ?? template.calibration),
      sortOrder,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  return hydrateChannel(db.select().from(channels).where(eq(channels.id, channelId)).get()!);
}

export function updateChannel(userId: string, channelId: string, input: Partial<ChannelInput>) {
  const channel = getChannelOwnedByUser(userId, channelId);
  if (input.channelKey && input.channelKey.trim() !== channel.channelKey) {
    if (
      db
        .select()
        .from(channels)
        .where(and(eq(channels.controllerId, channel.controllerId), eq(channels.channelKey, input.channelKey.trim())))
        .get()
    ) {
      throw new Error("That channel key already exists on this controller.");
    }
  }

  db.update(channels)
    .set({
      channelKey: input.channelKey?.trim() ?? channel.channelKey,
      name: input.name?.trim() ?? channel.name,
      template: input.template ?? channel.template,
      kind: input.kind ?? channel.kind,
      unit: input.unit?.trim() ?? channel.unit,
      minValue: input.minValue ?? channel.minValue,
      maxValue: input.maxValue ?? channel.maxValue,
      thresholdLow: input.thresholdLow ?? channel.thresholdLow,
      thresholdHigh: input.thresholdHigh ?? channel.thresholdHigh,
      warningLow: input.warningLow ?? channel.warningLow,
      warningHigh: input.warningHigh ?? channel.warningHigh,
      configJson: input.config ? toJson(input.config) : channel.configJson,
      calibrationJson: input.calibration ? toJson(input.calibration) : channel.calibrationJson,
      updatedAt: nowIso(),
    })
    .where(eq(channels.id, channel.id))
    .run();

  return hydrateChannel(db.select().from(channels).where(eq(channels.id, channel.id)).get()!);
}

export function deleteChannel(userId: string, channelId: string) {
  getChannelOwnedByUser(userId, channelId);
  db.delete(channels).where(eq(channels.id, channelId)).run();
  return { ok: true };
}

export function createManualCommand(
  userId: string,
  channelId: string,
  input: { desiredBooleanState?: boolean; desiredNumericValue?: number; note?: string; overrideMinutes?: number }
) {
  const channel = getChannelOwnedByUser(userId, channelId);
  const controller = getControllerOwnedByUser(userId, channel.controllerId);
  if (computeControllerStatus(controller.lastSeenAt ?? null, controller.heartbeatIntervalSec) === "offline") {
    throw new Error("Controller is offline. Manual commands are disabled.");
  }

  const commandId = createId("cmd");
  db.insert(commands)
    .values({
      id: commandId,
      controllerId: controller.id,
      channelId: channel.id,
      requestedByUserId: userId,
      commandType: input.desiredNumericValue !== undefined ? "set_value" : "set_state",
      desiredBooleanState: input.desiredBooleanState ?? null,
      desiredNumericValue: input.desiredNumericValue ?? null,
      note: input.note?.trim() ?? "",
      status: "pending",
      overrideUntil: addMinutes(new Date(), input.overrideMinutes ?? 30).toISOString(),
      createdAt: nowIso(),
      acknowledgedAt: null,
      deviceMessage: null,
    })
    .run();

  upsertOpenAlert({
    userId,
    controllerId: controller.id,
    channelId: channel.id,
    type: "manual_override",
    severity: "info",
    title: `Manual override queued for ${channel.name}`,
    message: `A control command has been queued for ${channel.name}.`,
  });

  return hydrateCommand(db.select().from(commands).where(eq(commands.id, commandId)).get()!);
}

export function getChannelHistory(userId: string, channelId: string, range: "24h" | "7d" | "30d"): HistoryPoint[] {
  getChannelOwnedByUser(userId, channelId);
  const start = getRangeStart(range).toISOString();
  const bucketSize = getBucketSize(range);
  const query = sqlite.prepare(`
    SELECT
      datetime((strftime('%s', recorded_at) / ?) * ?, 'unixepoch') AS recorded_at,
      AVG(numeric_value) AS numeric_value
    FROM telemetry_samples
    WHERE channel_id = ?
      AND numeric_value IS NOT NULL
      AND recorded_at >= ?
    GROUP BY datetime((strftime('%s', recorded_at) / ?) * ?, 'unixepoch')
    ORDER BY recorded_at ASC
    LIMIT 300
  `);

  const rows = query.all(bucketSize, bucketSize, channelId, start, bucketSize, bucketSize) as Array<{
    recorded_at: string;
    numeric_value: number;
  }>;

  return rows.map((row) => ({ recordedAt: row.recorded_at, numericValue: Number(row.numeric_value) }));
}

function evaluateThresholdAlerts(userId: string, controllerId: string, channel: typeof channels.$inferSelect, numericValue: number | null) {
  if (numericValue === null) {
    return;
  }
  const isCritical =
    (channel.thresholdLow !== null && numericValue < channel.thresholdLow) ||
    (channel.thresholdHigh !== null && numericValue > channel.thresholdHigh);
  const isWarning =
    !isCritical &&
    ((channel.warningLow !== null && numericValue < channel.warningLow) ||
      (channel.warningHigh !== null && numericValue > channel.warningHigh));

  if (isCritical) {
    upsertOpenAlert({
      userId,
      controllerId,
      channelId: channel.id,
      type: "threshold",
      severity: "critical",
      title: `${channel.name} crossed a critical threshold`,
      message: `${channel.name} reported ${numericValue} ${channel.unit}.`,
    });
    return;
  }

  if (isWarning) {
    upsertOpenAlert({
      userId,
      controllerId,
      channelId: channel.id,
      type: "threshold",
      severity: "warning",
      title: `${channel.name} crossed a warning threshold`,
      message: `${channel.name} reported ${numericValue} ${channel.unit}.`,
    });
    return;
  }

  resolveOpenAlerts(userId, controllerId, "threshold", channel.id);
}

function evaluateFaultAlerts(userId: string, controllerId: string, channel: typeof channels.$inferSelect) {
  const recent = db
    .select()
    .from(telemetrySamples)
    .where(eq(telemetrySamples.channelId, channel.id))
    .orderBy(desc(telemetrySamples.recordedAt))
    .limit(5)
    .all();

  let fault = false;
  let message = `${channel.name} looks healthy.`;

  if (channel.template === "tank_level" || channel.template === "fish_tank_level") {
    const subset = recent.slice(0, 3);
    fault = subset.length === 3 && subset.every((sample) => (sample.rawValue ?? -1) === 0 || (sample.rawValue ?? 0) > 400);
    message = `${channel.name} returned invalid ultrasonic raw values for 3 consecutive samples.`;
  } else if (channel.template === "soil_moisture") {
    fault = recent.length === 5 && recent.every((sample) => sample.numericValue === 0 || sample.numericValue === 100);
    message = `${channel.name} has been stuck at 0% or 100% for 5 consecutive samples.`;
  }

  if (fault) {
    upsertOpenAlert({
      userId,
      controllerId,
      channelId: channel.id,
      type: "sensor_fault",
      severity: "critical",
      title: `${channel.name} sensor fault`,
      message,
    });
  } else {
    resolveOpenAlerts(userId, controllerId, "sensor_fault", channel.id);
  }
}

function applyAcknowledgements(userId: string, controllerId: string, acknowledgements: DeviceAckInput[]) {
  for (const acknowledgement of acknowledgements) {
    const command = db
      .select()
      .from(commands)
      .where(and(eq(commands.id, acknowledgement.commandId), eq(commands.controllerId, controllerId)))
      .get();
    if (!command) {
      continue;
    }

    db.update(commands)
      .set({
        status: acknowledgement.status,
        acknowledgedAt: acknowledgement.executedAt ?? nowIso(),
        deviceMessage: acknowledgement.deviceMessage ?? null,
      })
      .where(eq(commands.id, command.id))
      .run();

    if (acknowledgement.status === "acknowledged") {
      if (command.desiredBooleanState !== null) {
        db.update(channels)
          .set({
            latestBooleanState: command.desiredBooleanState,
            latestNumericValue: command.desiredBooleanState ? 1 : 0,
            latestStatus: "ok",
            lastSampleAt: acknowledgement.executedAt ?? nowIso(),
            updatedAt: nowIso(),
          })
          .where(eq(channels.id, command.channelId))
          .run();
      }
      resolveOpenAlerts(userId, controllerId, "manual_override", command.channelId);
      resolveOpenAlerts(userId, controllerId, "command_failure", command.channelId);
    } else {
      upsertOpenAlert({
        userId,
        controllerId,
        channelId: command.channelId,
        type: "command_failure",
        severity: "warning",
        title: "Manual command failed",
        message: acknowledgement.deviceMessage ?? "The controller did not acknowledge the command successfully.",
      });
    }
  }
}

function applyReadings(userId: string, controller: typeof controllers.$inferSelect, readings: DeviceReadingInput[]) {
  for (const reading of readings) {
    const channel = db
      .select()
      .from(channels)
      .where(and(eq(channels.controllerId, controller.id), eq(channels.channelKey, reading.channelKey)))
      .get();
    if (!channel) {
      continue;
    }

    const timestamp = nowIso();
    db.insert(telemetrySamples)
      .values({
        id: createId("sample"),
        channelId: channel.id,
        recordedAt: timestamp,
        numericValue: reading.numericValue ?? null,
        booleanState: reading.booleanState ?? null,
        rawValue: reading.rawValue ?? null,
        rawUnit: reading.rawUnit ?? null,
        status: reading.status ?? "ok",
        payloadJson: toJson(reading.payload ?? {}),
      })
      .run();

    db.update(channels)
      .set({
        latestNumericValue: reading.numericValue ?? channel.latestNumericValue,
        latestBooleanState: reading.booleanState ?? channel.latestBooleanState,
        latestStatus: reading.status ?? "ok",
        lastSampleAt: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(channels.id, channel.id))
      .run();

    const nextChannel = db.select().from(channels).where(eq(channels.id, channel.id)).get()!;
    evaluateThresholdAlerts(userId, controller.id, nextChannel, reading.numericValue ?? null);
    evaluateFaultAlerts(userId, controller.id, nextChannel);
  }
}

function expirePendingCommands(controllerId: string, userId: string) {
  const pending = db
    .select()
    .from(commands)
    .where(and(eq(commands.controllerId, controllerId), eq(commands.status, "pending")))
    .all();

  for (const command of pending) {
    if (!command.overrideUntil || new Date(command.overrideUntil) > new Date()) {
      continue;
    }
    db.update(commands)
      .set({
        status: "expired",
        acknowledgedAt: nowIso(),
        deviceMessage: "Command expired before execution.",
      })
      .where(eq(commands.id, command.id))
      .run();
    upsertOpenAlert({
      userId,
      controllerId,
      channelId: command.channelId,
      type: "command_failure",
      severity: "warning",
      title: "Command expired",
      message: "A pending manual command expired before the controller executed it.",
    });
  }
}

export function deviceSync(hardwareId: string, deviceKey: string, payload: DeviceSyncBody) {
  const controller = db.select().from(controllers).where(eq(controllers.hardwareId, hardwareId)).get();
  if (!controller || controller.deviceKeyHash !== hashToken(deviceKey)) {
    throw new Error("Unauthorized device.");
  }

  db.update(controllers)
    .set({
      firmwareVersion: payload.firmwareVersion?.trim() || controller.firmwareVersion,
      lastSeenAt: nowIso(),
      status: "online",
      updatedAt: nowIso(),
    })
    .where(eq(controllers.id, controller.id))
    .run();

  applyAcknowledgements(controller.userId, controller.id, payload.acknowledgements ?? []);
  applyReadings(controller.userId, controller, payload.readings ?? []);
  expirePendingCommands(controller.id, controller.userId);
  resolveOpenAlerts(controller.userId, controller.id, "offline");

  const channelConfig = db.select().from(channels).where(eq(channels.controllerId, controller.id)).orderBy(channels.sortOrder).all();
  const pendingCommands = db
    .select()
    .from(commands)
    .where(and(eq(commands.controllerId, controller.id), eq(commands.status, "pending")))
    .orderBy(commands.createdAt)
    .all();

  return {
    serverTime: nowIso(),
    controller: {
      hardwareId: controller.hardwareId,
      heartbeatIntervalSec: controller.heartbeatIntervalSec,
    },
    channelConfig: channelConfig.map((channel) => ({
      channelKey: channel.channelKey,
      template: channel.template,
      kind: channel.kind,
      minValue: channel.minValue,
      maxValue: channel.maxValue,
      thresholdLow: channel.thresholdLow,
      thresholdHigh: channel.thresholdHigh,
      warningLow: channel.warningLow,
      warningHigh: channel.warningHigh,
      config: safeJsonParse<Record<string, unknown>>(channel.configJson, {}),
      calibration: safeJsonParse<Record<string, unknown>>(channel.calibrationJson, {}),
    })),
    pendingCommands: pendingCommands.map((command) => ({
      commandId: command.id,
      channelId: command.channelId,
      commandType: command.commandType,
      desiredBooleanState: command.desiredBooleanState,
      desiredNumericValue: command.desiredNumericValue,
      overrideUntil: command.overrideUntil,
      note: command.note,
    })),
  };
}

export function getAlerts(userId: string, options?: { controllerId?: string; status?: string }) {
  updateControllerStatuses(userId);
  return db
    .select()
    .from(alerts)
    .where(eq(alerts.userId, userId))
    .orderBy(desc(alerts.openedAt))
    .all()
    .map(hydrateAlert)
    .filter((alert) => {
      if (options?.controllerId && alert.controllerId !== options.controllerId) {
        return false;
      }
      if (options?.status && alert.status !== options.status) {
        return false;
      }
      return true;
    });
}

export function seedDemoData() {
  let user = findUserByEmail("demo@gansys.app");
  if (!user) {
    signupUser({
      name: "Maxwell Onah",
      email: "demo@gansys.app",
      password: "demo1234",
      farmName: "Veritas NEO Demo Farm",
      location: "Abuja, Nigeria",
    });
    user = findUserByEmail("demo@gansys.app");
  }
  if (!user) {
    throw new Error("Could not create demo user.");
  }
  if (db.select().from(controllers).where(eq(controllers.userId, user.id)).all().length > 0) {
    return sanitizeUser(user);
  }

  const created = createController(user.id, {
    name: "GanSystems ESP32 Hub",
    hardwareId: "ESP32-NEO-001",
    location: "Main Reservoir Zone",
    description: "Primary controller for tank, soil, turbidity, and irrigation control.",
    heartbeatIntervalSec: 60,
  });

  const definitions: Array<Partial<ChannelInput>> = [
    { channelKey: "tank_main", name: "Main Tank Level", template: "tank_level" },
    { channelKey: "soil_north", name: "North Bed Soil Moisture", template: "soil_moisture" },
    { channelKey: "turbidity_fish", name: "Fish Tank Turbidity", template: "turbidity" },
    { channelKey: "pump_main", name: "Main Pump", template: "pump" },
    { channelKey: "valve_irrigation", name: "Irrigation Valve", template: "irrigation_valve" },
    { channelKey: "valve_flush", name: "Flush Valve", template: "flush_valve" },
    { channelKey: "valve_inlet", name: "Inlet Valve", template: "inlet_valve" },
  ];
  definitions.forEach((definition) => createChannel(user.id, created.controller.id, definition));

  deviceSync("ESP32-NEO-001", created.deviceKey, {
    firmwareVersion: "1.0.0-demo",
    readings: [
      { channelKey: "tank_main", numericValue: 68, rawValue: 42, rawUnit: "cm" },
      { channelKey: "soil_north", numericValue: 47, rawValue: 2020, rawUnit: "adc" },
      { channelKey: "turbidity_fish", numericValue: 36, rawValue: 36, rawUnit: "NTU" },
      { channelKey: "pump_main", booleanState: false, numericValue: 0 },
      { channelKey: "valve_irrigation", booleanState: true, numericValue: 1 },
      { channelKey: "valve_flush", booleanState: false, numericValue: 0 },
      { channelKey: "valve_inlet", booleanState: true, numericValue: 1 },
    ],
  });

  const sensorRows = db.select().from(channels).where(eq(channels.controllerId, created.controller.id)).all().filter((channel) => channel.kind !== "actuator");
  for (const channel of sensorRows) {
    for (let index = 1; index <= 24; index += 1) {
      const recordedAt = startOfMinute(subHours(new Date(), 24 - index)).toISOString();
      const numericValue =
        channel.template === "tank_level"
          ? 46 + (index % 8) * 3
          : channel.template === "soil_moisture"
            ? 37 + (index % 5) * 2
            : 28 + (index % 6) * 4;
      db.insert(telemetrySamples)
        .values({
          id: createId("sample"),
          channelId: channel.id,
          recordedAt,
          numericValue,
          booleanState: null,
          rawValue: numericValue,
          rawUnit: channel.unit,
          status: "ok",
          payloadJson: "{}",
        })
        .run();
    }
  }

  upsertOpenAlert({
    userId: user.id,
    controllerId: created.controller.id,
    type: "manual_override",
    severity: "info",
    title: "Demo commands enabled",
    message: "Use the controller detail page to send real pending commands to the ESP32 sync API.",
  });

  return sanitizeUser(user);
}
