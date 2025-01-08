import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "@db/schema";
import { log } from "../server/vite";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

try {
  export const db = drizzle({
    connection: process.env.DATABASE_URL,
    schema,
    ws: ws,
    logger: true,
  });

  // Test the connection
  const testConnection = async () => {
    try {
      await db.execute(sql`SELECT 1`);
      log("[DB] Database connection successful");
    } catch (error) {
      log(`[DB] Database connection failed: ${error}`);
      throw error;
    }
  };

  testConnection();
} catch (error) {
  log(`[DB] Database initialization failed: ${error}`);
  throw error;
}