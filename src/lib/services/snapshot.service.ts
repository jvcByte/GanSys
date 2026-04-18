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
import { getPestSchedule, getPestControlLog, getLatestSnapshots } from "./pest.service";

export async function buildSummary(
  userId: string,
  controllerCards: ControllerCard[],
  openAlerts: ReturnType<typeof hydrateAlert>[]
): Promise<DashboardSummary> {
  const countRows = await db.select({ value: sql<number>`count(*)` })
    .from(commands)
    .innerJoin(controllers, eq(controllers.id, commands.controllerId))
    .where(and(eq(controllers.userId, userId), eq(commands.status, "pending")));

  const openCommands = Number(countRows[0]?.value ?? 0);
  const avg = (values: number[]) => values.length ? Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(1)) : null;

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
    avgSoilMoisture: avg(soilValues),
    avgTankLevel: avg(tankValues),
    avgTurbidity: avg(turbidityValues),
  };
}

export async function getDashboardSnapshot(userId: string): Promise<DashboardSnapshot> {
  const user = sanitizeUser(await getUserRecord(userId));
  const controllerCards = await getUserControllers(userId);
  const openAlerts = (await db.select().from(alerts)
    .where(and(eq(alerts.userId, userId), eq(alerts.status, "open")))
    .orderBy(desc(alerts.openedAt))).map(hydrateAlert);

  return {
    user,
    summary: await buildSummary(userId, controllerCards, openAlerts),
    controllers: controllerCards,
    alerts: openAlerts.slice(0, 8),
  };
}

export async function getControllerSnapshot(userId: string, controllerId: string): Promise<ControllerSnapshot> {
  await updateControllerStatuses(userId);
  const controller = await getControllerOwnedByUser(userId, controllerId);

  const [channelRows, controllerAlerts, controllerCommands, pestSchedule, pestLog, latestSnapshots] = await Promise.all([
    db.select().from(channels).where(eq(channels.controllerId, controller.id)).orderBy(channels.sortOrder, channels.createdAt),
    db.select().from(alerts).where(and(eq(alerts.userId, userId), eq(alerts.controllerId, controller.id), eq(alerts.status, "open"))).orderBy(desc(alerts.openedAt)),
    db.select().from(commands).where(eq(commands.controllerId, controller.id)).orderBy(desc(commands.createdAt)).limit(10),
    getPestSchedule(userId, controllerId),
    getPestControlLog(controller.id),
    getLatestSnapshots(controller.id),
  ]);

  return {
    user: sanitizeUser(await getUserRecord(userId)),
    controller: buildControllerCard(controller, channelRows.map(hydrateChannel), controllerAlerts.map(hydrateAlert)),
    alerts: controllerAlerts.map(hydrateAlert),
    commands: controllerCommands.map(hydrateCommand),
    pestSchedule,
    pestLog,
    latestSnapshots,
  };
}
