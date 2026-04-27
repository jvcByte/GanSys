import { and, desc, eq, inArray } from "drizzle-orm";

import { createId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { channels, pestControlSchedules, telemetrySamples } from "@/lib/db/schema";
import type { PestControlSchedule, PestLogEntry, SnapshotPayload } from "@/lib/types";
import { getControllerOwnedByUser } from "./controller.service";

function now() { return new Date(); }

function hydrateSchedule(row: typeof pestControlSchedules.$inferSelect): PestControlSchedule {
  return {
    controllerId: row.controllerId,
    enabled: row.enabled,
    sprayEntries: (row.sprayEntries as Array<{ startTime: string; durationMinutes: number }>) ?? [],
    sprayPumpStartTime: row.sprayPumpStartTime ?? null,
    sprayPumpEndTime: row.sprayPumpEndTime ?? null,
    uvStartTime: row.uvStartTime ?? null,
    uvEndTime: row.uvEndTime ?? null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

export async function getPestSchedule(userId: string, controllerId: string): Promise<PestControlSchedule | null> {
  await getControllerOwnedByUser(userId, controllerId);
  const rows = await db.select().from(pestControlSchedules).where(eq(pestControlSchedules.controllerId, controllerId));
  return rows[0] ? hydrateSchedule(rows[0]) : null;
}

export async function upsertPestSchedule(
  userId: string,
  controllerId: string,
  input: {
    enabled: boolean;
    sprayEntries: Array<{ startTime: string; durationMinutes: number }>;
    sprayPumpStartTime?: string | null;
    sprayPumpEndTime?: string | null;
    uvStartTime?: string | null;
    uvEndTime?: string | null;
  }
): Promise<PestControlSchedule> {
  await getControllerOwnedByUser(userId, controllerId);
  const existing = await db.select().from(pestControlSchedules).where(eq(pestControlSchedules.controllerId, controllerId));
  const timestamp = now();

  if (existing[0]) {
    await db.update(pestControlSchedules).set({
      enabled: input.enabled,
      sprayEntries: input.sprayEntries,
      sprayPumpStartTime: input.sprayPumpStartTime ?? null,
      sprayPumpEndTime: input.sprayPumpEndTime ?? null,
      uvStartTime: input.uvStartTime ?? null,
      uvEndTime: input.uvEndTime ?? null,
      updatedAt: timestamp,
    }).where(eq(pestControlSchedules.controllerId, controllerId));
  } else {
    await db.insert(pestControlSchedules).values({
      id: createId("sched"),
      controllerId,
      enabled: input.enabled,
      sprayEntries: input.sprayEntries,
      sprayPumpStartTime: input.sprayPumpStartTime ?? null,
      sprayPumpEndTime: input.sprayPumpEndTime ?? null,
      uvStartTime: input.uvStartTime ?? null,
      uvEndTime: input.uvEndTime ?? null,
      updatedAt: timestamp,
    });
  }

  const saved = await db.select().from(pestControlSchedules).where(eq(pestControlSchedules.controllerId, controllerId));
  return hydrateSchedule(saved[0]!);
}

export async function getPestControlLog(controllerId: string, limit = 20): Promise<PestLogEntry[]> {
  const pestChannels = await db.select().from(channels).where(
    and(eq(channels.controllerId, controllerId), inArray(channels.template, ["spray_pump", "uv_zapper"]))
  );
  if (!pestChannels.length) return [];

  const channelIds = pestChannels.map((c) => c.id);
  const channelNameById = new Map(pestChannels.map((c) => [c.id, c.name]));

  const samples = await db.select().from(telemetrySamples)
    .where(inArray(telemetrySamples.channelId, channelIds))
    .orderBy(desc(telemetrySamples.recordedAt))
    .limit(limit);

  return samples.map((sample) => {
    let activationType: "manual" | "scheduled" = "manual";
    try {
      const payload = JSON.parse(sample.payloadJson ?? "{}") as Record<string, unknown>;
      if (payload.source === "scheduled") activationType = "scheduled";
    } catch { /* default to manual */ }

    return {
      channelId: sample.channelId,
      channelName: channelNameById.get(sample.channelId) ?? "Unknown",
      activationType,
      booleanState: sample.booleanState ?? false,
      recordedAt: sample.recordedAt instanceof Date ? sample.recordedAt.toISOString() : String(sample.recordedAt),
    };
  });
}

export async function getLatestSnapshots(controllerId: string): Promise<Record<string, SnapshotPayload>> {
  const cameraChannels = await db.select().from(channels).where(
    and(eq(channels.controllerId, controllerId), eq(channels.template, "camera_snapshot"))
  );
  if (!cameraChannels.length) return {};

  const result: Record<string, SnapshotPayload> = {};
  for (const channel of cameraChannels) {
    const rows = await db.select().from(telemetrySamples)
      .where(eq(telemetrySamples.channelId, channel.id))
      .orderBy(desc(telemetrySamples.recordedAt))
      .limit(1);

    if (!rows[0]) continue;
    try {
      const payload = JSON.parse(rows[0].payloadJson ?? "{}") as Record<string, unknown>;
      if (payload.imageUrl || payload.imageBase64) {
        result[channel.id] = {
          imageUrl: typeof payload.imageUrl === "string" ? payload.imageUrl : null,
          imageBase64: typeof payload.imageBase64 === "string" ? payload.imageBase64 : null,
        };
      }
    } catch { /* skip */ }
  }
  return result;
}
