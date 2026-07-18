/**
 * Postgres client — pg Pool + Drizzle, cached across Next dev hot reloads.
 * Endpoints FAIL CLOSED when DATABASE_URL is absent (§10.1): counted/prize
 * paths return service-unavailable; practice never touches the DB.
 */

import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

const globalCache = globalThis as unknown as {
  __aegyoDbPool?: Pool;
  __aegyoDb?: Db;
};

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getDb(): Db | null {
  if (!process.env.DATABASE_URL) return null;
  if (!globalCache.__aegyoDb) {
    globalCache.__aegyoDbPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    });
    try {
      // Vercel Fluid Compute: release pooled connections before suspension
      // (ADR 0004 / Railway migration prep). No-op outside Vercel.
      attachDatabasePool(globalCache.__aegyoDbPool);
    } catch {
      // Older runtime without lifecycle support — pool still works.
    }
    globalCache.__aegyoDb = drizzle(globalCache.__aegyoDbPool, { schema });
  }
  return globalCache.__aegyoDb;
}
