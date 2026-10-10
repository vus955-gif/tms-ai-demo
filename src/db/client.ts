import { PGlite } from "@electric-sql/pglite";
import { Pool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { MIGRATIONS_FOLDER } from "./migrations-path";
import * as schema from "./schema";
import type { Db } from "./types";

const globalForDb = globalThis as unknown as { __tmsDb?: Promise<Db> };

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pool = new Pool({ connectionString: url });
    return drizzleNeon({ client: pool, schema }) as unknown as Db;
  }
  // Local development: an embedded Postgres persisted to ./.pglite.
  const client = new PGlite(process.env.PGLITE_DIR ?? "./.pglite");
  const db = drizzlePglite({ client, schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db as unknown as Db;
}

/** Shared database handle (one per server process, survives hot reloads). */
export function getDb(): Promise<Db> {
  if (!globalForDb.__tmsDb) {
    globalForDb.__tmsDb = connect().catch((error) => {
      globalForDb.__tmsDb = undefined;
      throw error;
    });
  }
  return globalForDb.__tmsDb;
}
