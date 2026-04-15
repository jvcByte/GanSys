import { and, desc, eq, sql } from "drizzle-orm";

import { createId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { alerts } from "@/lib/db/schema";
import type { AlertView } from "@/lib/types";
import { safeJsonParse, toJson } from "@/lib/utils";

function nowIso() {
  return new Date().toISOString();
}

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
    openedAt: alert.openedAt,
    resolvedAt: alert.resolvedAt ?? null,
    meta: safeJsonParse<Record<string, unknown>>(alert.metaJson, {}),
  };
}

export function upsertOpenAlert(params: {
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

export function resolveOpenAlerts(userId: string, controllerId: string, type: string, channelId?: string | null) {
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

export function getOpenAlertsByController(userId: string) {
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
