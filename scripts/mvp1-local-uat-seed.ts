import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnv, parseEnvFile } from "./env-file.js";
import { createLocalUatOfficialToken } from "./mvp1-local-uat-token.js";
import type { GovRole, QueueKind, TicketRecord } from "../server/ticket-spine/types.js";

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

type RoleAccount = {
  actor: string;
  role: Exclude<GovRole, "councillor"> | "councillor" | "admin";
  label: string;
  surface: string;
  path: string;
};

export type SeedOptions = {
  envFile: string;
  runId: string;
  json: boolean;
  quiet: boolean;
  out?: string;
};

type SeedTicket = {
  key: string;
  label: string;
  ticket: TicketRecord;
  expectedSurface: string;
  expectedQueue: QueueKind;
  notes: string;
};

export type SeedSummary = {
  kind: "whistle-mvp1-local-uat-seed";
  runId: string;
  envFile: string;
  generatedAt: string;
  accounts: Array<RoleAccount & { storageKey: string; token: string }>;
  tickets: Array<{
    key: string;
    label: string;
    ticketId: string;
    category: string;
    status: string;
    protected: boolean;
    primaryQueue: string;
    scope: string;
    expectedSurface: string;
    notes: string;
  }>;
  checks: {
    cmCellTickets: number;
    mawsTickets: number;
    mlaVelacheryTickets: number;
    councillorWard48Tickets: number;
    verificationTickets: number;
    protectedVisibility: {
      cmCellDashboardMatches: number;
      ministerDashboardMatches: number;
      departmentOfficerDashboardMatches: number;
      mlaDashboardMatches: number;
      councillorDashboardMatches: number;
      cmCellDirectStatus: number;
      verificationDirectStatus: number;
      ministerDirectStatus: number;
      departmentOfficerDirectStatus: number;
      mlaDirectStatus: number;
      councillorDirectStatus: number;
    };
  };
};

const roleAccounts: RoleAccount[] = [
  { actor: "admin:prototype", role: "admin", label: "Prototype Admin", surface: "Admin Console", path: "/admin.html#launch" },
  { actor: "admin:reviewer", role: "admin", label: "Second Admin Reviewer", surface: "Admin approvals", path: "/admin.html#launch" },
  { actor: "verification:prototype", role: "verification", label: "Verification Prototype Officer", surface: "Verification Console", path: "/verification.html" },
  { actor: "cm_cell:prototype", role: "cm_cell", label: "CM Cell Prototype Officer", surface: "CM Cell Dashboard", path: "/cm-cell.html" },
  { actor: "minister:prototype", role: "minister", label: "MAWS Minister Prototype User", surface: "Ministry console", path: "/ministry.html" },
  { actor: "department_officer:prototype", role: "department_officer", label: "MAWS Department Officer", surface: "Ministry queue", path: "/ministry.html" },
  { actor: "mla:prototype", role: "mla", label: "Velachery MLA Prototype User", surface: "MLA Dashboard", path: "/mla.html" },
  { actor: "councillor:prototype", role: "councillor", label: "Ward 48 Councillor Prototype User", surface: "Local Owner Workbench", path: "/local.html" },
];

function defaultRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `local-uat-${stamp}`;
}

