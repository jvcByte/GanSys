import { desc, eq, sql } from "drizzle-orm";

import { createId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { channels, telemetrySamples } from "@/lib/db/schema";
import type { HistoryPoint } from "@/lib/types";
import { getBucketSize, getRangeStart, toJson } from "@/lib/utils";
import { resolveOpenAlerts, upsertOpenAlert } from "./alert.service";
import { getChannelOwnedByUser } from "./channel.service";

function now() { return new Date(); }

export async function getChannelHistory(userId: string, channelId: string, range: "24h" | "7d" | "30d"): Promise<HistoryPoint[]> {
  await getChannelOwnedByUser(userId, channelId);
  const start = getRangeStart(range).toISOString();
  const bucketSec = getBucketSize(range);

  const rows = await db.execute(sql`
    SELECT
      to_timestamp(floor(extract(epoch from recorded_at) / ${bucketSec}) * ${bucketSec}) AS recorded_at,
      AVG(numeric_value) AS numeric_value
    FROM telemetry_samples
    WHERE channel_id = ${channelId}
      AND numeric_value IS NOT NULL
      AND recorded_at >= ${start}::timestamptz
    GROUP BY floor(extract(epoch from recorded_at) / ${bucketSec})
    ORDER BY recorded_at ASC
    LIMIT 300
  `);

  return (rows as Array<{ recorded_at: string; numeric_value: string }>).map((row) => ({
    recordedAt: row.recorded_at,
    numericValue: Number(row.numeric_value),
  }));
}

export async function evaluateThresholdAlerts(
  userId: string, controllerId: string,
  channel: typeof channels.$inferSelect, numericValue: number | null
) {
  if (numericValue === null) return;
  const isCritical =
    (channel.thresholdLow !== null && numericValue < channel.thresholdLow) ||
    (channel.thresholdHigh !== null && numericValue > channel.thresholdHigh);
  const isWarning = !isCritical && (
    (channel.warningLow !== null && numericValue < channel.warningLow) ||
    (channel.warningHigh !== null && numericValue > channel.warningHigh)
  );

  if (isCritical) {
    await upsertOpenAlert({ userId, controllerId, channelId: channel.id, type: "threshold", severity: "critical", title: `${channel.name} crossed a critical threshold`, message: `${channel.name} reported ${numericValue} ${channel.unit}.` });
  } else if (isWarning) {
    await upsertOpenAlert({ userId, controllerId, channelId: channel.id, type: "threshold", severity: "warning", title: `${channel.name} crossed a warning threshold`, message: `${channel.name} reported ${numericValue} ${channel.unit}.` });
  } else {
    await resolveOpenAlerts(userId, controllerId, "threshold", channel.id);
  }
}

export async function evaluateFaultAlerts(
  userId: string, controllerId: string, channel: typeof channels.$inferSelect
) {
  const recent = await db.select().from(telemetrySamples)
    .where(eq(telemetrySamples.channelId, channel.id))
    .orderBy(desc(telemetrySamples.recordedAt))
    .limit(5);

  let fault = false;
  let message = `${channel.name} looks healthy.`;

  if (channel.template === "tank_level" || channel.template === "fish_tank_level") {
    const subset = recent.slice(0, 3);
    fault = subset.length === 3 && subset.every((s) => (s.rawValue ?? -1) === 0 || (s.rawValue ?? 0) > 400);
    message = `${channel.name} returned invalid ultrasonic raw values for 3 consecutive samples.`;
  } else if (channel.template === "soil_moisture") {
    fault = recent.length === 5 && recent.every((s) => s.numericValue === 0 || s.numericValue === 100);
    message = `${channel.name} has been stuck at 0% or 100% for 5 consecutive samples.`;
  }

  if (fault) {
    await upsertOpenAlert({ userId, controllerId, channelId: channel.id, type: "sensor_fault", severity: "critical", title: `${channel.name} sensor fault`, message });
  } else {
    await resolveOpenAlerts(userId, controllerId, "sensor_fault", channel.id);
  }
}

export async function applyReadings(
  userId: string,
  controller: { id: string },
  readings: Array<{
    channelKey: string; numericValue?: number; booleanState?: boolean;
    rawValue?: number; rawUnit?: string; status?: string; payload?: Record<string, unknown>;
  }>
) {
  const allChannels = await db.select().from(channels).where(eq(channels.controllerId, controller.id));
  const channelByKey = new Map(allChannels.map((c) => [c.channelKey, c]));

  for (const reading of readings) {
    const channel = channelByKey.get(reading.channelKey);
    if (!channel) continue;

    const timestamp = now();
    await db.insert(telemetrySamples).values({
      id: createId("sample"),
      channelId: channel.id,
      recordedAt: timestamp,
      numericValue: reading.numericValue ?? null,
      booleanState: reading.booleanState ?? null,
      rawValue: reading.rawValue ?? null,
      rawUnit: reading.rawUnit ?? null,
      status: reading.status ?? "ok",
      payloadJson: toJson(reading.payload ?? {}),
    });

    await db.update(channels).set({
      latestNumericValue: reading.numericValue ?? channel.latestNumericValue,
      latestBooleanState: reading.booleanState ?? channel.latestBooleanState,
      latestStatus: reading.status ?? "ok",
      lastSampleAt: timestamp,
      updatedAt: timestamp,
    }).where(eq(channels.id, channel.id));

    const updated = await db.select().from(channels).where(eq(channels.id, channel.id));
    if (updated[0]) {
      await evaluateThresholdAlerts(userId, controller.id, updated[0], reading.numericValue ?? null);
      await evaluateFaultAlerts(userId, controller.id, updated[0]);
    }
  }
}
