import { buildWhistleApi } from "../server/app.js";
import type { AccessGrant, AccessSnapshot, AccessTeam, AccessUser, EffectiveAccess, TeamMembership } from "../server/access/types.js";
import { withVerifiedPhone } from "./smoke-helpers.js";

type WhistleApi = ReturnType<typeof buildWhistleApi>;

type AdminAccessPayload = {
  mode: string;
  access: AccessSnapshot;
};

type EffectiveAccessPayload = {
  effectiveAccess: EffectiveAccess;
};

const adminHeaders = {
  "x-whistle-role": "admin",
  "x-whistle-actor": "admin:prototype",
};

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
    headers: options.headers ?? adminHeaders,
    payload: options.payload,
  });

  assert(
    response.statusCode === expectedStatus,
    `${options.method} ${options.url} returned ${response.statusCode}; expected ${expectedStatus}. Body: ${response.body}`,
  );

  return response.json<T>();
}

async function getAccess(app: WhistleApi) {
  return jsonRequest<AdminAccessPayload>(app, { method: "GET", url: "/api/admin/access" });
}

async function getEffectiveAccess(app: WhistleApi, actor: string) {
  const encodedActor = encodeURIComponent(actor);
  const payload = await jsonRequest<EffectiveAccessPayload>(app, {
    method: "GET",
    url: `/api/admin/access/effective?actor=${encodedActor}`,
  });
  return payload.effectiveAccess;
}

function roleCount(snapshot: AccessSnapshot, userId: string, teamId: string) {
  return snapshot.memberships.filter((membership) => membership.userId === userId && membership.teamId === teamId).length;
}

function hasRole(access: EffectiveAccess, role: string) {
  return access.roles.includes(role as EffectiveAccess["roles"][number]);
}

async function createCitizenTicket(
  app: WhistleApi,
  input: {
    category: "roads" | "power";
    title: string;
    description: string;
    phone: string;
    district: string;
    area: string;
  },
) {
  const payload = await withVerifiedPhone(app, {
    category: input.category,
    language: "en",
    title: input.title,
    description: input.description,
    phone: input.phone,
    location: {
      district: input.district,
      area: input.area,
      address: `${input.area} main road`,
    },
    evidence: [],
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/tickets",
    payload,
  });
  assert(response.statusCode === 201, `Citizen ticket create returned ${response.statusCode}; expected 201. Body: ${response.body}`);
  const result = response.json<{ ticket: { id: string } | null; rejected?: { error?: string; message?: string } | null }>();
  assert(result.ticket, `Citizen ticket should be accepted. Rejection: ${result.rejected?.message ?? result.rejected?.error ?? "unknown"}`);
  return result.ticket;
}

async function expectGetStatus(app: WhistleApi, url: string, headers: Record<string, string>, expectedStatus: number) {
  const response = await app.inject({
    method: "GET",
    url,
    headers,
  });
  assert(response.statusCode === expectedStatus, `GET ${url} returned ${response.statusCode}; expected ${expectedStatus}. Body: ${response.body}`);
}

