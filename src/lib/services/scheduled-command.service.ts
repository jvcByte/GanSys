import { and, eq, gte, lte } from "drizzle-orm";

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

/**
 * Process scheduled commands that are due for execution.
 * This should be called periodically by a background worker.
 */
export async function processDueScheduledCommands() {
  const currentTime = now();

  // Find all pending scheduled commands that are due
  const dueCommands = await db
    .select({
      scheduledCommand: scheduledCommands,
      channel: channels,
    })
    .from(scheduledCommands)
    .innerJoin(channels, eq(scheduledCommands.channelId, channels.id))
    .where(
      and(
        eq(scheduledCommands.status, "pending"),
        lte(scheduledCommands.scheduledFor, currentTime)
      )
    );

  const results = {
    processed: 0,
    succeeded: 0,
    failed: 0,
  };

  for (const { scheduledCommand, channel } of dueCommands) {
    results.processed++;

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

      // Mark scheduled command as executed
      await db
        .update(scheduledCommands)
        .set({
          status: "executed",
          executedAt: currentTime,
          executedCommandId: command.id,
        })
        .where(eq(scheduledCommands.id, scheduledCommand.id));

      results.succeeded++;
      console.log(`[ScheduledCommand] Executed scheduled command ${scheduledCommand.id} for channel ${channel.name}`);
    } catch (error) {
      // Mark as failed
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await db
        .update(scheduledCommands)
        .set({
          status: "failed",
          executedAt: currentTime,
          failureReason: errorMessage,
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
