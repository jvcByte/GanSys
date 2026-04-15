import { addMinutes } from "date-fns";
import { and, eq } from "drizzle-orm";

import { createId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { channels, commands, controllers } from "@/lib/db/schema";
import type { CommandView } from "@/lib/types";
import { resolveOpenAlerts, upsertOpenAlert } from "./alert.service";
import { computeControllerStatus, getControllerOwnedByUser } from "./controller.service";
import { getChannelOwnedByUser } from "./channel.service";

function nowIso() {
  return new Date().toISOString();
}

export function hydrateCommand(command: typeof commands.$inferSelect): CommandView {
  return {
    id: command.id,
    channelId: command.channelId,
    commandType: command.commandType,
    desiredBooleanState: command.desiredBooleanState ?? null,
    desiredNumericValue: command.desiredNumericValue ?? null,
    note: command.note,
    status: command.status,
    overrideUntil: command.overrideUntil ?? null,
    createdAt: command.createdAt,
    acknowledgedAt: command.acknowledgedAt ?? null,
    deviceMessage: command.deviceMessage ?? null,
  };
}

export function createManualCommand(
  userId: string,
  channelId: string,
  input: { desiredBooleanState?: boolean; desiredNumericValue?: number; note?: string; overrideMinutes?: number }
) {
  const channel = getChannelOwnedByUser(userId, channelId);
  const controller = getControllerOwnedByUser(userId, channel.controllerId);
  if (computeControllerStatus(controller.lastSeenAt ?? null, controller.heartbeatIntervalSec) === "offline") {
    throw new Error("Controller is offline. Manual commands are disabled.");
  }

  const commandId = createId("cmd");
  db.insert(commands)
    .values({
      id: commandId,
      controllerId: controller.id,
      channelId: channel.id,
      requestedByUserId: userId,
      commandType: input.desiredNumericValue !== undefined ? "set_value" : "set_state",
      desiredBooleanState: input.desiredBooleanState ?? null,
      desiredNumericValue: input.desiredNumericValue ?? null,
      note: input.note?.trim() ?? "",
      status: "pending",
      overrideUntil: addMinutes(new Date(), input.overrideMinutes ?? 2).toISOString(),
      createdAt: nowIso(),
      acknowledgedAt: null,
      deviceMessage: null,
    })
    .run();

  upsertOpenAlert({
    userId,
    controllerId: controller.id,
    channelId: channel.id,
    type: "manual_override",
    severity: "info",
    title: `Manual override queued for ${channel.name}`,
    message: `A control command has been queued for ${channel.name}.`,
  });

  return hydrateCommand(db.select().from(commands).where(eq(commands.id, commandId)).get()!);
}

export function applyAcknowledgements(userId: string, controllerId: string, acknowledgements: Array<{ commandId: string; status: string; executedAt?: string; deviceMessage?: string }>) {
  for (const acknowledgement of acknowledgements) {
    const command = db
      .select()
      .from(commands)
      .where(and(eq(commands.id, acknowledgement.commandId), eq(commands.controllerId, controllerId)))
      .get();
    if (!command) continue;

    db.update(commands)
      .set({
        status: acknowledgement.status,
        acknowledgedAt: acknowledgement.executedAt ?? nowIso(),
        deviceMessage: acknowledgement.deviceMessage ?? null,
      })
      .where(eq(commands.id, command.id))
      .run();

    if (acknowledgement.status === "acknowledged") {
      if (command.desiredBooleanState !== null) {
        db.update(channels)
          .set({
            latestBooleanState: command.desiredBooleanState,
            latestNumericValue: command.desiredBooleanState ? 1 : 0,
            latestStatus: "ok",
            lastSampleAt: acknowledgement.executedAt ?? nowIso(),
            updatedAt: nowIso(),
          })
          .where(eq(channels.id, command.channelId))
          .run();
      }
      resolveOpenAlerts(userId, controllerId, "manual_override", command.channelId);
      resolveOpenAlerts(userId, controllerId, "command_failure", command.channelId);
    } else {
      upsertOpenAlert({
        userId,
        controllerId,
        channelId: command.channelId,
        type: "command_failure",
        severity: "warning",
        title: "Manual command failed",
        message: acknowledgement.deviceMessage ?? "The controller did not acknowledge the command successfully.",
      });
    }
  }
}

export function expirePendingCommands(controllerId: string, userId: string) {
  const pending = db
    .select()
    .from(commands)
    .where(and(eq(commands.controllerId, controllerId), eq(commands.status, "pending")))
    .all();

  for (const command of pending) {
    if (!command.overrideUntil || new Date(command.overrideUntil) > new Date()) continue;
    db.update(commands)
      .set({ status: "expired", acknowledgedAt: nowIso(), deviceMessage: "Command expired before execution." })
      .where(eq(commands.id, command.id))
      .run();
    upsertOpenAlert({
      userId,
      controllerId,
      channelId: command.channelId,
      type: "command_failure",
      severity: "warning",
      title: "Command expired",
      message: "A pending manual command expired before the controller executed it.",
    });
  }
}
