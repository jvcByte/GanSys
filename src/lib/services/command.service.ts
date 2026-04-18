import { addMinutes } from "date-fns";
import { and, eq } from "drizzle-orm";

import { createId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { channels, commands } from "@/lib/db/schema";
import type { CommandView } from "@/lib/types";
import { resolveOpenAlerts, upsertOpenAlert } from "./alert.service";
import { computeControllerStatus, getControllerOwnedByUser } from "./controller.service";
import { getChannelOwnedByUser } from "./channel.service";

function now() { return new Date(); }

export function hydrateCommand(command: typeof commands.$inferSelect): CommandView {
  return {
    id: command.id,
    channelId: command.channelId,
    commandType: command.commandType,
    desiredBooleanState: command.desiredBooleanState ?? null,
    desiredNumericValue: command.desiredNumericValue ?? null,
    note: command.note,
    status: command.status,
    overrideUntil: command.overrideUntil ? (command.overrideUntil instanceof Date ? command.overrideUntil.toISOString() : String(command.overrideUntil)) : null,
    createdAt: command.createdAt instanceof Date ? command.createdAt.toISOString() : String(command.createdAt),
    acknowledgedAt: command.acknowledgedAt ? (command.acknowledgedAt instanceof Date ? command.acknowledgedAt.toISOString() : String(command.acknowledgedAt)) : null,
    deviceMessage: command.deviceMessage ?? null,
  };
}

export async function createManualCommand(
  userId: string,
  channelId: string,
  input: { desiredBooleanState?: boolean; desiredNumericValue?: number; note?: string; overrideMinutes?: number }
) {
  const channel = await getChannelOwnedByUser(userId, channelId);
  const controller = await getControllerOwnedByUser(userId, channel.controllerId);

  if (computeControllerStatus(controller.lastSeenAt ? (controller.lastSeenAt instanceof Date ? controller.lastSeenAt.toISOString() : String(controller.lastSeenAt)) : null, controller.heartbeatIntervalSec) === "offline") {
    throw new Error("Controller is offline. Manual commands are disabled.");
  }

  const commandId = createId("cmd");
  await db.insert(commands).values({
    id: commandId,
    controllerId: controller.id,
    channelId: channel.id,
    requestedByUserId: userId,
    commandType: input.desiredNumericValue !== undefined ? "set_value" : "set_state",
    desiredBooleanState: input.desiredBooleanState ?? null,
    desiredNumericValue: input.desiredNumericValue ?? null,
    note: input.note?.trim() ?? "",
    status: "pending",
    overrideUntil: addMinutes(now(), input.overrideMinutes ?? 2),
    createdAt: now(),
    acknowledgedAt: null,
    deviceMessage: null,
  });

  await upsertOpenAlert({
    userId, controllerId: controller.id, channelId: channel.id,
    type: "manual_override", severity: "info",
    title: `Manual override queued for ${channel.name}`,
    message: `A control command has been queued for ${channel.name}.`,
  });

  const rows = await db.select().from(commands).where(eq(commands.id, commandId));
  return hydrateCommand(rows[0]!);
}

export async function applyAcknowledgements(
  userId: string,
  controllerId: string,
  acknowledgements: Array<{ commandId: string; status: string; executedAt?: string; deviceMessage?: string }>
) {
  for (const ack of acknowledgements) {
    const rows = await db.select().from(commands)
      .where(and(eq(commands.id, ack.commandId), eq(commands.controllerId, controllerId)));
    const command = rows[0];
    if (!command) continue;

    const ackedAt = ack.executedAt ? new Date(ack.executedAt) : now();
    await db.update(commands)
      .set({ status: ack.status, acknowledgedAt: ackedAt, deviceMessage: ack.deviceMessage ?? null })
      .where(eq(commands.id, command.id));

    if (ack.status === "acknowledged") {
      if (command.desiredBooleanState !== null) {
        await db.update(channels).set({
          latestBooleanState: command.desiredBooleanState,
          latestNumericValue: command.desiredBooleanState ? 1 : 0,
          latestStatus: "ok",
          lastSampleAt: ackedAt,
          updatedAt: now(),
        }).where(eq(channels.id, command.channelId));
      }
      await resolveOpenAlerts(userId, controllerId, "manual_override", command.channelId);
      await resolveOpenAlerts(userId, controllerId, "command_failure", command.channelId);
    } else {
      await upsertOpenAlert({
        userId, controllerId, channelId: command.channelId,
        type: "command_failure", severity: "warning",
        title: "Manual command failed",
        message: ack.deviceMessage ?? "The controller did not acknowledge the command successfully.",
      });
    }
  }
}

export async function expirePendingCommands(controllerId: string, userId: string) {
  const pending = await db.select().from(commands)
    .where(and(eq(commands.controllerId, controllerId), eq(commands.status, "pending")));

  for (const command of pending) {
    const overrideUntil = command.overrideUntil instanceof Date ? command.overrideUntil : command.overrideUntil ? new Date(String(command.overrideUntil)) : null;
    if (!overrideUntil || overrideUntil > now()) continue;

    await db.update(commands)
      .set({ status: "expired", acknowledgedAt: now(), deviceMessage: "Command expired before execution." })
      .where(eq(commands.id, command.id));

    await upsertOpenAlert({
      userId, controllerId, channelId: command.channelId,
      type: "command_failure", severity: "warning",
      title: "Command expired",
      message: "A pending manual command expired before the controller executed it.",
    });
  }
}
