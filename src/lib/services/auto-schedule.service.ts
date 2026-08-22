/**
 * Auto-schedule service for handling daily recurring schedules
 * (spray pump auto on/off, UV zapper windows, etc.)
 * 
 * This creates scheduled commands for the next occurrence of each schedule.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { channels, controllers, pestControlSchedules, scheduledCommands } from "@/lib/db/schema";
import { createId } from "@/lib/auth";

function now() { return new Date(); }

/**
 * Idempotency key for auto-generated commands: one row per channel/state/date.
 * The unique index on occurrence_key prevents concurrent duplicate inserts.
 */
function occurrenceKeyFor(channelId: string, desiredBooleanState: boolean, scheduledFor: Date): string {
  const date = scheduledFor.toISOString().slice(0, 10);
  return `${channelId}:${desiredBooleanState}:${date}`;
}

function buildAutoCommandValues(
  controllerId: string,
  channelId: string,
  requestedByUserId: string,
  desiredBooleanState: boolean,
  note: string,
  scheduledFor: Date
) {
  return {
    id: createId("schcmd"),
    controllerId,
    channelId,
    requestedByUserId,
    commandType: "set_state",
    desiredBooleanState,
    desiredNumericValue: null,
    note,
    scheduledFor,
    status: "pending",
    createdAt: now(),
    executedAt: null,
    cancelledAt: null,
    executedCommandId: null,
    failureReason: null,
    occurrenceKey: occurrenceKeyFor(channelId, desiredBooleanState, scheduledFor),
  };
}

/**
 * Parse "HH:MM" time string and return Date for today (or tomorrow if time has passed)
 */
function getNextOccurrence(timeString: string): Date {
  const [hours, minutes] = timeString.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  
  // If time has already passed today, schedule for tomorrow
  if (date <= now()) {
    date.setDate(date.getDate() + 1);
  }
  
  return date;
}

/**
 * Create scheduled commands for spray pump auto on/off times
 */
async function scheduleSprayPumpAutoCommands() {
  const schedules = await db
    .select({
      schedule: pestControlSchedules,
      controller: controllers,
    })
    .from(pestControlSchedules)
    .innerJoin(controllers, eq(pestControlSchedules.controllerId, controllers.id))
    .where(eq(pestControlSchedules.enabled, true));

  let created = 0;

  for (const { schedule, controller } of schedules) {
    if (!schedule.sprayPumpStartTime && !schedule.sprayPumpEndTime) continue;

    // Find spray pump channel
    const sprayChannels = await db
      .select()
      .from(channels)
      .where(eq(channels.controllerId, controller.id));
    
    const sprayPump = sprayChannels.find((c) => c.template === "spray_pump");
    if (!sprayPump) continue;

    // Check if we already have pending scheduled commands for today/tomorrow
    const existingCommands = await db
      .select()
      .from(scheduledCommands)
      .where(eq(scheduledCommands.channelId, sprayPump.id));

    const hasPendingStart = existingCommands.some(
      (cmd) => 
        cmd.status === "pending" && 
        cmd.desiredBooleanState === true &&
        cmd.note.includes("Auto-schedule: Turn on")
    );

    const hasPendingEnd = existingCommands.some(
      (cmd) => 
        cmd.status === "pending" && 
        cmd.desiredBooleanState === false &&
        cmd.note.includes("Auto-schedule: Turn off")
    );

    // Create start command if needed
    if (schedule.sprayPumpStartTime && !hasPendingStart) {
      const scheduledFor = getNextOccurrence(schedule.sprayPumpStartTime);
      
      await db.insert(scheduledCommands)
        .values(buildAutoCommandValues(
          controller.id, sprayPump.id, controller.userId, true,
          `Auto-schedule: Turn on at ${schedule.sprayPumpStartTime}`, scheduledFor
        ))
        .onConflictDoNothing();

      created++;
      console.log(`[AutoSchedule] Created spray pump ON command for ${controller.name} at ${scheduledFor.toISOString()}`);
    }

    // Create end command if needed
    if (schedule.sprayPumpEndTime && !hasPendingEnd) {
      const scheduledFor = getNextOccurrence(schedule.sprayPumpEndTime);
      
      await db.insert(scheduledCommands)
        .values(buildAutoCommandValues(
          controller.id, sprayPump.id, controller.userId, false,
          `Auto-schedule: Turn off at ${schedule.sprayPumpEndTime}`, scheduledFor
        ))
        .onConflictDoNothing();

      created++;
      console.log(`[AutoSchedule] Created spray pump OFF command for ${controller.name} at ${scheduledFor.toISOString()}`);
    }
  }

  return created;
}

