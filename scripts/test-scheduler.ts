/**
 * Test script for the scheduled commands processor.
 * Run with: npx tsx scripts/test-scheduler.ts
 */

import { config } from "dotenv";
import { processDueScheduledCommands } from "../src/lib/services/scheduled-command.service";

// Load environment variables
config({ path: ".env" });
config({ path: ".env.local" });

async function main() {
  console.log("Testing scheduled command processor...\n");

  try {
    const results = await processDueScheduledCommands();
    
    console.log("Results:");
    console.log(`  Processed: ${results.processed}`);
    console.log(`  Succeeded: ${results.succeeded}`);
    console.log(`  Failed: ${results.failed}`);
    
    if (results.processed === 0) {
      console.log("\nNo commands were due for execution.");
      console.log("To test:");
      console.log("1. Schedule a command via the web dashboard");
      console.log("2. Set the time to 1-2 minutes in the future");
      console.log("3. Wait for the scheduled time");
      console.log("4. Run this script again");
    } else {
      console.log("\n✓ Commands processed successfully!");
    }
  } catch (error) {
    console.error("Error processing scheduled commands:", error);
    process.exit(1);
  }
}

main();
