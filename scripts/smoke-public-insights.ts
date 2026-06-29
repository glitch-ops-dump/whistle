import { buildWhistleApi } from "../server/app.js";
import type { PublicInsights, TicketRecord } from "../server/ticket-spine/types.js";
import { withVerifiedPhone } from "./smoke-helpers.js";

type WhistleApi = ReturnType<typeof buildWhistleApi>;

const adminHeaders = {
  "x-whistle-role": "admin",
  "x-whistle-actor": "admin:prototype",
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

async function jsonRequest<T>(
  app: WhistleApi,
  options: {
    method: "GET" | "POST" | "PATCH";
    url: string;
    payload?: unknown;
    headers?: Record<string, string>;
  },
  expectedStatus = 200,
) {
  const response = await app.inject({
    method: options.method,
    url: options.url,
    headers: options.headers,
    payload: options.payload,
  });

  assert(
    response.statusCode === expectedStatus,
    `${options.method} ${options.url} returned ${response.statusCode}; expected ${expectedStatus}. Body: ${response.body}`,
  );

  return response.json<T>();
}

async function createTicket(app: WhistleApi, category: string, district: string, index: number) {
  const payload = await withVerifiedPhone(app, {
    category,
    language: "en",
    title: `${district} ${category} transparency smoke ${index}`,
    description: `Detailed private complaint description ${district}-${category}-${index} that must not appear in public insights.`,
    phone: `+91 98765 55${String(index).padStart(3, "0")}`,
    departmentHint: category === "water" ? "Metro Water / Local Body" : category === "health" ? "Health department" : category === "corruption" ? "Revenue" : "Corporation / Municipality",
    location: {
      district,
      area: `Area ${index}`,
      address: `${index} Private Street`,
      landmark: `Private landmark ${index}`,
    },
    evidence: [{ fileName: `private-${district}-${category}-${index}.jpg`, mimeType: "image/jpeg", sizeBytes: 480_000 }],
  });
  const result = await jsonRequest<{ ticket: TicketRecord }>(
    app,
    {
      method: "POST",
      url: "/api/tickets",
      payload,
    },
    201,
  );
  return result.ticket;
}

async function run() {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalSeedDemo = process.env.WHISTLE_SEED_DEMO;
  delete process.env.DATABASE_URL;
  process.env.WHISTLE_SEED_DEMO = "false";

  const app = buildWhistleApi();
  await app.ready();

  try {
    for (let index = 1; index <= 3; index += 1) {
      await createTicket(app, "roads", "Chennai", index);
    }
    for (let index = 1; index <= 2; index += 1) {
      await createTicket(app, "water", "Madurai", index + 10);
    }
    await createTicket(app, "health", "Salem", 21);
    const protectedTicket = await createTicket(app, "corruption", "Coimbatore", 31);
    assert(protectedTicket.protected, "Corruption ticket should be protected in the public insights smoke setup.");

    const delayedPayload = await jsonRequest<{ insights: PublicInsights }>(app, {
      method: "GET",
      url: "/api/public/insights",
    });
    assert(delayedPayload.insights.privacy.publicationDelayHours === 24, "Public insights should default to a 24-hour publication delay.");
    assert(delayedPayload.insights.assetPolicy.logo.src === "/assets/brand/whistle-fake-logo.svg", "Public insights should expose the neutral Whistle logo placeholder.");
    assert(delayedPayload.insights.assetPolicy.emblem.src === "/assets/brand/whistle-civic-mark.svg", "Public insights should expose the neutral civic mark.");
    assert(delayedPayload.insights.assetPolicy.portrait.src === "/assets/brand/whistle-service-portrait.svg", "Public insights should expose the neutral service illustration.");
    assert(delayedPayload.insights.trends.allTime.totalTickets === 0, "Fresh tickets should not publish before the default delay expires.");
    assert(delayedPayload.insights.privacy.withheldRecentTickets === 6, "Fresh non-protected tickets should be counted as delayed from public publication.");

    await jsonRequest(app, {
      method: "PATCH",
      url: "/api/admin/config/app-controls/public-publish-delay-hours",
      headers: adminHeaders,
      payload: { value: 0 },
    });

    const publicPayload = await jsonRequest<{ insights: PublicInsights }>(app, {
      method: "GET",
      url: "/api/public/insights",
    });
    const insights = publicPayload.insights;

    assert(insights.privacy.publicationDelayHours === 0, "Admin-configured zero delay should publish aggregate prototype data immediately.");
    assert(insights.trends.allTime.totalTickets === 6, "Public all-time total should include only non-protected publishable tickets.");
    assert(insights.trends.month.totalTickets === 6, "Public month total should include current-month non-protected tickets.");
    assert(insights.privacy.publicVisibleTickets === 6, "Privacy metadata should report six public-visible tickets.");
    assert(insights.privacy.withheldRecentTickets === 0, "No non-protected tickets should remain delayed after Admin sets the delay to zero.");
    assert(insights.privacy.protectedCount === 1, "Protected tickets should appear only as a statewide protected count.");
    assert(insights.openIssues.byDistrict.some((row) => row.label === "Chennai" && row.openTickets === 3), "District rows should include Chennai aggregate.");
    assert(insights.openIssues.byDistrict.some((row) => row.label === "Madurai" && row.openTickets === 2), "District rows should include Madurai aggregate.");
    assert(!insights.openIssues.byDistrict.some((row) => row.label === "Salem"), "Small public cells should be withheld from district rows.");
    assert(!insights.openIssues.byDistrict.some((row) => row.label === "Coimbatore"), "Protected district should not be exposed.");
    pass("public insights apply publication delay and return aggregate totals with thresholded open-issue rows");

    const serialized = JSON.stringify(insights);
    for (const forbidden of [
      "transparency smoke",
      "Detailed private complaint",
      "Private Street",
      "Private landmark",
      "private-",
      "+91",
      protectedTicket.id,
      "Coimbatore",
      "Corruption",
    ]) {
      assert(!serialized.includes(forbidden), `Public insights leaked forbidden value: ${forbidden}`);
    }
    pass("public insights omit ticket identity, raw complaint text, address, evidence, and protected details");

    // Configurable small-cell suppression threshold (privacy can be tightened, never weakened below 2).
    await jsonRequest(app, {
      method: "PATCH",
      url: "/api/admin/config/app-controls/public-cell-threshold",
      headers: adminHeaders,
      payload: { value: 3 },
    });
    const tightened = (
      await jsonRequest<{ insights: PublicInsights }>(app, { method: "GET", url: "/api/public/insights" })
    ).insights;
    assert(tightened.privacy.threshold === 3, "Admin should be able to raise the public small-cell suppression threshold.");
    assert(
      tightened.openIssues.byDistrict.some((row) => row.label === "Chennai"),
      "Chennai (3 tickets) should stay visible when the threshold is raised to 3.",
    );
    assert(
      !tightened.openIssues.byDistrict.some((row) => row.label === "Madurai"),
      "Madurai (2 tickets) should be withheld once the threshold is raised to 3.",
    );

    await jsonRequest(app, {
      method: "PATCH",
      url: "/api/admin/config/app-controls/public-cell-threshold",
      headers: adminHeaders,
      payload: { value: 1 },
    });
    const floored = (
      await jsonRequest<{ insights: PublicInsights }>(app, { method: "GET", url: "/api/public/insights" })
    ).insights;
    assert(
      floored.privacy.threshold === 2,
      "A threshold below the privacy floor of 2 must be clamped up to 2 so suppression is never weakened.",
    );
    assert(
      floored.openIssues.byDistrict.some((row) => row.label === "Madurai"),
      "Madurai (2 tickets) should be visible again at the floored threshold of 2.",
    );
    pass("public small-cell suppression threshold is configurable and floored at 2");

    await jsonRequest(
      app,
      {
        method: "PATCH",
        url: "/api/admin/config/app-controls/feature-public",
        headers: adminHeaders,
        payload: { value: false },
      },
    );
    await jsonRequest(
      app,
      {
        method: "GET",
        url: "/api/public/insights",
      },
      403,
    );
    pass("Admin public-insights feature flag disables the public endpoint");

    pass("public insights smoke completed");
  } finally {
    await app.close();
    if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
    else delete process.env.DATABASE_URL;
    if (originalSeedDemo === undefined) delete process.env.WHISTLE_SEED_DEMO;
    else process.env.WHISTLE_SEED_DEMO = originalSeedDemo;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