/**
 * Create scheduled commands for UV zapper auto on/off times
 */
async function scheduleUvZapperAutoCommands() {
  const schedules = await db
    .select({
      schedule: pestControlSchedules,
      controller: controllers,
    })
    .from(pestControlSchedules)
    .innerJoin(controllers, eq(pestControlSchedules.controllerId, controllers.id))
    .where(eq(pestControlSchedules.enabled, true));

  let created = 0;

  for (const { schedule, controller } of schedules) {
    if (!schedule.uvStartTime && !schedule.uvEndTime) continue;

    // Find UV zapper channel
    const uvChannels = await db
      .select()
      .from(channels)
      .where(eq(channels.controllerId, controller.id));
    
    const uvZapper = uvChannels.find((c) => c.template === "uv_zapper");
    if (!uvZapper) continue;

    // Check if we already have pending scheduled commands
    const existingCommands = await db
      .select()
      .from(scheduledCommands)
      .where(eq(scheduledCommands.channelId, uvZapper.id));

    const hasPendingStart = existingCommands.some(
      (cmd) => 
        cmd.status === "pending" && 
        cmd.desiredBooleanState === true &&
        cmd.note.includes("Auto-schedule: Turn on")
    );

    const hasPendingEnd = existingCommands.some(
      (cmd) => 
        cmd.status === "pending" && 
        cmd.desiredBooleanState === false &&
        cmd.note.includes("Auto-schedule: Turn off")
    );

    // Create start command if needed
    if (schedule.uvStartTime && !hasPendingStart) {
      const scheduledFor = getNextOccurrence(schedule.uvStartTime);
      
      await db.insert(scheduledCommands)
        .values(buildAutoCommandValues(
          controller.id, uvZapper.id, controller.userId, true,
          `Auto-schedule: Turn on at ${schedule.uvStartTime}`, scheduledFor
        ))
        .onConflictDoNothing();

      created++;
      console.log(`[AutoSchedule] Created UV zapper ON command for ${controller.name} at ${scheduledFor.toISOString()}`);
    }

    // Create end command if needed
    if (schedule.uvEndTime && !hasPendingEnd) {
      const scheduledFor = getNextOccurrence(schedule.uvEndTime);
      
      await db.insert(scheduledCommands)
        .values(buildAutoCommandValues(
          controller.id, uvZapper.id, controller.userId, false,
          `Auto-schedule: Turn off at ${schedule.uvEndTime}`, scheduledFor
        ))
        .onConflictDoNothing();

      created++;
      console.log(`[AutoSchedule] Created UV zapper OFF command for ${controller.name} at ${scheduledFor.toISOString()}`);
    }
  }

  return created;
}

/**
 * Cancel pending auto-generated commands for a controller. Used when a pest
 * schedule changes or is disabled so old generated commands stop firing.
 * Manually-created commands (no "Auto-schedule:" note prefix) are preserved.
 */
export async function cancelPendingAutoCommands(controllerId: string) {
  await db.update(scheduledCommands)
    .set({ status: "cancelled", cancelledAt: now() })
    .where(and(
      eq(scheduledCommands.controllerId, controllerId),
      eq(scheduledCommands.status, "pending"),
      sql`${scheduledCommands.note} LIKE 'Auto-schedule:%'`
    ));
}

/**
 * Process all auto-schedules and create scheduled commands for the next occurrence
 * This should be called:
 * 1. When a pest schedule is updated
 * 2. Periodically (e.g., once per hour) to ensure schedules are always set
 * 3. After a scheduled command is executed (to create the next day's command)
 */
export async function processAutoSchedules() {
  try {
    const sprayCommands = await scheduleSprayPumpAutoCommands();
    const uvCommands = await scheduleUvZapperAutoCommands();
    
    const total = sprayCommands + uvCommands;
    if (total > 0) {
      console.log(`[AutoSchedule] Created ${total} auto-schedule commands (spray: ${sprayCommands}, uv: ${uvCommands})`);
    }
    
    return { sprayCommands, uvCommands, total };
  } catch (error) {
    console.error("[AutoSchedule] Error processing auto-schedules:", error);
    throw error;
  }
}