function parseArgs(argv: string[]): SeedOptions {
  const options: SeedOptions = {
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
  const expectedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  assert(
    expectedStatuses.includes(response.statusCode),
    `${options.method} ${options.url} returned ${response.statusCode}; expected ${expectedStatuses.join(" or ")}. Body: ${response.body}`,
  );
  return response.json<T>();
}

function tokenHeaders(token: string, role: string, extra?: Record<string, string>) {
  return {
    authorization: `Bearer ${token}`,
    "x-whistle-role": role,
    ...extra,
  };
}

function workerHeaders(env: Record<string, string>) {
  const secret = env.WHISTLE_WORKER_SHARED_SECRET?.trim();
  assert(secret, "WHISTLE_WORKER_SHARED_SECRET is required for local UAT seeding.");
  return {
    "x-whistle-role": "worker",
    "x-whistle-actor": "worker:prototype",
    "x-whistle-worker-token": secret,
  };
}

function idempotencyKey(runId: string, key: string, action: string) {
  return `mvp1-uat-seed:${runId}:${key}:${action}`;
}

function seededPhone(runId: string, phoneSuffix: string) {
  let hash = 0;
  for (const character of runId) hash = (hash * 31 + character.charCodeAt(0)) % 10_000;
  return `+91 9${String(hash).padStart(4, "0")} ${phoneSuffix}`;
}

function ticketPayload(runId: string, key: string, input: {
  category: TicketRecord["category"];
  title: string;
  description: string;
  phoneSuffix: string;
  district: string;
  area: string;
  address: string;
  departmentHint?: string;
  evidence?: Array<{ fileName: string; mimeType: string; sizeBytes: number }>;
}) {
  return {
    category: input.category,
    language: "en",
    title: input.title,
    description: `${input.description} Seed run: ${runId}. Scenario: ${key}.`,
    phone: seededPhone(runId, input.phoneSuffix),
    reference: `UAT-${runId}-${key}`,
    departmentHint: input.departmentHint,
    location: {
      district: input.district,
      area: input.area,
      address: input.address,
      landmark: "MVP1 local UAT fixture",
    },
    evidence: input.evidence ?? [],
  };
}

async function createTicket(
  app: InjectableApp,
  runId: string,
  key: string,
  verificationToken: string,
  input: Parameters<typeof ticketPayload>[2],
) {
  const result = await jsonRequest<{ ticket: TicketRecord | null; rejected?: { error?: string; message?: string } | null }>(
    app,
    {
      method: "POST",
      url: "/api/tickets",
      headers: {
        ...tokenHeaders(verificationToken, "verification"),
        "idempotency-key": idempotencyKey(runId, key, "create"),
      },
      payload: ticketPayload(runId, key, input),
    },
    [200, 201],
  );
  assert(result.ticket, `Ticket ${key} should be accepted, got rejection: ${result.rejected?.message ?? result.rejected?.error ?? "unknown"}`);
  return result.ticket;
}

async function decide(
  app: InjectableApp,
  runId: string,
  key: string,
  ticketId: string,
  verificationToken: string,
  payload: Record<string, unknown>,
) {
  const result = await jsonRequest<{ ticket: TicketRecord }>(app, {
    method: "POST",
    url: `/api/verification/${encodeURIComponent(ticketId)}/decision`,
    headers: {
      ...tokenHeaders(verificationToken, "verification"),
      "idempotency-key": idempotencyKey(runId, key, "verification-decision"),
    },
    payload,
  }, [200, 201]);
  return result.ticket;
}

async function fieldAction(
  app: InjectableApp,
  ticketId: string,
  token: string,
  role: string,
  payload: Record<string, unknown>,
) {
  const result = await jsonRequest<{ ticket: TicketRecord }>(app, {
    method: "POST",
    url: `/api/tickets/${encodeURIComponent(ticketId)}/field-actions`,
    headers: tokenHeaders(token, role),
    payload,
  });
  return result.ticket;
}

async function runSlaJob(app: InjectableApp, env: Record<string, string>, now: string) {
  const result = await jsonRequest<{ result: { actions: Array<{ ticketId: string; outcome: string }> } }>(app, {
    method: "POST",
    url: "/api/jobs/sla-escalations/run",
    headers: workerHeaders(env),
    payload: { actor: "worker:prototype", now, limit: 500 },
  });
  return result.result;
}

async function dashboardCount(app: InjectableApp, token: string, role: string, query: string) {
  const result = await jsonRequest<{ dashboard: { tickets: unknown[] } }>(app, {
    method: "GET",
    url: `/api/dashboard?${query}`,
    headers: tokenHeaders(token, role),
  });
  return result.dashboard.tickets.length;
}

async function dashboardTicketMatches(app: InjectableApp, token: string, role: string, query: string, ticketId: string, extra?: Record<string, string>) {
  const result = await jsonRequest<{ dashboard: { tickets: Array<{ id?: string }> } }>(app, {
    method: "GET",
    url: `/api/dashboard?${query}&q=${encodeURIComponent(ticketId)}`,
    headers: tokenHeaders(token, role, extra),
  });
  return result.dashboard.tickets.filter((ticket) => ticket.id === ticketId).length;
}

async function directTicketStatus(app: InjectableApp, token: string, role: string, ticketId: string, extra?: Record<string, string>) {
  const response = await app.inject({
    method: "GET",
    url: `/api/tickets/${encodeURIComponent(ticketId)}`,
    headers: tokenHeaders(token, role, extra),
  });
  return response.statusCode;
}

async function verificationCount(app: InjectableApp, token: string) {
  const result = await jsonRequest<{ tickets: unknown[] }>(app, {
    method: "GET",
    url: "/api/verification/queue?limit=100",
    headers: tokenHeaders(token, "verification"),
  });
  return result.tickets.length;
}

function seedRow(key: string, label: string, ticket: TicketRecord, expectedSurface: string, expectedQueue: QueueKind, notes: string): SeedTicket {
  return { key, label, ticket, expectedSurface, expectedQueue, notes };
}

function renderMarkdown(summary: SeedSummary) {
  const accountRows = summary.accounts
    .map((account) => `| ${account.label} | \`${account.actor}\` | \`${account.role}\` | ${account.surface} | \`${account.path}\` |`)
    .join("\n");
  const ticketRows = summary.tickets
    .map((ticket) => `| ${ticket.key} | \`${ticket.ticketId}\` | ${ticket.status} | ${ticket.primaryQueue} | ${ticket.expectedSurface} | ${ticket.notes} |`)
    .join("\n");
  const localStorageSnippet = summary.accounts
    .map((account) => `localStorage.setItem("${account.storageKey}", "${account.token}");`)
    .join("\n");

  return `# Whistle MVP1 Local UAT Seed

Run ID: \`${summary.runId}\`  
Generated: \`${summary.generatedAt}\`  
Env file: \`${summary.envFile}\`

This fixture pack is for local UAT only. It uses local smoke OIDC tokens, local Postgres, and mock ticket data.

## Role Accounts

| Account | Actor | Role | Surface | Path |
| --- | --- | --- | --- | --- |
${accountRows}

Paste this in the browser console before opening role surfaces:

\`\`\`js
${localStorageSnippet}
\`\`\`

## Seed Tickets

| Scenario | Ticket | Status | Primary queue | Test in | Notes |
| --- | --- | --- | --- | --- | --- |
${ticketRows}

## Sanity Counts

- CM Cell filtered tickets: ${summary.checks.cmCellTickets}
- MAWS ministry tickets: ${summary.checks.mawsTickets}
- Velachery MLA tickets: ${summary.checks.mlaVelacheryTickets}
- Ward 48 councillor tickets: ${summary.checks.councillorWard48Tickets}
- Verification queue tickets: ${summary.checks.verificationTickets}

## Protected Visibility Guardrail

- CM Cell dashboard matches: ${summary.checks.protectedVisibility.cmCellDashboardMatches}
- Minister dashboard matches: ${summary.checks.protectedVisibility.ministerDashboardMatches}
- Department officer dashboard matches: ${summary.checks.protectedVisibility.departmentOfficerDashboardMatches}
- MLA dashboard matches: ${summary.checks.protectedVisibility.mlaDashboardMatches}
- Councillor dashboard matches: ${summary.checks.protectedVisibility.councillorDashboardMatches}
- Direct detail statuses: CM Cell ${summary.checks.protectedVisibility.cmCellDirectStatus}, Verification ${summary.checks.protectedVisibility.verificationDirectStatus}, Minister ${summary.checks.protectedVisibility.ministerDirectStatus}, Department ${summary.checks.protectedVisibility.departmentOfficerDirectStatus}, MLA ${summary.checks.protectedVisibility.mlaDirectStatus}, Councillor ${summary.checks.protectedVisibility.councillorDirectStatus}
`;
}

export async function createMvp1LocalUatSeedSummary(options: SeedOptions) {
  const envFile = resolve(process.cwd(), options.envFile);
  const env = parseEnvFile(envFile);
  applyEnv(env, { override: true });
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

  assert(env.DATABASE_URL, "DATABASE_URL is required for MVP1 local UAT seed data.");
  assert(env.WHISTLE_DEPLOYMENT_PROFILE === "local", "The local UAT seed must only run with WHISTLE_DEPLOYMENT_PROFILE=local.");

  const accounts = await Promise.all(
    roleAccounts.map(async (account) => ({
      ...account,
      storageKey: `whistle.officialBearerToken.${account.actor}`,
      token: await createLocalUatOfficialToken({
        actor: account.actor,
        role: account.role,
        env,
        expiresIn: "8h",
      }),
    })),
  );
  const tokenFor = (actor: string) => {
    const account = accounts.find((item) => item.actor === actor);
    assert(account, `Missing role account ${actor}`);
    return account.token;
  };
  const verificationToken = tokenFor("verification:prototype");
  const ministerToken = tokenFor("minister:prototype");
  const mlaToken = tokenFor("mla:prototype");

  const { buildWhistleApi } = await import("../server/app.js");
  const app = buildWhistleApi();
  await app.ready();

  const tickets: SeedTicket[] = [];
  try {
    const cmBase = await createTicket(app, options.runId, "cm-escalated", verificationToken, {
      category: "sanitation",
      title: "Sewage overflow near Velachery school gate",
      description: "Sewage water has been overflowing near a Velachery school gate after local follow-up and needs escalation visibility.",
      phoneSuffix: "71001",
      district: "Chennai",
      area: "Velachery",
      address: "Velachery Main Road near school gate",
      departmentHint: "Corporation / Municipality",
      evidence: [{ fileName: "sewage-overflow.jpg", mimeType: "image/jpeg", sizeBytes: 680_000 }],
    });
    await decide(app, options.runId, "cm-escalated", cmBase.id, verificationToken, {
      action: "route_local",
      actor: "verification:prototype",
      reason: "Complete sanitation complaint for Velachery local execution.",
      ownerKey: "mla:velachery",
      ownerLabel: "Velachery MLA Office",
      scopeValue: "Velachery",
    });
    const slaFuture = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString();
    await runSlaJob(app, env, slaFuture);
    await runSlaJob(app, env, slaFuture);
    const cmEscalated = (await jsonRequest<{ ticket: TicketRecord }>(app, {
      method: "GET",
      url: `/api/tickets/${encodeURIComponent(cmBase.id)}`,
      headers: tokenHeaders(tokenFor("cm_cell:prototype"), "cm_cell", { "x-whistle-access-reason": "Local UAT CM escalation fixture review" }),
    })).ticket;
    tickets.push(seedRow("cm-escalated", "CM Cell escalation", cmEscalated, "CM Cell Tickets default filter", "cm_cell", "Primary CM Cell with ministry/local secondary visibility."));

    const ministryBase = await createTicket(app, options.runId, "ministry-queue", verificationToken, {
      category: "sanitation",
      title: "Sewage overflow near Velachery school gate - ministry proof due",
      description: "The same Velachery school-gate sanitation complaint needs MAWS field proof after the local clock slipped.",
      phoneSuffix: "71002",
      district: "Chennai",
      area: "Velachery",
      address: "Velachery Main Road near school gate",
      departmentHint: "Municipal Administration and Water Supply",
      evidence: [{ fileName: "velachery-school-gate-field-proof.jpg", mimeType: "image/jpeg", sizeBytes: 510_000 }],
    });
    await decide(app, options.runId, "ministry-queue", ministryBase.id, verificationToken, {
      action: "route_local",
      actor: "verification:prototype",
      reason: "Complete sanitation complaint routed to Velachery local owner before MAWS escalation.",
      ownerKey: "mla:velachery",
      ownerLabel: "Velachery MLA Office",
      scopeValue: "Velachery",
    });
    await runSlaJob(app, env, slaFuture);
    const ministryTicket = (await jsonRequest<{ ticket: TicketRecord }>(app, {
      method: "GET",
      url: `/api/tickets/${encodeURIComponent(ministryBase.id)}`,
      headers: tokenHeaders(ministerToken, "minister"),
    })).ticket;
    tickets.push(seedRow("ministry-queue", "MAWS ministry queue", ministryTicket, "Ministry Dashboard", "ministry", "Primary ministry with local secondary visibility."));

    const mlaBase = await createTicket(app, options.runId, "mla-local", verificationToken, {
      category: "sanitation",
      title: "Sewage overflow near Velachery school gate - local visit due",
      description: "The local office must schedule the first field visit and upload before/after proof for the Velachery school-gate overflow.",
      phoneSuffix: "71003",
      district: "Chennai",
      area: "Velachery",
      address: "Velachery Main Road near school gate",
      departmentHint: "Corporation / Municipality",
      evidence: [{ fileName: "velachery-school-gate-before.jpg", mimeType: "image/jpeg", sizeBytes: 430_000 }],
    });
    const mlaTicket = await decide(app, options.runId, "mla-local", mlaBase.id, verificationToken, {
      action: "route_local",
      actor: "verification:prototype",
      reason: "Sanitation issue is complete and should be closed by Velachery local ownership.",
      ownerKey: "mla:velachery",
      ownerLabel: "Velachery MLA Office",
      scopeValue: "Velachery",
    });
    tickets.push(seedRow("mla-local", "Velachery local/MLA queue", mlaTicket, "MLA Dashboard", "local", "Open local ticket visible to the Velachery MLA account."));

    const councillorBase = await createTicket(app, options.runId, "councillor-ward-48", verificationToken, {
      category: "sanitation",
      title: "Garbage pile beside Ward 48 playground",
      description: "Garbage has not been removed near the playground entrance and should be closed by the ward owner.",
      phoneSuffix: "71004",
      district: "Chennai",
      area: "Velachery",
      address: "Ward 48 playground entrance",
      departmentHint: "Corporation / Municipality",
      evidence: [{ fileName: "ward-48-garbage.jpg", mimeType: "image/jpeg", sizeBytes: 390_000 }],
    });
    const councillorTicket = await decide(app, options.runId, "councillor-ward-48", councillorBase.id, verificationToken, {
      action: "route_local",
      actor: "verification:prototype",
      reason: "Ward-level sanitation complaint for Ward 48 local closure.",
      ownerKey: "local:ward-48",
      ownerLabel: "Ward 48 Local Field Team",
      scopeValue: "Ward 48",
    });
    tickets.push(seedRow("councillor-ward-48", "Ward 48 local queue", councillorTicket, "Councillor role on local dashboard", "local", "Open ward ticket visible to the Ward 48 councillor account."));

    const resolvedBase = await createTicket(app, options.runId, "resolved", verificationToken, {
      category: "roads",
      title: "Loose road barricade removed after inspection",
      description: "A loose barricade blocked part of the service road and is seeded as a completed closure sample.",
      phoneSuffix: "71005",
      district: "Chennai",
      area: "Velachery",
      address: "Velachery service road near signal",
      departmentHint: "Corporation / Municipality",
      evidence: [{ fileName: "barricade-before.jpg", mimeType: "image/jpeg", sizeBytes: 280_000 }],
    });
    await decide(app, options.runId, "resolved", resolvedBase.id, verificationToken, {
      action: "route_local",
      actor: "verification:prototype",
      reason: "Complete road safety complaint routed for closure sample.",
      ownerKey: "mla:velachery",
      ownerLabel: "Velachery MLA Office",
      scopeValue: "Velachery",
    });
    const resolvedTicket = await fieldAction(app, resolvedBase.id, mlaToken, "mla", {
      action: "resolve",
      actor: "mla:prototype",
      resolutionNote: "Field owner removed the loose barricade and attached closure proof for local UAT.",
      checklist: {
        fieldVisitCompleted: true,
        evidenceAttached: true,
        citizenImpactChecked: true,
        safetyRiskClosed: true,
      },
      evidence: [{ label: "closure", fileName: "barricade-after.jpg", mimeType: "image/jpeg", sizeBytes: 320_000 }],
    });
    tickets.push(seedRow("resolved", "Resolved closure sample", resolvedTicket, "MLA Dashboard / ticket detail", "local", "Resolved ticket for closure and citizen status review."));

    const awaitingBase = await createTicket(app, options.runId, "awaiting-citizen", verificationToken, {
      category: "water",
      title: "Water pressure complaint missing door numbers",
      description: "Water pressure issue was reported but needs affected street and door numbers before routing.",
      phoneSuffix: "71006",
      district: "Madurai",
      area: "K. Pudur",
      address: "K. Pudur residential block",
      departmentHint: "Municipal Administration and Water Supply",
    });
    const awaitingTicket = await decide(app, options.runId, "awaiting-citizen", awaitingBase.id, verificationToken, {
      action: "request_info",
      actor: "verification:prototype",
      reason: "Missing exact affected door numbers and timing details.",
      missingFields: ["affected door numbers", "water outage timing"],
      citizenMessage: "Please add the affected door numbers and the time when water pressure drops.",
    });
    tickets.push(seedRow("awaiting-citizen", "Awaiting citizen clarification", awaitingTicket, "Verification Console", "citizen", "Paused SLA with verification secondary visibility."));

    const protectedBase = await createTicket(app, options.runId, "protected-corruption", verificationToken, {
      category: "corruption",
      title: "Protected allegation about local works payment",
      description: "Citizen alleges a payment demand connected to local works approval and asks for confidential screening.",
      phoneSuffix: "71007",
      district: "Coimbatore",
      area: "Peelamedu",
      address: "Peelamedu zonal office area",
      departmentHint: "Protected vigilance review",
      evidence: [{ fileName: "payment-reference.pdf", mimeType: "application/pdf", sizeBytes: 760_000 }],
    });
    const protectedTicket = await decide(app, options.runId, "protected-corruption", protectedBase.id, verificationToken, {
      action: "route_protected",
      actor: "verification:prototype",
      reason: "Sensitive corruption allegation kept in protected CM Cell / vigilance screening.",
    });
    tickets.push(seedRow("protected-corruption", "Protected corruption screening", protectedTicket, "CM Cell protected queue / Verification", "protected_review", "Hidden from MLA, councillor, department officer, and minister roles."));

    const rejectedBase = await createTicket(app, options.runId, "rejection-review", verificationToken, {
      category: "revenue",
      title: "Duplicate patta transfer query without reference",
      description: "The complaint appears to duplicate an existing revenue office query and is seeded for rejection review.",
      phoneSuffix: "71008",
      district: "Tiruchirappalli",
      area: "Srirangam",
      address: "Srirangam taluk office",
      departmentHint: "Revenue",
    });
    const rejectedTicket = await decide(app, options.runId, "rejection-review", rejectedBase.id, verificationToken, {
      action: "reject",
      actor: "verification:prototype",
      reason: "Seeded duplicate-like case for CM-maintained rejection review.",
    });
    tickets.push(seedRow("rejection-review", "CM-maintained rejection review", rejectedTicket, "CM Cell rejection review", "rejection_review", "Tests rejected-ticket oversight outside local visibility."));

    const verificationTicket = await createTicket(app, options.runId, "verification-new", verificationToken, {
      category: "roads",
      title: "New road complaint waiting for verification",
      description: "Newly submitted road issue with enough data to test intake review and routing.",
      phoneSuffix: "71009",
      district: "Chennai",
      area: "T. Nagar",
      address: "Usman Road pedestrian crossing",
      departmentHint: "Corporation / Municipality",
      evidence: [{ fileName: "t-nagar-crossing.jpg", mimeType: "image/jpeg", sizeBytes: 410_000 }],
    });
    tickets.push(seedRow("verification-new", "Fresh verification queue item", verificationTicket, "Verification Console", "verification", "Untouched intake ticket for route/request/reject testing."));

    const summary: SeedSummary = {
      kind: "whistle-mvp1-local-uat-seed",
      runId: options.runId,
      envFile,
      generatedAt: new Date().toISOString(),
      accounts,
      tickets: tickets.map((item) => ({
        key: item.key,
        label: item.label,
        ticketId: item.ticket.id,
        category: item.ticket.category,
        status: item.ticket.status,
        protected: item.ticket.protected,
        primaryQueue: item.ticket.primaryQueue.kind,
        scope: `${item.ticket.primaryQueue.scope.jurisdiction}:${item.ticket.primaryQueue.scope.value}`,
        expectedSurface: item.expectedSurface,
        notes: item.notes,
      })),
      checks: {
        cmCellTickets: await dashboardCount(app, tokenFor("cm_cell:prototype"), "cm_cell", "role=cm_cell&queue=cm_cell&ticketLimit=100"),
        mawsTickets: await dashboardCount(app, ministerToken, "minister", "role=minister&ministry=Municipal+Administration+and+Water+Supply&ticketLimit=100"),
        mlaVelacheryTickets: await dashboardCount(app, mlaToken, "mla", "role=mla&constituency=Velachery&ticketLimit=100"),
        councillorWard48Tickets: await dashboardCount(app, tokenFor("councillor:prototype"), "councillor", "role=councillor&ward=Ward+48&ticketLimit=100"),
        verificationTickets: await verificationCount(app, verificationToken),
        protectedVisibility: {
          cmCellDashboardMatches: await dashboardTicketMatches(
            app,
            tokenFor("cm_cell:prototype"),
            "cm_cell",
            "role=cm_cell&queue=protected_review&ticketLimit=100",
            protectedTicket.id,
            { "x-whistle-access-reason": "Local UAT protected dashboard fixture review" },
          ),
          ministerDashboardMatches: await dashboardTicketMatches(
            app,
            ministerToken,
            "minister",
            "role=minister&ministry=Municipal+Administration+and+Water+Supply&ticketLimit=100",
            protectedTicket.id,
          ),
          departmentOfficerDashboardMatches: await dashboardTicketMatches(
            app,
            tokenFor("department_officer:prototype"),
            "department_officer",
            "role=department_officer&ministry=Municipal+Administration+and+Water+Supply&ticketLimit=100",
            protectedTicket.id,
          ),
          mlaDashboardMatches: await dashboardTicketMatches(app, mlaToken, "mla", "role=mla&constituency=Velachery&ticketLimit=100", protectedTicket.id),
          councillorDashboardMatches: await dashboardTicketMatches(
            app,
            tokenFor("councillor:prototype"),
            "councillor",
            "role=councillor&ward=Ward+48&ticketLimit=100",
            protectedTicket.id,
          ),
          cmCellDirectStatus: await directTicketStatus(app, tokenFor("cm_cell:prototype"), "cm_cell", protectedTicket.id, {
            "x-whistle-access-reason": "Local UAT protected direct fixture review",
          }),
          verificationDirectStatus: await directTicketStatus(app, verificationToken, "verification", protectedTicket.id, {
            "x-whistle-access-reason": "Local UAT protected verification detail review",
          }),
          ministerDirectStatus: await directTicketStatus(app, ministerToken, "minister", protectedTicket.id),
          departmentOfficerDirectStatus: await directTicketStatus(app, tokenFor("department_officer:prototype"), "department_officer", protectedTicket.id),
          mlaDirectStatus: await directTicketStatus(app, mlaToken, "mla", protectedTicket.id),
          councillorDirectStatus: await directTicketStatus(app, tokenFor("councillor:prototype"), "councillor", protectedTicket.id),
        },
      },
    };

    assert(summary.checks.cmCellTickets > 0, "Seed should leave at least one CM Cell ticket.");
    assert(summary.checks.mawsTickets > 0, "Seed should leave at least one MAWS ministry ticket.");
    assert(summary.checks.mlaVelacheryTickets > 0, "Seed should leave at least one Velachery MLA ticket.");
    assert(summary.checks.councillorWard48Tickets > 0, "Seed should leave at least one Ward 48 councillor ticket.");
    assert(summary.checks.verificationTickets > 0, "Seed should leave at least one verification ticket.");
    assert(summary.checks.protectedVisibility.cmCellDashboardMatches === 1, "CM Cell dashboard should see the protected corruption fixture.");
    assert(summary.checks.protectedVisibility.cmCellDirectStatus === 200, "CM Cell should read protected fixture detail with an access reason.");
    assert(summary.checks.protectedVisibility.verificationDirectStatus === 200, "Verification should read protected fixture detail with an access reason.");
    assert(summary.checks.protectedVisibility.ministerDashboardMatches === 0, "Minister dashboard must not show the protected corruption fixture.");
    assert(summary.checks.protectedVisibility.departmentOfficerDashboardMatches === 0, "Department officer dashboard must not show the protected corruption fixture.");
    assert(summary.checks.protectedVisibility.mlaDashboardMatches === 0, "MLA dashboard must not show the protected corruption fixture.");
    assert(summary.checks.protectedVisibility.councillorDashboardMatches === 0, "Councillor dashboard must not show the protected corruption fixture.");
    assert(summary.checks.protectedVisibility.ministerDirectStatus === 403, "Minister direct read must reject the protected corruption fixture.");
    assert(summary.checks.protectedVisibility.departmentOfficerDirectStatus === 403, "Department officer direct read must reject the protected corruption fixture.");
    assert(summary.checks.protectedVisibility.mlaDirectStatus === 403, "MLA direct read must reject the protected corruption fixture.");
    assert(summary.checks.protectedVisibility.councillorDirectStatus === 403, "Councillor direct read must reject the protected corruption fixture.");

    return summary;
  } finally {
    await app.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = await createMvp1LocalUatSeedSummary(options);

  if (options.out) {
    const outPath = resolve(process.cwd(), options.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, options.json ? `${JSON.stringify(summary, null, 2)}\n` : renderMarkdown(summary), "utf8");
  }

  if (options.quiet) {
    process.stdout.write(`Whistle MVP1 local UAT seed validated ${summary.tickets.length} ticket(s) for ${summary.accounts.length} role account(s). Run ID: ${summary.runId}\n`);
  } else {
    process.stdout.write(options.json ? `${JSON.stringify(summary, null, 2)}\n` : renderMarkdown(summary));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
