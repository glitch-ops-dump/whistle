import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Example: postgres://whistle:whistle@localhost:54329/whistle");
}

const schemaPath = path.resolve(process.cwd(), "server/db/schema.sql");
const schemaSql = await fs.readFile(schemaPath, "utf8");
const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  await pool.query(schemaSql);
  console.log("Whistle database schema is ready.");
} finally {
  await pool.end();
}
