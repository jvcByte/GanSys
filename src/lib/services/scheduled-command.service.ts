import { and, eq, inArray, lt, lte } from "drizzle-orm";

import { createId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { channels, scheduledCommands } from "@/lib/db/schema";
import type { ScheduledCommandView } from "@/lib/types";
import { getChannelOwnedByUser } from "./channel.service";
import { getControllerOwnedByUser } from "./controller.service";
import { createManualCommand } from "./command.service";

function now() { return new Date(); }

export function hydrateScheduledCommand(
  scheduledCommand: typeof scheduledCommands.$inferSelect,
  channelName: string
): ScheduledCommandView {
  return {
    id: scheduledCommand.id,
    controllerId: scheduledCommand.controllerId,
    channelId: scheduledCommand.channelId,
    channelName,
    commandType: scheduledCommand.commandType,
    desiredBooleanState: scheduledCommand.desiredBooleanState ?? null,
    desiredNumericValue: scheduledCommand.desiredNumericValue ?? null,
    note: scheduledCommand.note,
    scheduledFor: scheduledCommand.scheduledFor instanceof Date 
      ? scheduledCommand.scheduledFor.toISOString() 
      : String(scheduledCommand.scheduledFor),
    status: scheduledCommand.status,
    executedCommandId: scheduledCommand.executedCommandId ?? null,
    createdAt: scheduledCommand.createdAt instanceof Date 
      ? scheduledCommand.createdAt.toISOString() 
      : String(scheduledCommand.createdAt),
    executedAt: scheduledCommand.executedAt 
      ? (scheduledCommand.executedAt instanceof Date 
        ? scheduledCommand.executedAt.toISOString() 
        : String(scheduledCommand.executedAt)) 
      : null,
    cancelledAt: scheduledCommand.cancelledAt 
      ? (scheduledCommand.cancelledAt instanceof Date 
        ? scheduledCommand.cancelledAt.toISOString() 
        : String(scheduledCommand.cancelledAt)) 
      : null,
    failureReason: scheduledCommand.failureReason ?? null,
  };
}

export async function createScheduledCommand(
  userId: string,
  channelId: string,
  input: {
    desiredBooleanState?: boolean;
    desiredNumericValue?: number;
    note?: string;
    scheduledFor: Date;
  }
) {
  const channel = await getChannelOwnedByUser(userId, channelId);
  const controller = await getControllerOwnedByUser(userId, channel.controllerId);

  // Validate scheduled time is in the future
  if (input.scheduledFor <= now()) {
    throw new Error("Scheduled time must be in the future.");
  }

  const scheduledCommandId = createId("schcmd");
  await db.insert(scheduledCommands).values({
    id: scheduledCommandId,
    controllerId: controller.id,
    channelId: channel.id,
    requestedByUserId: userId,
    commandType: input.desiredNumericValue !== undefined ? "set_value" : "set_state",
    desiredBooleanState: input.desiredBooleanState ?? null,
    desiredNumericValue: input.desiredNumericValue ?? null,
    note: input.note?.trim() ?? "",
    scheduledFor: input.scheduledFor,
    status: "pending",
    createdAt: now(),
    executedAt: null,
    cancelledAt: null,
    executedCommandId: null,
    failureReason: null,
  });

  const rows = await db.select().from(scheduledCommands).where(eq(scheduledCommands.id, scheduledCommandId));
  return hydrateScheduledCommand(rows[0]!, channel.name);
}

export async function getScheduledCommandsByController(
  userId: string,
  controllerId: string
): Promise<ScheduledCommandView[]> {
  await getControllerOwnedByUser(userId, controllerId);

  const rows = await db
    .select({
      scheduledCommand: scheduledCommands,
      channel: channels,
    })
    .from(scheduledCommands)
    .innerJoin(channels, eq(scheduledCommands.channelId, channels.id))
    .where(eq(scheduledCommands.controllerId, controllerId))
    .orderBy(scheduledCommands.scheduledFor);

  return rows.map((row) => hydrateScheduledCommand(row.scheduledCommand, row.channel.name));
}

export async function cancelScheduledCommand(userId: string, scheduledCommandId: string) {
  const rows = await db
    .select({
      scheduledCommand: scheduledCommands,
      channel: channels,
    })
    .from(scheduledCommands)
    .innerJoin(channels, eq(scheduledCommands.channelId, channels.id))
    .where(eq(scheduledCommands.id, scheduledCommandId));

  const row = rows[0];
  if (!row) {
    throw new Error("Scheduled command not found.");
  }

  // Verify ownership
  await getControllerOwnedByUser(userId, row.scheduledCommand.controllerId);

  if (row.scheduledCommand.status !== "pending") {
    throw new Error("Only pending scheduled commands can be cancelled.");
  }

  await db
    .update(scheduledCommands)
    .set({ status: "cancelled", cancelledAt: now() })
    .where(eq(scheduledCommands.id, scheduledCommandId));

  return hydrateScheduledCommand(
    { ...row.scheduledCommand, status: "cancelled", cancelledAt: now() },
    row.channel.name
  );
}

const CLAIM_BATCH_LIMIT = 50;
const CLAIM_LEASE_MINUTES = 5;

/**
 * Process scheduled commands that are due for execution.
 * This should be called periodically by a background worker.
 *
 * Rows are claimed atomically: an UPDATE with a conditional status transition
 * (pending -> processing) plus a lease ensures concurrent scheduler instances
 * or overlapping runs never execute the same scheduled command twice.
 */
export async function processDueScheduledCommands() {
  const currentTime = now();

  // Recover rows whose lease expired (a previous worker crashed mid-execution).
  await db.update(scheduledCommands)
    .set({ status: "pending", leaseUntil: null })
    .where(and(
      eq(scheduledCommands.status, "processing"),
      lt(scheduledCommands.leaseUntil, currentTime)
    ));

  // Select a bounded batch of due rows.
  const dueIds = await db.select({ id: scheduledCommands.id })
    .from(scheduledCommands)
    .where(and(
      eq(scheduledCommands.status, "pending"),
      lte(scheduledCommands.scheduledFor, currentTime)
    ))
    .limit(CLAIM_BATCH_LIMIT);

  if (!dueIds.length) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  // Atomically claim the rows. Only the run whose UPDATE matches status='pending'
  // receives rows back; concurrent runs claim nothing for already-claimed rows.
  const leaseUntil = new Date(currentTime.getTime() + CLAIM_LEASE_MINUTES * 60 * 1000);
  const claimed = await db.update(scheduledCommands)
    .set({ status: "processing", leaseUntil })
    .where(and(
      inArray(scheduledCommands.id, dueIds.map((row) => row.id)),
      eq(scheduledCommands.status, "pending")
    ))
    .returning();

  const results = {
    processed: claimed.length,
    succeeded: 0,
    failed: 0,
  };

  if (!claimed.length) return results;

  // Resolve channel names for logging.
  const channelRows = await db.select().from(channels)
    .where(inArray(channels.id, [...new Set(claimed.map((row) => row.channelId))]));
  const channelNameById = new Map(channelRows.map((c) => [c.id, c.name]));

  for (const scheduledCommand of claimed) {
    try {
      // Create the actual command
      const command = await createManualCommand(
        scheduledCommand.requestedByUserId,
        scheduledCommand.channelId,
        {
          desiredBooleanState: scheduledCommand.desiredBooleanState ?? undefined,
          desiredNumericValue: scheduledCommand.desiredNumericValue ?? undefined,
          note: scheduledCommand.note || `Scheduled command executed at ${currentTime.toISOString()}`,
          overrideMinutes: 2,
        }
      );

      // Mark scheduled command as executed and release the lease
      await db
        .update(scheduledCommands)
        .set({
          status: "executed",
          executedAt: currentTime,
          executedCommandId: command.id,
          leaseUntil: null,
        })
        .where(eq(scheduledCommands.id, scheduledCommand.id));

      results.succeeded++;
      console.log(`[ScheduledCommand] Executed scheduled command ${scheduledCommand.id} for channel ${channelNameById.get(scheduledCommand.channelId) ?? scheduledCommand.channelId}`);
    } catch (error) {
      // Mark as failed and release the lease
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await db
        .update(scheduledCommands)
        .set({
          status: "failed",
          executedAt: currentTime,
          failureReason: errorMessage,
          leaseUntil: null,
        })
        .where(eq(scheduledCommands.id, scheduledCommand.id));

      results.failed++;
      console.error(`[ScheduledCommand] Failed to execute scheduled command ${scheduledCommand.id}:`, error);
    }
  }

  return results;
}

/**
 * Clean up old scheduled commands (executed, cancelled, or failed) older than 30 days
 */
export async function cleanupOldScheduledCommands() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const result = await db
    .delete(scheduledCommands)
    .where(
      and(
        eq(scheduledCommands.status, "executed"),
        lte(scheduledCommands.executedAt, thirtyDaysAgo)
      )
    );

  return result;
}
