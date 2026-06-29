import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { applyEnv, parseEnvFile } from "./env-file.js";
import type { SeedSummary } from "./mvp1-local-uat-seed.js";

type InjectableApp = {
  inject(options: {
    method: "GET" | "POST";
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  }): Promise<{
    statusCode: number;
    body: string;
    json<T>(): T;
  }>;
};

type RunOptions = {
  envFile: string;
  runId: string;
  json: boolean;
  quiet: boolean;
  seedFile?: string;
  out?: string;
};

type TicketApi = {
  id: string;
  status: string;
  protected: boolean;
  primaryQueue: { kind: string; ownerLabel: string; scope: { jurisdiction: string; value: string } };
  secondaryQueues: Array<{ kind: string; ownerLabel: string }>;
  citizenTimeline?: Array<{ type: string; message?: string }>;
  governmentEvents?: Array<{ type: string; message?: string }>;
};

type UatAssertion = {
  id: string;
  label: string;
  status: "pass";
  detail: string;
};

type RunSummary = {
  kind: "whistle-mvp1-local-uat-run";
  runId: string;
  envFile: string;
  generatedAt: string;
  seedGeneratedAt: string;
  tickets: Array<Omit<SeedSummary["tickets"][number], "notes">>;
  assertions: UatAssertion[];
};

function defaultRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `local-uat-run-${stamp}`;
}

