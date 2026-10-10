import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { getDb } from "../src/db/client";
import { MIGRATIONS_FOLDER } from "../src/db/migrations-path";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // PGlite migrates itself on first connection.
    await getDb();
    console.log("Local PGlite database is up to date.");
    return;
  }
  const pool = new Pool({ connectionString: url });
  await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_FOLDER });
  await pool.end();
  console.log("Neon database migrated.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
