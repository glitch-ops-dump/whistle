import { buildWhistleApi } from "../server/app.js";
import { agentServiceConfigured } from "../server/ticket-spine/agentGateway.js";
import type { AgentRecommendationRun, TicketRecord } from "../server/ticket-spine/types.js";
import { withVerifiedPhone } from "./smoke-helpers.js";

type WhistleApi = ReturnType<typeof buildWhistleApi>;

const verificationHeaders = {
  "x-whistle-role": "verification",
  "x-whistle-actor": "verification:prototype",
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

async function jsonRequest<T>(
  app: WhistleApi,
  options: { method: "GET" | "POST"; url: string; payload?: unknown; headers?: Record<string, string> },
  expectedStatus = 200,
) {
  const response = await app.inject({ method: options.method, url: options.url, headers: options.headers, payload: options.payload });
  assert(
    response.statusCode === expectedStatus,
    `${options.method} ${options.url} returned ${response.statusCode}; expected ${expectedStatus}. Body: ${response.body}`,
  );
  return response.json<T>();
}

async function createTicket(app: WhistleApi) {
  const payload = await withVerifiedPhone(app, {
    category: "roads",
    language: "en",
    title: "Pothole near bus stop needs repair",
    description: "There is a large pothole near the bus stop and it is risky during rain.",
    phone: "+91 98765 70090",
    location: { district: "Chennai", area: "Anna Nagar" },
    evidence: [],
  });
  const result = await jsonRequest<{ ticket: TicketRecord }>(app, { method: "POST", url: "/api/tickets", payload }, 201);
  return result.ticket;
}

async function runAgent(app: WhistleApi, ticketId: string) {
  const result = await jsonRequest<{ run: AgentRecommendationRun }>(
    app,
    { method: "POST", url: `/api/verification/${encodeURIComponent(ticketId)}/agent-runs`, headers: verificationHeaders },
    201,
  );
  return result.run;
}

async function run() {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalSeedDemo = process.env.WHISTLE_SEED_DEMO;
  const originalServiceUrl = process.env.WHISTLE_AGENT_SERVICE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.WHISTLE_AGENT_SERVICE_URL;
  process.env.WHISTLE_SEED_DEMO = "false";

  const app = buildWhistleApi();
  await app.ready();

  try {
    assert(!agentServiceConfigured(), "Gateway should default to in-process when no service URL is set.");
    const ticket = await createTicket(app);

    const inProcess = await runAgent(app, ticket.id);
    assert(inProcess.modelVersion === "deterministic-prototype-rules", "Default path should use the in-process deterministic baseline.");
    pass("agent gateway defaults to in-process deterministic recommendation");

    // Point the gateway at an unreachable service; it must fall back, not fail.
    process.env.WHISTLE_AGENT_SERVICE_URL = "http://127.0.0.1:1";
    assert(agentServiceConfigured(), "Gateway should report configured once a service URL is set.");
    const fallback = await runAgent(app, ticket.id);
    assert(
      fallback.modelVersion === "deterministic-prototype-rules",
      "Unreachable agent service must fall back to the deterministic baseline.",
    );
    pass("agent gateway falls back to the deterministic baseline when the service is unreachable");

    pass("agent gateway smoke completed");
  } finally {
    await app.close();
    if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
    else delete process.env.DATABASE_URL;
    if (originalSeedDemo === undefined) delete process.env.WHISTLE_SEED_DEMO;
    else process.env.WHISTLE_SEED_DEMO = originalSeedDemo;
    if (originalServiceUrl === undefined) delete process.env.WHISTLE_AGENT_SERVICE_URL;
    else process.env.WHISTLE_AGENT_SERVICE_URL = originalServiceUrl;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
