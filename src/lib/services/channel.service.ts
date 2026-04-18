import { and, eq, sql } from "drizzle-orm";

import { createId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { channels, controllers } from "@/lib/db/schema";
import { getTemplate } from "@/lib/templates";
import type { ChannelView } from "@/lib/types";
import { safeJsonParse, toJson } from "@/lib/utils";

type ChannelInput = {
  channelKey?: string; name?: string; template?: string; kind?: string;
  unit?: string; minValue?: number; maxValue?: number;
  thresholdLow?: number | null; thresholdHigh?: number | null;
  warningLow?: number | null; warningHigh?: number | null;
  config?: Record<string, unknown>; calibration?: Record<string, unknown>;
};

function now() { return new Date(); }

export function hydrateChannel(channel: typeof channels.$inferSelect) {
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
    lastSampleAt: channel.lastSampleAt ? (channel.lastSampleAt instanceof Date ? channel.lastSampleAt.toISOString() : String(channel.lastSampleAt)) : null,
    thresholdLow: channel.thresholdLow ?? null,
    thresholdHigh: channel.thresholdHigh ?? null,
    warningLow: channel.warningLow ?? null,
    warningHigh: channel.warningHigh ?? null,
    config: safeJsonParse<Record<string, unknown>>(channel.configJson, {}),
    calibration: safeJsonParse<Record<string, unknown>>(channel.calibrationJson, {}),
    sortOrder: channel.sortOrder,
  } as const;
}

export async function getChannelOwnedByUser(userId: string, channelId: string) {
  const rows = await db.select({ channel: channels, userId: controllers.userId })
    .from(channels)
    .innerJoin(controllers, eq(controllers.id, channels.controllerId))
    .where(eq(channels.id, channelId));

  if (!rows[0] || rows[0].userId !== userId) throw new Error("Channel not found.");
  return rows[0].channel;
}

export async function createChannel(userId: string, controllerId: string, input: ChannelInput) {
  const template = getTemplate(input.template ?? "custom");
  const channelKey = input.channelKey?.trim();
  if (!channelKey) throw new Error("Channel key is required.");

  const existing = await db.select().from(channels)
    .where(and(eq(channels.controllerId, controllerId), eq(channels.channelKey, channelKey)));
  if (existing[0]) throw new Error("That channel key already exists on this controller.");

  const countRows = await db.select({ value: sql<number>`count(*)` }).from(channels).where(eq(channels.controllerId, controllerId));
  const sortOrder = Number(countRows[0]?.value ?? 0);
  const channelId = createId("channel");
  const timestamp = now();

  await db.insert(channels).values({
    id: channelId, controllerId, channelKey,
    name: input.name?.trim() || template.label,
    template: template.id,
    kind: input.kind ?? template.kind,
    unit: input.unit?.trim() || template.unit,
    minValue: input.minValue ?? template.minValue,
    maxValue: input.maxValue ?? template.maxValue,
    latestNumericValue: null, latestBooleanState: null,
    latestStatus: "unknown", lastSampleAt: null,
    thresholdLow: input.thresholdLow ?? template.thresholdLow,
    thresholdHigh: input.thresholdHigh ?? template.thresholdHigh,
    warningLow: input.warningLow ?? template.warningLow,
    warningHigh: input.warningHigh ?? template.warningHigh,
    configJson: toJson(input.config ?? template.config),
    calibrationJson: toJson(input.calibration ?? template.calibration),
    sortOrder, createdAt: timestamp, updatedAt: timestamp,
  });

  const rows = await db.select().from(channels).where(eq(channels.id, channelId));
  return hydrateChannel(rows[0]!);
}

export async function updateChannel(userId: string, channelId: string, input: ChannelInput) {
  const channel = await getChannelOwnedByUser(userId, channelId);

  if (input.channelKey && input.channelKey.trim() !== channel.channelKey) {
    const conflict = await db.select().from(channels)
      .where(and(eq(channels.controllerId, channel.controllerId), eq(channels.channelKey, input.channelKey.trim())));
    if (conflict[0]) throw new Error("That channel key already exists on this controller.");
  }

  await db.update(channels).set({
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
    updatedAt: now(),
  }).where(eq(channels.id, channel.id));

  const rows = await db.select().from(channels).where(eq(channels.id, channel.id));
  return hydrateChannel(rows[0]!);
}

export async function deleteChannel(userId: string, channelId: string) {
  await getChannelOwnedByUser(userId, channelId);
  await db.delete(channels).where(eq(channels.id, channelId));
  return { ok: true };
}
