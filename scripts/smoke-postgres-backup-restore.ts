import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { buildWhistleApi } from "../server/app.js";
import { withVerifiedPhone } from "./smoke-helpers.js";

type BackupColumn = {
  name: string;
  udtName: string;
  dataType: string;
};

type BackupTable = {
  name: string;
  columns: BackupColumn[];
  rows: Record<string, unknown>[];
};

type BackupPackage = {
  generatedAt: string;
  runId: string;
  source: "whistle-postgres-mvp";
  tables: BackupTable[];
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the Postgres backup/restore drill.");

process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

const operationalTables = [
  "jurisdictions",
  "categories",
  "category_readiness",
  "sla_policies",
  "app_controls",
  "config_change_requests",
  "access_users",
  "access_teams",
  "team_memberships",
  "role_grants",
  "access_review_events",
  "tickets",
  "ticket_status_history",
  "ticket_queue_assignments",
  "sla_clock_segments",
  "ticket_events",
  "evidence_objects",
  "audit_ledger",
  "idempotency_records",
  "citizen_phone_verifications",
  "notification_outbox",
  "agent_recommendation_runs",
  "dashboard_brief_runs",
] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function quoteIdent(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function restoreSchemaName(runId: string) {
  return `restore_drill_${runId.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 48)}`;
}

function sqlValue(value: unknown, column: BackupColumn) {
  if (value === null || value === undefined) return null;
  if (column.udtName === "jsonb" || column.udtName === "json") return JSON.stringify(value);
  return value;
}

async function jsonRequest<T>(
  app: ReturnType<typeof buildWhistleApi>,
  options: Parameters<ReturnType<typeof buildWhistleApi>["inject"]>[0],
): Promise<T> {
  const response = await app.inject(options);
  assert(response.statusCode >= 200 && response.statusCode < 300, `${options.method} ${options.url} returned ${response.statusCode}. Body: ${response.body}`);
  return response.json<T>();
}

async function seedTicket(runId: string) {
  const app = buildWhistleApi();
  await app.ready();
  try {
    const phone = `+9196${Date.now().toString().slice(-8)}`;
    const payload = await withVerifiedPhone(app, {
      category: "roads",
      language: "en",
      title: `Backup restore road issue ${runId}`,
      description: "A damaged storm-water drain cover is creating a road hazard and needs local repair verification.",
      phone,
      reference: `backup-restore-${runId}`,
      departmentHint: "Municipal Administration and Water Supply",
      location: {
        district: "Chennai",
        area: "Velachery",
        address: "Velachery Main Road near the bus stop",
      },
      evidence: [
        {
          fileName: `backup-restore-${runId}.jpg`,
          mimeType: "image/jpeg",
          sizeBytes: 512_000,
        },
      ],
    });

    const created = await jsonRequest<{ ticket: { id: string } }>(app, {
      method: "POST",
      url: "/api/tickets",
      headers: {
        "idempotency-key": `backup-create-${runId}`,
        "x-whistle-correlation-id": `backup-create-${runId}`,
      },
      payload,
    });

    await jsonRequest<{ ticket: { id: string } }>(app, {
      method: "POST",
      url: `/api/verification/${encodeURIComponent(created.ticket.id)}/decision`,
      headers: {
        "x-whistle-role": "verification",
        "x-whistle-actor": "verification:prototype",
        "idempotency-key": `backup-route-${runId}`,
        "x-whistle-correlation-id": `backup-route-${runId}`,
      },
      payload: {
        action: "route_local",
        actor: "verification:prototype",
        reason: "Backup drill seeded ticket is complete enough to route before backup.",
        ownerKey: "ward:48",
        ownerLabel: "Ward 48 Local Owner",
        scopeValue: "Ward 48",
      },
    });

    return created.ticket.id;
  } finally {
    await app.close();
  }
}

async function loadColumns(client: pg.PoolClient, table: string): Promise<BackupColumn[]> {
  const result = await client.query<{ column_name: string; udt_name: string; data_type: string }>(
    `
      select column_name, udt_name, data_type
      from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by ordinal_position
    `,
    [table],
  );
  assert(result.rows.length > 0, `No columns found for ${table}. Run npm run db:migrate first.`);
  return result.rows.map((row) => ({
    name: row.column_name,
    udtName: row.udt_name,
    dataType: row.data_type,
  }));
}

async function createBackup(client: pg.PoolClient, runId: string): Promise<BackupPackage> {
  const tables: BackupTable[] = [];
  for (const table of operationalTables) {
    const columns = await loadColumns(client, table);
    const result = await client.query<{ row_data: Record<string, unknown> }>(`select to_jsonb(t) as row_data from ${quoteIdent(table)} t order by 1::text`);
    tables.push({
      name: table,
      columns,
      rows: result.rows.map((row) => row.row_data),
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    runId,
    source: "whistle-postgres-mvp",
    tables,
  };
}

async function restoreBackup(client: pg.PoolClient, backup: BackupPackage, schema: string) {
  await client.query(`drop schema if exists ${quoteIdent(schema)} cascade`);
  await client.query(`create schema ${quoteIdent(schema)}`);

  for (const table of backup.tables) {
    await client.query(`create table ${quoteIdent(schema)}.${quoteIdent(table.name)} (like public.${quoteIdent(table.name)} including all)`);
    if (!table.rows.length) continue;
    const columnSql = table.columns.map((column) => quoteIdent(column.name)).join(", ");
    for (const row of table.rows) {
      const values = table.columns.map((column) => sqlValue(row[column.name], column));
      const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
      await client.query(`insert into ${quoteIdent(schema)}.${quoteIdent(table.name)} (${columnSql}) values (${placeholders})`, values);
    }
  }
}

async function verifyRestore(client: pg.PoolClient, backup: BackupPackage, schema: string, ticketId: string, runId: string) {
  for (const table of backup.tables) {
    const result = await client.query<{ count: string }>(`select count(*)::text as count from ${quoteIdent(schema)}.${quoteIdent(table.name)}`);
    assert(Number(result.rows[0].count) === table.rows.length, `${table.name} restore count mismatch. Expected ${table.rows.length}, got ${result.rows[0].count}.`);
  }

  const restoredTicket = await client.query<{ id: string; reference: string; status: string }>(
    `select id, reference, status from ${quoteIdent(schema)}.tickets where id = $1`,
    [ticketId],
  );
  assert(restoredTicket.rows[0]?.reference === `backup-restore-${runId}`, "Restored ticket reference did not survive backup/restore.");
  assert(restoredTicket.rows[0]?.status === "routed_local", "Restored ticket should preserve routed_local status.");

  const queue = await client.query<{ queue_kind: string }>(
    `select queue_kind from ${quoteIdent(schema)}.ticket_queue_assignments where ticket_id = $1 and released_at is null and is_primary = true`,
    [ticketId],
  );
  assert(queue.rows[0]?.queue_kind === "local", "Restored ticket should preserve active local primary queue.");

  const statusHistory = await client.query<{ from_status: string | null; to_status: string }>(
    `
      select from_status, to_status
      from ${quoteIdent(schema)}.ticket_status_history
      where ticket_id = $1
      order by changed_at asc, created_at asc
    `,
    [ticketId],
  );
  const transitions = statusHistory.rows.map((row) => `${row.from_status ?? "new"}->${row.to_status}`);
  assert(transitions.includes("new->submitted"), "Restored ticket status history should preserve the creation status transition.");
  assert(transitions.includes("submitted->routed_local"), "Restored ticket status history should preserve the routed-local status transition.");

  const audit = await client.query<{ count: string }>(
    `select count(*)::text as count from ${quoteIdent(schema)}.audit_ledger where ticket_id = $1 and correlation_id in ($2, $3)`,
    [ticketId, `backup-create-${runId}`, `backup-route-${runId}`],
  );
  assert(Number(audit.rows[0].count) >= 2, "Restored audit ledger should preserve seeded request correlation ids.");
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const schema = restoreSchemaName(runId);
const backupPath = path.join(os.tmpdir(), `whistle-postgres-backup-${runId}.json`);
const ticketId = await seedTicket(runId);
const client = await pool.connect();

try {
  const backup = await createBackup(client, runId);
  assert(backup.tables.every((table) => table.columns.length > 0), "Every backup table should include column metadata.");
  assert(backup.tables.some((table) => table.name === "tickets" && table.rows.some((row) => row.id === ticketId)), "Backup should include the seeded ticket.");

  await fs.writeFile(backupPath, JSON.stringify(backup, null, 2));
  const restoredBackup = JSON.parse(await fs.readFile(backupPath, "utf8")) as BackupPackage;
  await restoreBackup(client, restoredBackup, schema);
  await verifyRestore(client, restoredBackup, schema, ticketId, runId);

  console.log(`PASS Postgres backup/restore drill verified ${backup.tables.length} table(s), ticket ${ticketId}, and audit correlation ids.`);
} finally {
  await client.query(`drop schema if exists ${quoteIdent(schema)} cascade`);
  client.release();
  await pool.end();
  await fs.rm(backupPath, { force: true });
}
