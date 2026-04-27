import { processDueScheduledCommands, cleanupOldScheduledCommands } from "./services/scheduled-command.service";
import { processAutoSchedules } from "./services/auto-schedule.service";

let schedulerInterval: NodeJS.Timeout | null = null;
let autoScheduleInterval: NodeJS.Timeout | null = null;
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Start the background scheduler that processes due scheduled commands.
 * Runs every 30 seconds to check for commands that need to be executed.
 */
export function startScheduler() {
  if (schedulerInterval) {
    console.log("[Scheduler] Already running");
    return;
  }

  console.log("[Scheduler] Starting scheduled command processor");

  // Process immediately on startup
  void processDueScheduledCommands().then((results) => {
    console.log(`[Scheduler] Initial run: processed=${results.processed}, succeeded=${results.succeeded}, failed=${results.failed}`);
  });

  // Process auto-schedules immediately
  void processAutoSchedules().then((results) => {
    console.log(`[Scheduler] Initial auto-schedule: created ${results.total} commands`);
  });

  // Then run every 30 seconds
  schedulerInterval = setInterval(() => {
    void processDueScheduledCommands().then((results) => {
      if (results.processed > 0) {
        console.log(`[Scheduler] Processed ${results.processed} commands: succeeded=${results.succeeded}, failed=${results.failed}`);
        
        // After executing commands, check if we need to create new auto-schedule commands
        void processAutoSchedules().catch((error) => {
          console.error("[Scheduler] Error processing auto-schedules after command execution:", error);
        });
      }
    }).catch((error) => {
      console.error("[Scheduler] Error processing scheduled commands:", error);
    });
  }, 30_000); // 30 seconds

  // Process auto-schedules every hour to ensure they're always set
  autoScheduleInterval = setInterval(() => {
    void processAutoSchedules().then((results) => {
      if (results.total > 0) {
        console.log(`[Scheduler] Hourly auto-schedule check: created ${results.total} commands`);
      }
    }).catch((error) => {
      console.error("[Scheduler] Error in hourly auto-schedule check:", error);
    });
  }, 60 * 60 * 1000); // 1 hour

  // Cleanup old commands once per day
  cleanupInterval = setInterval(() => {
    void cleanupOldScheduledCommands().then(() => {
      console.log("[Scheduler] Cleaned up old scheduled commands");
    }).catch((error) => {
      console.error("[Scheduler] Error cleaning up old commands:", error);
    });
  }, 24 * 60 * 60 * 1000); // 24 hours
}

/**
 * Stop the background scheduler.
 */
export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[Scheduler] Stopped");
  }

  if (autoScheduleInterval) {
    clearInterval(autoScheduleInterval);
    autoScheduleInterval = null;
  }

  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

// Auto-start in production
if (process.env.NODE_ENV === "production") {
  startScheduler();
}

// For development, start manually or via hot reload
if (process.env.NODE_ENV === "development") {
  // Use a global flag to prevent multiple instances during hot reload
  if (!(global as any).__schedulerStarted) {
    startScheduler();
    (global as any).__schedulerStarted = true;
  }
}
