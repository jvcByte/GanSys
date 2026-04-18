import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { neon } from "@neondatabase/serverless";
import postgres from "postgres";

import * as schema from "@/lib/db/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set.");
}

const connectionString = process.env.DATABASE_URL;

// Detect if we're using Neon cloud (has specific Neon hostname patterns)
// or local PostgreSQL (localhost or 127.0.0.1)
const isNeonCloud = connectionString.includes("neon.tech") || 
                    connectionString.includes("sslmode=require");
const isLocalPostgres = connectionString.includes("localhost") || 
                        connectionString.includes("127.0.0.1");

let db: ReturnType<typeof drizzleNeon> | ReturnType<typeof drizzlePostgres>;

if (isNeonCloud) {
  // Use Neon's HTTP driver for cloud connections
  const sql = neon(connectionString);
  db = drizzleNeon(sql, { schema });
} else if (isLocalPostgres) {
  // Use standard postgres driver for local connections
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  db = drizzlePostgres(client, { schema });
} else {
  // Default to postgres driver for other connections
  const client = postgres(connectionString);
  db = drizzlePostgres(client, { schema });
}

export { db };
