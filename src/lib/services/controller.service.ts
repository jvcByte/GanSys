import { differenceInSeconds } from "date-fns";
import { and, desc, eq, inArray } from "drizzle-orm";

import { createId, createSecret, hashToken } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { channels, controllers } from "@/lib/db/schema";
import type { AlertView, ControllerCard } from "@/lib/types";
import { getOpenAlertsByController, resolveOpenAlerts, upsertOpenAlert } from "./alert.service";
import { hydrateChannel } from "./channel.service";

type ControllerInput = {
  name: string; hardwareId: string; location: string;
  description?: string; heartbeatIntervalSec?: number;
};

function now() { return new Date(); }

export function computeControllerStatus(lastSeenAt: string | Date | null, heartbeatIntervalSec: number): "online" | "stale" | "offline" {
  if (!lastSeenAt) return "offline";
  const age = differenceInSeconds(new Date(), new Date(lastSeenAt));
  if (age <= heartbeatIntervalSec) return "online";
  if (age <= heartbeatIntervalSec * 2) return "stale";
  return "offline";
}

export function buildControllerCard(
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
    lastSeenAt: controller.lastSeenAt ? (controller.lastSeenAt instanceof Date ? controller.lastSeenAt.toISOString() : String(controller.lastSeenAt)) : null,
    status: computeControllerStatus(controller.lastSeenAt ?? null, controller.heartbeatIntervalSec),
    createdAt: controller.createdAt instanceof Date ? controller.createdAt.toISOString() : String(controller.createdAt),
    updatedAt: controller.updatedAt instanceof Date ? controller.updatedAt.toISOString() : String(controller.updatedAt),
    channelCount: channelList.length,
    openAlertCount: openAlertList.length,
    sensorCount: channelList.filter((c) => c.kind !== "actuator").length,
    actuatorCount: channelList.filter((c) => c.kind !== "sensor").length,
    channels: channelList,
  };
}

export async function getControllerOwnedByUser(userId: string, controllerId: string) {
  const rows = await db.select().from(controllers)
    .where(and(eq(controllers.id, controllerId), eq(controllers.userId, userId)));
  if (!rows[0]) throw new Error("Controller not found.");
  return rows[0];
}

export async function updateControllerStatuses(userId: string) {
  const list = await db.select().from(controllers).where(eq(controllers.userId, userId));
  await Promise.all(list.map(async (controller) => {
    const status = computeControllerStatus(controller.lastSeenAt ?? null, controller.heartbeatIntervalSec);
    if (status !== controller.status) {
      await db.update(controllers).set({ status, updatedAt: now() }).where(eq(controllers.id, controller.id));
    }
    if (status === "online") {
      await resolveOpenAlerts(userId, controller.id, "offline");
    } else if (status === "stale") {
      await upsertOpenAlert({ userId, controllerId: controller.id, type: "offline", severity: "warning", title: `${controller.name} missed a heartbeat`, message: `${controller.hardwareId} is stale.` });
    } else {
      await upsertOpenAlert({ userId, controllerId: controller.id, type: "offline", severity: "critical", title: `${controller.name} is offline`, message: `${controller.hardwareId} has not synced for more than ${controller.heartbeatIntervalSec * 2} seconds.` });
    }
  }));
}

export async function getUserControllers(userId: string) {
  await updateControllerStatuses(userId);
  const controllerRows = await db.select().from(controllers)
    .where(eq(controllers.userId, userId)).orderBy(desc(controllers.updatedAt));

  const controllerIds = controllerRows.map((c) => c.id);
  const channelRows = controllerIds.length
    ? await db.select().from(channels).where(inArray(channels.controllerId, controllerIds)).orderBy(channels.sortOrder, channels.createdAt)
    : [];

  const channelMap = new Map<string, Array<ReturnType<typeof hydrateChannel>>>();
  for (const channel of channelRows) {
    const list = channelMap.get(channel.controllerId) ?? [];
    list.push(hydrateChannel(channel));
    channelMap.set(channel.controllerId, list);
  }

  const alertMap = await getOpenAlertsByController(userId);
  return controllerRows.map((c) => buildControllerCard(c, channelMap.get(c.id) ?? [], alertMap.get(c.id) ?? []));
}

export async function createController(userId: string, input: ControllerInput) {
  const hardwareId = input.hardwareId.trim();
  const existing = await db.select().from(controllers).where(eq(controllers.hardwareId, hardwareId));
  if (existing[0]) throw new Error("That hardware ID is already registered.");

  const timestamp = now();
  const controllerId = createId("esp32");
  const deviceKey = createSecret();

  await db.insert(controllers).values({
    id: controllerId, userId,
    name: input.name.trim(), hardwareId,
    deviceKeyHash: hashToken(deviceKey),
    location: input.location.trim(),
    description: input.description?.trim() ?? "",
    firmwareVersion: "unknown",
    heartbeatIntervalSec: input.heartbeatIntervalSec ?? 60,
    lastSeenAt: null, status: "offline",
    createdAt: timestamp, updatedAt: timestamp,
  });

  return {
    controller: buildControllerCard(await getControllerOwnedByUser(userId, controllerId), [], []),
    deviceKey,
  };
}

export async function updateController(userId: string, controllerId: string, input: Partial<ControllerInput>) {
  const controller = await getControllerOwnedByUser(userId, controllerId);
  if (input.hardwareId && input.hardwareId.trim() !== controller.hardwareId) {
    const conflict = await db.select().from(controllers).where(eq(controllers.hardwareId, input.hardwareId.trim()));
    if (conflict[0]) throw new Error("That hardware ID is already registered.");
  }

  await db.update(controllers).set({
    name: input.name?.trim() ?? controller.name,
    hardwareId: input.hardwareId?.trim() ?? controller.hardwareId,
    location: input.location?.trim() ?? controller.location,
    description: input.description?.trim() ?? controller.description,
    heartbeatIntervalSec: input.heartbeatIntervalSec ?? controller.heartbeatIntervalSec,
    updatedAt: now(),
  }).where(eq(controllers.id, controller.id));

  return getControllerOwnedByUser(userId, controllerId);
}

export async function deleteController(userId: string, controllerId: string) {
  await getControllerOwnedByUser(userId, controllerId);
  await db.delete(controllers).where(eq(controllers.id, controllerId));
  return { ok: true };
}

export async function resetControllerKey(userId: string, controllerId: string) {
  await getControllerOwnedByUser(userId, controllerId);
  const deviceKey = createSecret();
  await db.update(controllers).set({ deviceKeyHash: hashToken(deviceKey), updatedAt: now() }).where(eq(controllers.id, controllerId));
  return { deviceKey };
}
