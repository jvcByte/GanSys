import { and, desc, eq, sql } from "drizzle-orm";

import { sanitizeUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { alerts, channels, commands, controllers } from "@/lib/db/schema";
import type { ControllerCard, ControllerSnapshot, DashboardSnapshot, DashboardSummary } from "@/lib/types";
import { hydrateAlert } from "./alert.service";
import { hydrateChannel } from "./channel.service";
import { hydrateCommand } from "./command.service";
import { buildControllerCard, getControllerOwnedByUser, getUserControllers, updateControllerStatuses } from "./controller.service";
import { getUserRecord } from "./auth.service";

export function buildSummary(userId: string, controllerCards: ControllerCard[], openAlerts: ReturnType<typeof hydrateAlert>[]): DashboardSummary {
  const openCommands =
    db
      .select({ value: sql<number>`count(*)` })
      .from(commands)
      .innerJoin(controllers, eq(controllers.id, commands.controllerId))
      .where(and(eq(controllers.userId, userId), eq(commands.status, "pending")))
      .get()?.value ?? 0;

  const average = (values: number[]) => (values.length ? Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(1)) : null);
  const soilValues = controllerCards.flatMap((c) => c.channels.filter((ch) => ch.template === "soil_moisture" && ch.latestNumericValue !== null).map((ch) => ch.latestNumericValue as number));
  const tankValues = controllerCards.flatMap((c) => c.channels.filter((ch) => ch.template === "tank_level" && ch.latestNumericValue !== null).map((ch) => ch.latestNumericValue as number));
  const turbidityValues = controllerCards.flatMap((c) => c.channels.filter((ch) => ch.template === "turbidity" && ch.latestNumericValue !== null).map((ch) => ch.latestNumericValue as number));

  return {
    controllerCount: controllerCards.length,
    onlineControllers: controllerCards.filter((c) => c.status === "online").length,
    staleControllers: controllerCards.filter((c) => c.status === "stale").length,
    criticalAlerts: openAlerts.filter((a) => a.severity === "critical").length,
    warningAlerts: openAlerts.filter((a) => a.severity === "warning").length,
    openCommands,
    avgSoilMoisture: average(soilValues),
    avgTankLevel: average(tankValues),
    avgTurbidity: average(turbidityValues),
  };
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