async function run() {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  const app = buildWhistleApi();
  await app.ready();

  try {
    const baseline = await getAccess(app);
    assert(baseline.mode.includes("access"), "Admin access snapshot should report the access repository mode.");
    assert(baseline.access.users.some((user) => user.actorKey === "admin:prototype"), "Seed admin user should exist.");
    pass("admin access snapshot loads from the API");

    await jsonRequest(
      app,
      {
        method: "GET",
        url: "/api/admin/access",
        headers: {
          "x-whistle-role": "minister",
          "x-whistle-actor": "minister:prototype",
        },
      },
      403,
    );
    await jsonRequest(
      app,
      {
        method: "GET",
        url: "/api/admin/access",
        headers: {
          "x-whistle-role": "admin",
          "x-whistle-actor": "admin:missing",
        },
      },
      403,
    );
    pass("access management rejects wrong roles and ungranted admin actors");

    const ministerHeaders = {
      "x-whistle-role": "minister",
      "x-whistle-actor": "minister:prototype",
    };
    const cmHeaders = {
      "x-whistle-role": "cm_cell",
      "x-whistle-actor": "cm_cell:prototype",
    };
    const mawsTicket = await createCitizenTicket(app, {
      category: "roads",
      title: "Scoped road access smoke",
      description: "A road repair complaint used to verify direct ticket-read scope for the assigned ministry.",
      phone: "+919800000401",
      district: "Chennai",
      area: "Velachery",
    });
    const energyTicket = await createCitizenTicket(app, {
      category: "power",
      title: "Out of scope power smoke",
      description: "A power outage complaint used to verify direct ticket-read scope blocks unrelated ministries.",
      phone: "+919800000402",
      district: "Coimbatore",
      area: "RS Puram",
    });
    await expectGetStatus(app, `/api/tickets/${encodeURIComponent(mawsTicket.id)}`, ministerHeaders, 403);
    await expectGetStatus(app, `/api/tickets/${encodeURIComponent(energyTicket.id)}`, ministerHeaders, 403);
    await expectGetStatus(app, `/api/tickets/${encodeURIComponent(energyTicket.id)}/notifications`, ministerHeaders, 403);
    await expectGetStatus(app, `/api/tickets/${encodeURIComponent(energyTicket.id)}`, cmHeaders, 200);
    await expectGetStatus(app, "/api/audit", verificationHeaders, 403);
    await expectGetStatus(app, "/api/notifications/outbox", verificationHeaders, 403);
    await jsonRequest(
      app,
      {
        method: "POST",
        url: `/api/verification/${encodeURIComponent(mawsTicket.id)}/decision`,
        headers: verificationHeaders,
        payload: {
          action: "route_local",
          actor: "verification:prototype",
          reason: "Access smoke routes this ticket out of verification scope.",
          ownerKey: "ward:48",
          ownerLabel: "Ward 48 Local Owner",
          scopeValue: "Ward 48",
        },
      },
    );
    await expectGetStatus(app, `/api/tickets/${encodeURIComponent(mawsTicket.id)}`, verificationHeaders, 200);
    await expectGetStatus(app, `/api/audit?ticketId=${encodeURIComponent(mawsTicket.id)}`, verificationHeaders, 200);
    await expectGetStatus(app, `/api/notifications/outbox?ticketId=${encodeURIComponent(mawsTicket.id)}`, verificationHeaders, 200);
    await expectGetStatus(app, `/api/audit?ticketId=${encodeURIComponent(mawsTicket.id)}`, cmHeaders, 200);
    pass("direct ticket, audit, and outbox reads enforce active operational role scope and ticket filters");

    const suffix = Date.now().toString(36);
    const actorKey = `mla:smoke-${suffix}`;

    const { user } = await jsonRequest<{ user: AccessUser }>(
      app,
      {
        method: "POST",
        url: "/api/admin/access/users",
        payload: {
          actorKey,
          displayName: "Smoke Test MLA Coordinator",
          status: "active",
          mfaState: "enabled",
        },
      },
      201,
    );

    const { team } = await jsonRequest<{ team: AccessTeam }>(
      app,
      {
        method: "POST",
        url: "/api/admin/access/teams",
        payload: {
          name: `Smoke Test Velachery Team ${suffix}`,
          role: "mla",
          ownerActorKey: actorKey,
          defaultScopeKind: "constituency",
          defaultScopeValue: "Velachery",
        },
      },
      201,
    );

    const { membership } = await jsonRequest<{ membership: TeamMembership }>(
      app,
      {
        method: "POST",
        url: "/api/admin/access/memberships",
        payload: {
          userId: user.id,
          teamId: team.id,
          roleLabel: "Coordinator",
        },
      },
      201,
    );

    const { grant } = await jsonRequest<{ grant: AccessGrant }>(
      app,
      {
        method: "POST",
        url: "/api/admin/access/grants",
        payload: {
          targetType: "team",
          targetId: team.id,
          role: "mla",
          scopeKind: "constituency",
          scopeValue: "Velachery",
          protectedAccess: false,
          reporterIdentity: false,
          actions: ["dashboard.read", "ticket.read"],
        },
      },
      201,
    );
    pass("user, team, membership, and scoped grant can be created");

    let effective = await getEffectiveAccess(app, actorKey);
    assert(hasRole(effective, "mla"), "Effective access should include the team-derived MLA role.");
    assert(effective.actions.includes("dashboard.read"), "Effective access should include dashboard.read.");
    assert(!effective.protectedAccess && !effective.reporterIdentity, "MLA test grant should start without protected or reporter visibility.");
    pass("team membership grants effective MLA access");

    await jsonRequest<{ user: AccessUser }>(app, {
      method: "PATCH",
      url: `/api/admin/access/users/${encodeURIComponent(user.id)}`,
      payload: { status: "inactive" },
    });
    effective = await getEffectiveAccess(app, actorKey);
    assert(!effective.user && effective.roles.length === 0, "Inactive user should have no effective access.");

    await jsonRequest<{ user: AccessUser }>(app, {
      method: "PATCH",
      url: `/api/admin/access/users/${encodeURIComponent(user.id)}`,
      payload: { status: "active" },
    });
    effective = await getEffectiveAccess(app, actorKey);
    assert(hasRole(effective, "mla"), "Reactivated user should regain effective access.");
    pass("user deactivate/reactivate updates effective access");

    await jsonRequest<{ grant: AccessGrant }>(app, {
      method: "PATCH",
      url: `/api/admin/access/grants/${encodeURIComponent(grant.id)}`,
      payload: { protectedAccess: true, reporterIdentity: true },
    });
    effective = await getEffectiveAccess(app, actorKey);
    assert(effective.protectedAccess && effective.reporterIdentity, "Grant visibility toggles should affect effective access.");
    pass("grant visibility changes are reflected in effective access");

    await jsonRequest<{ team: AccessTeam }>(app, {
      method: "PATCH",
      url: `/api/admin/access/teams/${encodeURIComponent(team.id)}`,
      payload: { status: "inactive" },
    });
    effective = await getEffectiveAccess(app, actorKey);
    assert(!hasRole(effective, "mla"), "Inactive team should remove team-derived role.");

    await jsonRequest<{ team: AccessTeam }>(app, {
      method: "PATCH",
      url: `/api/admin/access/teams/${encodeURIComponent(team.id)}`,
      payload: { status: "active" },
    });
    effective = await getEffectiveAccess(app, actorKey);
    assert(hasRole(effective, "mla"), "Reactivated team should restore team-derived role.");
    pass("team deactivate/reactivate updates effective access");

    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    await jsonRequest<{ membership: TeamMembership }>(app, {
      method: "PATCH",
      url: `/api/admin/access/memberships/${encodeURIComponent(membership.id)}`,
      payload: { expiresAt: expiredAt },
    });
    effective = await getEffectiveAccess(app, actorKey);
    assert(!hasRole(effective, "mla"), "Expired membership should remove team-derived role.");

    const { membership: restoredMembership } = await jsonRequest<{ membership: TeamMembership }>(
      app,
      {
        method: "POST",
        url: "/api/admin/access/memberships",
        payload: {
          userId: user.id,
          teamId: team.id,
          roleLabel: "Restored Coordinator",
        },
      },
      201,
    );

    const afterRestore = await getAccess(app);
    effective = await getEffectiveAccess(app, actorKey);
    assert(restoredMembership.id === membership.id, "Re-adding a user to the same team should restore the existing membership id.");
    assert(restoredMembership.roleLabel === "Restored Coordinator", "Restored membership should update the role label.");
    assert(restoredMembership.expiresAt === undefined, "Restored membership should clear expiry.");
    assert(roleCount(afterRestore.access, user.id, team.id) === 1, "Restored membership should not create duplicates.");
    assert(hasRole(effective, "mla"), "Restored membership should return effective role access.");
    pass("membership restore/upsert preserves one active user-team assignment");

    pass("access lifecycle smoke completed");
  } finally {
    await app.close();
    if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
