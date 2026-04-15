import { and, eq, sql } from "drizzle-orm";

import { createId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { channels, controllers } from "@/lib/db/schema";
import { getTemplate } from "@/lib/templates";
import type { ChannelView } from "@/lib/types";
import { safeJsonParse, toJson } from "@/lib/utils";

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

function nowIso() {
  return new Date().toISOString();
}

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

export function getChannelOwnedByUser(userId: string, channelId: string) {
  const row = db
    .select({ channel: channels, userId: controllers.userId })
    .from(channels)
    .innerJoin(controllers, eq(controllers.id, channels.controllerId))
    .where(eq(channels.id, channelId))
    .get();

  if (!row || row.userId !== userId) {
    throw new Error("Channel not found.");
  }
  return row.channel;
}

export function createChannel(userId: string, controllerId: string, input: Partial<ChannelInput>) {
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
    if (db.select().from(channels).where(and(eq(channels.controllerId, channel.controllerId), eq(channels.channelKey, input.channelKey.trim()))).get()) {
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
