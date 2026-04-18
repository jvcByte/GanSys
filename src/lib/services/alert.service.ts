import { and, desc, eq, sql } from "drizzle-orm";

import { createId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { alerts } from "@/lib/db/schema";
import type { AlertView } from "@/lib/types";
import { safeJsonParse } from "@/lib/utils";

function now() { return new Date(); }

export function hydrateAlert(alert: typeof alerts.$inferSelect): AlertView {
  return {
    id: alert.id,
    controllerId: alert.controllerId,
    channelId: alert.channelId ?? null,
    type: alert.type,
    severity: alert.severity as AlertView["severity"],
    title: alert.title,
    message: alert.message,
    status: alert.status,
    openedAt: alert.openedAt instanceof Date ? alert.openedAt.toISOString() : String(alert.openedAt),
    resolvedAt: alert.resolvedAt ? (alert.resolvedAt instanceof Date ? alert.resolvedAt.toISOString() : String(alert.resolvedAt)) : null,
    meta: safeJsonParse<Record<string, unknown>>(alert.metaJson, {}),
  };
}

export async function upsertOpenAlert(params: {
  userId: string; controllerId: string; channelId?: string | null;
  type: string; severity: string; title: string; message: string;
  meta?: Record<string, unknown>;
}) {
  const channelCondition = params.channelId
    ? eq(alerts.channelId, params.channelId)
    : sql`${alerts.channelId} IS NULL`;

  const existing = await db.select().from(alerts).where(
    and(
      eq(alerts.userId, params.userId),
      eq(alerts.controllerId, params.controllerId),
      channelCondition,
      eq(alerts.type, params.type),
      eq(alerts.status, "open")
    )
  );

  if (existing[0]) {
    await db.update(alerts)
      .set({ severity: params.severity, title: params.title, message: params.message, metaJson: JSON.stringify(params.meta ?? {}) })
      .where(eq(alerts.id, existing[0].id));
    return;
  }

  await db.insert(alerts).values({
    id: createId("alert"),
    userId: params.userId,
    controllerId: params.controllerId,
    channelId: params.channelId ?? null,
    type: params.type,
    severity: params.severity,
    title: params.title,
    message: params.message,
    status: "open",
    openedAt: now(),
    resolvedAt: null,
    metaJson: JSON.stringify(params.meta ?? {}),
  });
}

export async function resolveOpenAlerts(
  userId: string, controllerId: string, type: string, channelId?: string | null
) {
  const channelCondition = channelId
    ? eq(alerts.channelId, channelId)
    : sql`${alerts.channelId} IS NULL`;

  const openAlerts = await db.select().from(alerts).where(
    and(eq(alerts.userId, userId), eq(alerts.controllerId, controllerId), channelCondition, eq(alerts.type, type), eq(alerts.status, "open"))
  );

  await Promise.all(
    openAlerts.map((alert) =>
      db.update(alerts).set({ status: "resolved", resolvedAt: now() }).where(eq(alerts.id, alert.id))
    )
  );
}

export async function getOpenAlertsByController(userId: string) {
  const map = new Map<string, AlertView[]>();
  const rows = await db.select().from(alerts)
    .where(and(eq(alerts.userId, userId), eq(alerts.status, "open")))
    .orderBy(desc(alerts.openedAt));

  for (const row of rows) {
    const alert = hydrateAlert(row);
    const bucket = map.get(alert.controllerId) ?? [];
    bucket.push(alert);
    map.set(alert.controllerId, bucket);
  }
  return map;
}

export async function getAlerts(
  userId: string,
  query: { controllerId?: string; status?: string }
): Promise<AlertView[]> {
  const conditions = [eq(alerts.userId, userId)];

  if (query.controllerId) {
    conditions.push(eq(alerts.controllerId, query.controllerId));
  }

  if (query.status) {
    conditions.push(eq(alerts.status, query.status));
  }

  const rows = await db.select().from(alerts)
    .where(and(...conditions))
    .orderBy(desc(alerts.openedAt));

  return rows.map(hydrateAlert);
}
