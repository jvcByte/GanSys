import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { migrate as migrateNeon } from "drizzle-orm/neon-http/migrator";
import postgres from "postgres";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";

// Load .env / .env.local
config({ path: ".env" });
config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set.");
}

const connectionString = process.env.DATABASE_URL;

// Detect database type
const isNeonCloud = connectionString.includes("neon.tech") || 
                    connectionString.includes("sslmode=require");
const isLocalPostgres = connectionString.includes("localhost") || 
                        connectionString.includes("127.0.0.1");

async function main() {
  if (isNeonCloud) {
    console.log("Using Neon cloud database...");
    const sql = neon(connectionString);
    const db = drizzleNeon(sql);
    await migrateNeon(db, { migrationsFolder: "./drizzle" });
  } else if (isLocalPostgres) {
    console.log("Using local PostgreSQL database...");
    const client = postgres(connectionString, { max: 1 });
    const db = drizzlePostgres(client);
    await migratePostgres(db, { migrationsFolder: "./drizzle" });
    await client.end();
  } else {
    console.log("Using standard PostgreSQL connection...");
    const client = postgres(connectionString, { max: 1 });
    const db = drizzlePostgres(client);
    await migratePostgres(db, { migrationsFolder: "./drizzle" });
    await client.end();
  }
  
  console.log("Migrations applied successfully.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
