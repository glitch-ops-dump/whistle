import { buildWhistleApi } from "../server/app.js";
import type { NotificationIntent, TicketRecord } from "../server/ticket-spine/types.js";
import { withVerifiedPhone } from "./smoke-helpers.js";

type WhistleApi = ReturnType<typeof buildWhistleApi>;

const cmCellHeaders = {
  "x-whistle-role": "cm_cell",
  "x-whistle-actor": "cm_cell:prototype",
  "x-whistle-access-reason": "Notification template smoke protected review.",
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
    method: "GET" | "POST";
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

async function createTicket(app: WhistleApi, payload: Record<string, unknown>) {
  const verifiedPayload = await withVerifiedPhone(app, payload);
  const result = await jsonRequest<{ ticket: TicketRecord }>(
    app,
    {
      method: "POST",
      url: "/api/tickets",
      payload: verifiedPayload,
    },
    201,
  );
  return result.ticket;
}

async function notifications(app: WhistleApi, ticketId: string) {
  const result = await jsonRequest<{ notifications: NotificationIntent[] }>(app, {
    method: "GET",
    url: `/api/tickets/${encodeURIComponent(ticketId)}/notifications`,
    headers: cmCellHeaders,
  });
  return result.notifications;
}

function serializedMessages(items: NotificationIntent[]) {
  return items.map((item) => item.safeMessage).join(" || ");
}

async function run() {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalSeedDemo = process.env.WHISTLE_SEED_DEMO;
  delete process.env.DATABASE_URL;
  process.env.WHISTLE_SEED_DEMO = "false";

  const app = buildWhistleApi();
  await app.ready();

  try {
    const civicTicket = await createTicket(app, {
      category: "roads",
      language: "en",
      title: "Private pothole note near sensitive address",
      description: "This description has a private landmark and must never be copied into SMS or WhatsApp notification text.",
      phone: "+91 98765 90001",
      departmentHint: "Corporation / Municipality",
      location: {
        district: "Chennai",
        area: "T. Nagar",
        address: "12 Private Street",
        landmark: "Sensitive private landmark",
      },
      evidence: [{ fileName: "private-pothole-photo.jpg", mimeType: "image/jpeg", sizeBytes: 500_000 }],
    });

    const civicNotifications = await notifications(app, civicTicket.id);
    assert(civicNotifications.some((item) => item.channel === "whatsapp"), "Non-protected civic ticket should queue a WhatsApp-safe update.");
    assert(civicNotifications.some((item) => item.channel === "sms"), "Non-protected civic ticket should queue an SMS-safe update.");
    assert(civicNotifications.some((item) => item.channel === "in_app"), "Non-protected civic ticket should queue an in-app update.");
    const civicMessages = serializedMessages(civicNotifications);
    for (const forbidden of ["Private pothole note", "private landmark", "Private Street", "private-pothole-photo", "+91"]) {
      assert(!civicMessages.includes(forbidden), `Civic notification leaked private value: ${forbidden}`);
    }
    assert(civicMessages.includes("Whistle WhatsApp update"), "WhatsApp template should identify the channel safely.");
    pass("non-protected notifications include SMS, WhatsApp, and in-app safe templates without private leakage");

    const tamilTicket = await createTicket(app, {
      category: "water",
      language: "ta",
      title: "Water supply issue for Tamil template",
      description: "Water supply has stopped and the notification template should use Tamil-safe text.",
      phone: "+91 98765 90002",
      location: {
        district: "Madurai",
        area: "K. Pudur",
        landmark: "Public tank",
      },
      evidence: [],
    });
    const tamilMessages = serializedMessages(await notifications(app, tamilTicket.id));
    assert(tamilMessages.includes("புகார் பதிவு செய்யப்பட்டது") || tamilMessages.includes("சரிபார்ப்பு"), "Tamil ticket should use Tamil notification copy.");
    pass("Tamil ticket receives localized notification copy");

    const protectedTicket = await createTicket(app, {
      category: "corruption",
      language: "en",
      title: "Bribe demand with sensitive officer name",
      description: "A named officer demanded a cash bribe. These details must never appear in external notification text.",
      phone: "+91 98765 90003",
      departmentHint: "Revenue",
      location: {
        district: "Coimbatore",
        area: "Taluk Office",
        landmark: "Counter 4",
      },
      evidence: [{ fileName: "bribe-proof.pdf", mimeType: "application/pdf", sizeBytes: 300_000 }],
    });

    const protectedNotifications = await notifications(app, protectedTicket.id);
    assert(!protectedNotifications.some((item) => item.channel === "whatsapp"), "Protected ticket should not queue WhatsApp in MVP templates.");
    const protectedMessages = serializedMessages(protectedNotifications);
    for (const forbidden of ["Bribe", "bribe", "officer", "cash", "Taluk Office", "bribe-proof", "Counter 4"]) {
      assert(!protectedMessages.includes(forbidden), `Protected notification leaked sensitive value: ${forbidden}`);
    }
    assert(protectedMessages.includes("secure status update"), "Protected notifications should use secure generic status language.");
    pass("protected notifications stay generic and avoid WhatsApp");

    pass("notification template smoke completed");
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
