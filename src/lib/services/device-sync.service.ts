import { and, asc, eq, lte } from "drizzle-orm";

import { hashToken } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { channels, commands, controllers, scheduledCommands } from "@/lib/db/schema";
import { safeJsonParse } from "@/lib/utils";
import { resolveOpenAlerts } from "./alert.service";
import { applyAcknowledgements, expirePendingCommands } from "./command.service";
import { applyReadings } from "./telemetry.service";
import { getPestSchedule } from "./pest.service";

function now() { return new Date(); }

export type DeviceAckInput = {
  commandId: string; status: string;
  executedAt?: string; deviceMessage?: string;
};

export type DeviceReadingInput = {
  channelKey: string; numericValue?: number; booleanState?: boolean;
  rawValue?: number; rawUnit?: string; status?: string;
  payload?: Record<string, unknown>;
};

export type DeviceSyncBody = {
  firmwareVersion?: string;
  readings: DeviceReadingInput[];
  acknowledgements?: DeviceAckInput[];
  scheduledCommands?: Array<{
    commandId: string;
    channelKey: string;
    scheduledFor: string;
    desiredBooleanState?: boolean;
    note?: string;
  }>;
};

export async function deviceSync(
  hardwareId: string,
  deviceKey: string,
  payload: DeviceSyncBody,
  skipAuth = false
) {
  const rows = await db.select().from(controllers).where(eq(controllers.hardwareId, hardwareId));
  const controller = rows[0];

  if (!controller || (!skipAuth && controller.deviceKeyHash !== hashToken(deviceKey))) {
    throw new Error("Unauthorized device.");
  }

  await db.update(controllers).set({
    firmwareVersion: payload.firmwareVersion?.trim() || controller.firmwareVersion,
    lastSeenAt: now(),
    status: "online",
    updatedAt: now(),
  }).where(eq(controllers.id, controller.id));

  await applyAcknowledgements(controller.userId, controller.id, payload.acknowledgements ?? []);
  await applyReadings(controller.userId, controller, payload.readings ?? []);
  await expirePendingCommands(controller.id, controller.userId);
  await resolveOpenAlerts(controller.userId, controller.id, "offline");

  // Auto-expire scheduled commands that are more than 5 minutes past their scheduled time
  const fiveMinutesAgo = new Date(now().getTime() - 5 * 60 * 1000);
  await db.update(scheduledCommands)
    .set({ 
      status: "failed", 
      executedAt: now(),
      failureReason: "Scheduled time passed without execution" 
    })
    .where(and(
      eq(scheduledCommands.controllerId, controller.id),
      eq(scheduledCommands.status, "pending"),
      lte(scheduledCommands.scheduledFor, fiveMinutesAgo)
    ));

  // Get pending scheduled commands (future only)
  const currentTime = now();
  const pendingScheduledCommands = await db.select().from(scheduledCommands)
    .where(and(
      eq(scheduledCommands.controllerId, controller.id), 
      eq(scheduledCommands.status, "pending")
    ))
    .orderBy(asc(scheduledCommands.scheduledFor));

  const [channelConfig, pendingCommands] = await Promise.all([
    db.select().from(channels).where(eq(channels.controllerId, controller.id)).orderBy(channels.sortOrder),
    db.select().from(commands)
      .where(and(eq(commands.controllerId, controller.id), eq(commands.status, "pending")))
      .orderBy(asc(commands.createdAt)),
  ]);

  const channelKeyById = new Map(channelConfig.map((c) => [c.id, c.channelKey]));
  const pestControlSchedule = await getPestSchedule(controller.userId, controller.id);

  return {
    serverTime: now().toISOString(),
    controller: {
      hardwareId: controller.hardwareId,
      heartbeatIntervalSec: controller.heartbeatIntervalSec,
    },
    channelConfig: channelConfig.map((ch) => ({
      channelKey: ch.channelKey,
      template: ch.template,
      kind: ch.kind,
      minValue: ch.minValue,
      maxValue: ch.maxValue,
      thresholdLow: ch.thresholdLow,
      thresholdHigh: ch.thresholdHigh,
      warningLow: ch.warningLow,
      warningHigh: ch.warningHigh,
      config: safeJsonParse<Record<string, unknown>>(ch.configJson, {}),
      calibration: safeJsonParse<Record<string, unknown>>(ch.calibrationJson, {}),
    })),
    pendingCommands: pendingCommands.map((cmd) => ({
      commandId: cmd.id,
      channelId: cmd.channelId,
      channelKey: channelKeyById.get(cmd.channelId) ?? null,
      commandType: cmd.commandType,
      desiredBooleanState: cmd.desiredBooleanState,
      desiredNumericValue: cmd.desiredNumericValue,
      overrideUntil: cmd.overrideUntil,
      note: cmd.note,
    })),
    scheduledCommands: pendingScheduledCommands.map((cmd) => ({
      commandId: cmd.id,
      channelId: cmd.channelId,
      channelKey: channelKeyById.get(cmd.channelId) ?? null,
      commandType: cmd.commandType,
      desiredBooleanState: cmd.desiredBooleanState,
      desiredNumericValue: cmd.desiredNumericValue,
      scheduledFor: cmd.scheduledFor instanceof Date ? cmd.scheduledFor.toISOString() : String(cmd.scheduledFor),
      note: cmd.note,
    })),
    pestControlSchedule,
  };
}
