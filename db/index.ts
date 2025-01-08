import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "@db/schema";
import { log } from "../server/vite";
import { sql } from "drizzle-orm";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const db = drizzle({
  connection: process.env.DATABASE_URL,
  schema,
  ws: ws,
  // logger: true,
});

// Test the connection
const testConnection = async () => {
  try {
    await db.execute(sql`SELECT 1`);
  } catch (error) {
    log(`[DB] Database connection failed: ${error}`);
    throw error;
  }
};

// Initialize connection
testConnection().catch((error) => {
  log(`[DB] Database initialization failed: ${error}`);
  process.exit(1);
});

export { db };
