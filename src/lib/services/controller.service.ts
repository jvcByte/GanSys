import { differenceInSeconds } from "date-fns";
import { and, desc, eq, inArray } from "drizzle-orm";

import { createId, createSecret, hashToken } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { alerts, channels, controllers } from "@/lib/db/schema";
import type { AlertView, ControllerCard } from "@/lib/types";
import { getOpenAlertsByController, resolveOpenAlerts, upsertOpenAlert } from "./alert.service";
import { hydrateChannel } from "./channel.service";

type ControllerInput = {
  name: string;
  hardwareId: string;
  location: string;
  description?: string;
  heartbeatIntervalSec?: number;
};

function nowIso() {
  return new Date().toISOString();
}

export function computeControllerStatus(lastSeenAt: string | null, heartbeatIntervalSec: number): "online" | "stale" | "offline" {
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
    lastSeenAt: controller.lastSeenAt ?? null,
    status: computeControllerStatus(controller.lastSeenAt ?? null, controller.heartbeatIntervalSec),
    createdAt: controller.createdAt,
    updatedAt: controller.updatedAt,
    channelCount: channelList.length,
    openAlertCount: openAlertList.length,
    sensorCount: channelList.filter((c) => c.kind !== "actuator").length,
    actuatorCount: channelList.filter((c) => c.kind !== "sensor").length,
    channels: channelList,
  };
}

export function getControllerOwnedByUser(userId: string, controllerId: string) {
  const controller = db
    .select()
    .from(controllers)
    .where(and(eq(controllers.id, controllerId), eq(controllers.userId, userId)))
    .get();
  if (!controller) throw new Error("Controller not found.");
  return controller;
}

export function updateControllerStatuses(userId: string) {
  const list = db.select().from(controllers).where(eq(controllers.userId, userId)).all();
  for (const controller of list) {
    const status = computeControllerStatus(controller.lastSeenAt ?? null, controller.heartbeatIntervalSec);
    if (status !== controller.status) {
      db.update(controllers).set({ status, updatedAt: nowIso() }).where(eq(controllers.id, controller.id)).run();
    }
    if (status === "online") {
      resolveOpenAlerts(userId, controller.id, "offline");
    } else if (status === "stale") {
      upsertOpenAlert({ userId, controllerId: controller.id, type: "offline", severity: "warning", title: `${controller.name} missed a heartbeat`, message: `${controller.hardwareId} is stale and has not checked in on schedule.` });
    } else {
      upsertOpenAlert({ userId, controllerId: controller.id, type: "offline", severity: "critical", title: `${controller.name} is offline`, message: `${controller.hardwareId} has not synced for more than ${controller.heartbeatIntervalSec * 2} seconds.` });
    }
  }
}

export function getUserControllers(userId: string) {
  updateControllerStatuses(userId);
  const controllerRows = db.select().from(controllers).where(eq(controllers.userId, userId)).orderBy(desc(controllers.updatedAt)).all();
  const controllerIds = controllerRows.map((c) => c.id);
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

  return controller;
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