function parseArgs(argv: string[]): RunOptions {
  const options: RunOptions = {
    envFile: "ops/env/whistle-mvp1-local-uat.env.example",
    runId: defaultRunId(),
    json: false,
    quiet: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-file") {
      options.envFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--run-id") {
      options.runId = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--out") {
      options.out = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--seed-file") {
      options.seedFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--quiet") {
      options.quiet = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readSeedSummary(options: RunOptions) {
  assert(options.seedFile, "Pass --seed-file artifacts/whistle-mvp1-local-uat-seed.json after running mvp1:uat-seed with --json --quiet --out.");
  const seedPath = resolve(process.cwd(), options.seedFile);
  const summary = JSON.parse(await readFile(seedPath, "utf8")) as SeedSummary;
  assert(summary.kind === "whistle-mvp1-local-uat-seed", `${seedPath} is not a Whistle MVP1 local UAT seed JSON artifact.`);
  assert(summary.runId === options.runId, `Seed file run ID ${summary.runId} does not match requested run ID ${options.runId}.`);
  return summary;
}

function account(summary: SeedSummary, actor: string) {
  const found = summary.accounts.find((item) => item.actor === actor);
  assert(found?.token, `Seed summary is missing token for ${actor}.`);
  return found;
}

function ticket(summary: SeedSummary, key: string) {
  const found = summary.tickets.find((item) => item.key === key);
  assert(found, `Seed summary is missing ${key} ticket.`);
  return found;
}

function headers(token: string, role: string, extra?: Record<string, string>) {
  return {
    authorization: `Bearer ${token}`,
    "x-whistle-role": role,
    ...extra,
  };
}

function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return search.toString();
}

async function jsonRequest<T>(
  app: InjectableApp,
  options: {
    method: "GET" | "POST";
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  },
  expectedStatus: number | number[] = 200,
) {
  const response = await app.inject(options);
  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  assert(
    expected.includes(response.statusCode),
    `${options.method} ${options.url} returned ${response.statusCode}; expected ${expected.join(" or ")}. Body: ${response.body}`,
  );
  return response.json<T>();
}

async function getStatus(app: InjectableApp, url: string, requestHeaders: Record<string, string>) {
  const response = await app.inject({
    method: "GET",
    url,
    headers: requestHeaders,
  });
  return response.statusCode;
}

async function dashboardContains(app: InjectableApp, requestHeaders: Record<string, string>, params: Record<string, string | number | undefined>, ticketId: string) {
  const result = await jsonRequest<{ dashboard: { tickets: Array<{ id: string }> } }>(app, {
    method: "GET",
    url: `/api/dashboard?${query({ ...params, q: ticketId })}`,
    headers: requestHeaders,
  });
  return result.dashboard.tickets.some((item) => item.id === ticketId);
}

async function addFieldReport(app: InjectableApp, ticketId: string, requestHeaders: Record<string, string>, fieldOfficer: string, note: string) {
  const result = await jsonRequest<{ ticket: TicketApi }>(app, {
    method: "POST",
    url: `/api/tickets/${encodeURIComponent(ticketId)}/field-actions`,
    headers: requestHeaders,
    payload: {
      action: "add_field_report",
      fieldOfficer,
      note,
      evidence: [{ label: "field_report", fileName: `${ticketId.toLowerCase()}-uat-field-report.txt`, mimeType: "text/plain", sizeBytes: 512 }],
    },
  });
  assert(result.ticket.id === ticketId, `Field report response should return ${ticketId}.`);
  return result.ticket;
}

async function getTicket(app: InjectableApp, ticketId: string, requestHeaders: Record<string, string>) {
  const result = await jsonRequest<{ ticket: TicketApi }>(app, {
    method: "GET",
    url: `/api/tickets/${encodeURIComponent(ticketId)}`,
    headers: requestHeaders,
  });
  return result.ticket;
}

async function assertFreshSeedState(app: InjectableApp, requestHeaders: Record<string, string>, seedTickets: SeedSummary["tickets"]) {
  const expected = [
    { key: "cm-escalated", status: "escalated_cm_cell", primaryQueue: "cm_cell" },
    { key: "ministry-queue", status: "escalated_ministry", primaryQueue: "ministry" },
    { key: "mla-local", status: "routed_local", primaryQueue: "local" },
    { key: "councillor-ward-48", status: "routed_local", primaryQueue: "local" },
    { key: "protected-corruption", status: "verified", primaryQueue: "protected_review" },
    { key: "rejection-review", status: "rejected", primaryQueue: "rejection_review" },
    { key: "verification-new", status: "submitted", primaryQueue: "verification" },
  ];
  const mismatches: string[] = [];
  for (const item of expected) {
    const seeded = seedTickets.find((candidate) => candidate.key === item.key);
    assert(seeded, `Seed summary is missing ${item.key} ticket.`);
    const current = await getTicket(app, seeded.ticketId, requestHeaders);
    if (current.status !== item.status || current.primaryQueue.kind !== item.primaryQueue) {
      mismatches.push(`${item.key} ${seeded.ticketId} is ${current.status}/${current.primaryQueue.kind}; expected ${item.status}/${item.primaryQueue}`);
    }
  }
  assert(
    mismatches.length === 0,
    `This local UAT seed has already been used or the database drifted. Generate a fresh seed with a new run id before running mvp1:uat-run. Details: ${mismatches.join("; ")}`,
  );
}

function record(assertions: UatAssertion[], id: string, label: string, detail: string) {
  assertions.push({ id, label, status: "pass", detail });
}

function renderMarkdown(summary: RunSummary) {
  const assertionRows = summary.assertions
    .map((item) => `| ${item.id} | ${item.label} | ${item.status} | ${item.detail} |`)
    .join("\n");
  const ticketRows = summary.tickets
    .map((item) => `| ${item.key} | \`${item.ticketId}\` | ${item.status} | ${item.primaryQueue} | ${item.expectedSurface} |`)
    .join("\n");

  return `# Whistle MVP1 Local UAT Role Runner

Run ID: \`${summary.runId}\`  
Generated: \`${summary.generatedAt}\`  
Env file: \`${summary.envFile}\`  
Seed generated: \`${summary.seedGeneratedAt}\`

This artifact proves the local MVP1 role accounts can read their scoped queues and perform the expected non-production actions. It intentionally does not include browser bearer tokens.

## Seed Tickets

| Scenario | Ticket | Seed status | Seed primary queue | Surface |
| --- | --- | --- | --- | --- |
${ticketRows}

## Assertions

| Check | Purpose | Status | Detail |
| --- | --- | --- | --- |
${assertionRows}
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const envFile = resolve(process.cwd(), options.envFile);
  const env = parseEnvFile(envFile);
  applyEnv(env, { override: true });
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

  assert(env.DATABASE_URL, "DATABASE_URL is required for MVP1 local UAT role runner.");
  assert(env.WHISTLE_DEPLOYMENT_PROFILE === "local", "The local UAT role runner must only run with WHISTLE_DEPLOYMENT_PROFILE=local.");

  const seed = await readSeedSummary(options);
  const assertions: UatAssertion[] = [];

  const cmCell = account(seed, "cm_cell:prototype");
  const minister = account(seed, "minister:prototype");
  const departmentOfficer = account(seed, "department_officer:prototype");
  const mla = account(seed, "mla:prototype");
  const councillor = account(seed, "councillor:prototype");
  const verification = account(seed, "verification:prototype");

  const cmTicket = ticket(seed, "cm-escalated");
  const ministryTicket = ticket(seed, "ministry-queue");
  const mlaTicket = ticket(seed, "mla-local");
  const councillorTicket = ticket(seed, "councillor-ward-48");
  const protectedTicket = ticket(seed, "protected-corruption");
  const rejectedTicket = ticket(seed, "rejection-review");
  const verificationTicket = ticket(seed, "verification-new");

  const { buildWhistleApi } = await import("../server/app.js");
  const app = buildWhistleApi();
  await app.ready();

  try {
    await assertFreshSeedState(
      app,
      headers(cmCell.token, "cm_cell", { "x-whistle-access-reason": "Local UAT fresh seed check" }),
      seed.tickets,
    );

    assert(
      await dashboardContains(app, headers(cmCell.token, "cm_cell"), { role: "cm_cell", queue: "cm_cell", ticketLimit: 100 }, cmTicket.ticketId),
      "CM Cell dashboard should include the CM escalation fixture.",
    );
    record(assertions, "cm-cell-escalation-queue", "CM Cell sees escalations", `${cmTicket.ticketId} appears in CM Cell default queue.`);

    assert(
      await dashboardContains(
        app,
        headers(cmCell.token, "cm_cell", { "x-whistle-access-reason": "Local UAT protected queue assertion" }),
        { role: "cm_cell", queue: "protected_review", ticketLimit: 100 },
        protectedTicket.ticketId,
      ),
      "CM Cell protected queue should include the protected corruption fixture.",
    );
    record(assertions, "cm-cell-protected-queue", "CM Cell sees protected intake", `${protectedTicket.ticketId} appears only with a protected access reason.`);

    assert(
      await dashboardContains(
        app,
        headers(minister.token, "minister"),
        { role: "minister", ministry: "Municipal Administration and Water Supply", ticketLimit: 100 },
        ministryTicket.ticketId,
      ),
      "Minister dashboard should include the MAWS ministry fixture.",
    );
    const ministerSeesProtected = await dashboardContains(
      app,
      headers(minister.token, "minister"),
      { role: "minister", ministry: "Municipal Administration and Water Supply", ticketLimit: 100 },
      protectedTicket.ticketId,
    );
    assert(!ministerSeesProtected, "Minister dashboard must not include protected corruption fixture.");
    record(assertions, "minister-ministry-scope", "Minister sees only ministry scope", `${ministryTicket.ticketId} is visible; ${protectedTicket.ticketId} is hidden.`);

    const departmentUpdated = await addFieldReport(
      app,
      ministryTicket.ticketId,
      headers(departmentOfficer.token, "department_officer"),
      "MAWS UAT Department Officer",
      "UAT confirms district owner has been asked to submit closure proof and ministry follow-up remains active.",
    );
    assert(departmentUpdated.primaryQueue.kind === "ministry", "Department field report should keep the ministry as primary queue.");
    record(assertions, "department-field-action", "Department officer can act", `${ministryTicket.ticketId} accepted a ministry field report.`);

    assert(
      await dashboardContains(app, headers(mla.token, "mla"), { role: "mla", constituency: "Velachery", ticketLimit: 100 }, mlaTicket.ticketId),
      "MLA dashboard should include the Velachery local fixture.",
    );
    const mlaUpdated = await addFieldReport(
      app,
      mlaTicket.ticketId,
      headers(mla.token, "mla"),
      "Velachery MLA UAT Field Coordinator",
      "UAT confirms local inspection started before the issue escalates beyond the constituency.",
    );
    assert(["local", "mla"].includes(mlaUpdated.primaryQueue.kind), "MLA field report should keep local ownership active.");
    record(assertions, "mla-local-closure-action", "MLA can act locally", `${mlaTicket.ticketId} accepted a local field report.`);

    assert(
      await dashboardContains(app, headers(councillor.token, "councillor"), { role: "councillor", ward: "Ward 48", ticketLimit: 100 }, councillorTicket.ticketId),
      "Councillor dashboard should include the Ward 48 fixture.",
    );
    const councillorUpdated = await addFieldReport(
      app,
      councillorTicket.ticketId,
      headers(councillor.token, "councillor"),
      "Ward 48 UAT Sanitation Supervisor",
      "UAT confirms ward sanitation crew inspection and cleanup assignment before escalation.",
    );
    assert(councillorUpdated.primaryQueue.kind === "local", "Councillor field report should keep local ownership active.");
    record(assertions, "councillor-ward-action", "Councillor can act locally", `${councillorTicket.ticketId} accepted a ward field report.`);

    const verificationQueue = await jsonRequest<{ tickets: Array<{ id: string }> }>(app, {
      method: "GET",
      url: `/api/verification/queue?${query({ limit: 100, q: verificationTicket.ticketId })}`,
      headers: headers(verification.token, "verification"),
    });
    assert(verificationQueue.tickets.some((item) => item.id === verificationTicket.ticketId), "Verification queue should include the fresh intake fixture.");
    record(assertions, "verification-intake-queue", "Verification sees fresh intake", `${verificationTicket.ticketId} is available for verification decisions.`);

    const protectedStatuses = {
      cmCell: await getStatus(
        app,
        `/api/tickets/${encodeURIComponent(protectedTicket.ticketId)}`,
        headers(cmCell.token, "cm_cell", { "x-whistle-access-reason": "Local UAT protected detail assertion" }),
      ),
      minister: await getStatus(app, `/api/tickets/${encodeURIComponent(protectedTicket.ticketId)}`, headers(minister.token, "minister")),
      departmentOfficer: await getStatus(app, `/api/tickets/${encodeURIComponent(protectedTicket.ticketId)}`, headers(departmentOfficer.token, "department_officer")),
      mla: await getStatus(app, `/api/tickets/${encodeURIComponent(protectedTicket.ticketId)}`, headers(mla.token, "mla")),
      councillor: await getStatus(app, `/api/tickets/${encodeURIComponent(protectedTicket.ticketId)}`, headers(councillor.token, "councillor")),
    };
    assert(protectedStatuses.cmCell === 200, "CM Cell should read protected detail with access reason.");
    assert(protectedStatuses.minister === 403, "Minister direct protected read should be forbidden.");
    assert(protectedStatuses.departmentOfficer === 403, "Department officer direct protected read should be forbidden.");
    assert(protectedStatuses.mla === 403, "MLA direct protected read should be forbidden.");
    assert(protectedStatuses.councillor === 403, "Councillor direct protected read should be forbidden.");
    record(assertions, "protected-read-guardrail", "Protected identity guardrail holds", `CM Cell ${protectedStatuses.cmCell}; minister/department/MLA/councillor are forbidden.`);

    const rejectionReview = await jsonRequest<{ ticket: TicketApi }>(app, {
      method: "POST",
      url: `/api/rejection-review/${encodeURIComponent(rejectedTicket.ticketId)}/decision`,
      headers: headers(cmCell.token, "cm_cell"),
      payload: {
        action: "request_info",
        reason: "UAT review found the complaint may be addressable if the citizen adds the prior reference number and office acknowledgement.",
        missingFields: ["Prior reference number", "Office acknowledgement"],
        citizenMessage: "CM review needs the earlier reference number and any office acknowledgement before deciding whether to restore this ticket.",
      },
    });
    assert(rejectionReview.ticket.status === "needs_info", "Rejection review request-info should return ticket to citizen.");
    assert(rejectionReview.ticket.primaryQueue.kind === "citizen", "Rejection review request-info should make citizen response primary.");
    assert(rejectionReview.ticket.secondaryQueues.some((item) => item.kind === "rejection_review"), "Rejection review should retain secondary oversight.");
    record(assertions, "cm-rejection-review-action", "CM review can request citizen info", `${rejectedTicket.ticketId} moved to citizen clarification with rejection-review oversight.`);

    const summary: RunSummary = {
      kind: "whistle-mvp1-local-uat-run",
      runId: options.runId,
      envFile,
      generatedAt: new Date().toISOString(),
      seedGeneratedAt: seed.generatedAt,
      tickets: seed.tickets.map(({ notes: _notes, ...item }) => item),
      assertions,
    };

    if (options.out) {
      const outPath = resolve(process.cwd(), options.out);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, options.json ? `${JSON.stringify(summary, null, 2)}\n` : renderMarkdown(summary), "utf8");
    }

    if (options.quiet) {
      process.stdout.write(`Whistle MVP1 local UAT role runner validated ${summary.assertions.length} assertion(s). Run ID: ${summary.runId}\n`);
    } else {
      process.stdout.write(options.json ? `${JSON.stringify(summary, null, 2)}\n` : renderMarkdown(summary));
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
