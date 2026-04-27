import { processDueScheduledCommands, cleanupOldScheduledCommands } from "./services/scheduled-command.service";

let schedulerInterval: NodeJS.Timeout | null = null;
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

  // Then run every 30 seconds
  schedulerInterval = setInterval(() => {
    void processDueScheduledCommands().then((results) => {
      if (results.processed > 0) {
        console.log(`[Scheduler] Processed ${results.processed} commands: succeeded=${results.succeeded}, failed=${results.failed}`);
      }
    }).catch((error) => {
      console.error("[Scheduler] Error processing scheduled commands:", error);
    });
  }, 30_000); // 30 seconds

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
