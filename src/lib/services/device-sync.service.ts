import { eq } from "drizzle-orm";

import { hashToken, sanitizeUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { channels, commands, controllers } from "@/lib/db/schema";
import { safeJsonParse } from "@/lib/utils";
import { resolveOpenAlerts } from "./alert.service";
import { applyAcknowledgements, expirePendingCommands } from "./command.service";
import { applyReadings } from "./telemetry.service";

function nowIso() {
  return new Date().toISOString();
}

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
  const channelKeyById = new Map(channelConfig.map((c) => [c.id, c.channelKey]));
  const pendingCommands = db
    .select()
    .from(commands)
    .where(eq(commands.controllerId, controller.id))
    .orderBy(commands.createdAt)
    .all()
    .filter((c) => c.status === "pending");

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
      channelKey: channelKeyById.get(command.channelId) ?? null,
      commandType: command.commandType,
      desiredBooleanState: command.desiredBooleanState,
      desiredNumericValue: command.desiredNumericValue,
      overrideUntil: command.overrideUntil,
      note: command.note,
    })),
    pestControlSchedule: null, // will be populated in task 5
  };
}
