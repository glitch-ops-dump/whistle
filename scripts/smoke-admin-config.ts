import { buildWhistleApi } from "../server/app.js";
import type { PublicAssetPolicy } from "../server/config/assetPolicy.js";
import type { CitizenCategoryAvailability } from "../server/config/lifecyclePolicy.js";
import type { AdminConfigSnapshot, LaunchReadinessReport } from "../server/config/types.js";
import type { TicketRecord } from "../server/ticket-spine/types.js";
import { withVerifiedPhone } from "./smoke-helpers.js";

type WhistleApi = ReturnType<typeof buildWhistleApi>;

const adminHeaders = {
  "x-whistle-role": "admin",
  "x-whistle-actor": "admin:prototype",
};

const adminReviewerHeaders = {
  "x-whistle-role": "admin",
  "x-whistle-actor": "admin:reviewer",
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

async function proposeAndApproveConfigChange<T>(
  app: WhistleApi,
  target: Record<string, unknown>,
  reason: string,
): Promise<T> {
  const created = await jsonRequest<{ changeRequest: { id: string; status: string } }>(
    app,
    {
      method: "POST",
      url: "/api/admin/governance/config-change-requests",
      payload: { target, reason },
    },
    201,
  );
  assert(created.changeRequest.status === "pending", "Critical config change should start pending.");

  const blockedSelfApproval = await app.inject({
    method: "POST",
    url: `/api/admin/governance/config-change-requests/${encodeURIComponent(created.changeRequest.id)}/approve`,
    headers: adminHeaders,
    payload: { reason: "Requester cannot approve their own critical change." },
  });
  assert(blockedSelfApproval.statusCode === 409, "Critical config change should require a second Admin approver.");

  return jsonRequest<T>(app, {
    method: "POST",
    url: `/api/admin/governance/config-change-requests/${encodeURIComponent(created.changeRequest.id)}/approve`,
    headers: adminReviewerHeaders,
    payload: { reason: "Second Admin approval for smoke test governance." },
  });
}

function ticketPayload(category: string, title: string) {
  return {
    category,
    language: "en",
    title,
    description: "Smoke test complaint with enough details to enter the MVP ticket spine.",
    phone: "+91 98765 44444",
    departmentHint: "Configured owner",
    location: {
      district: "Chennai",
      area: "Velachery",
      landmark: "Admin config smoke",
    },
    evidence: [],
  };
}

async function verifiedTicketPayload(app: WhistleApi, category: string, title: string) {
  return withVerifiedPhone(app, ticketPayload(category, title));
}

async function run() {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalSeedDemo = process.env.WHISTLE_SEED_DEMO;
  delete process.env.DATABASE_URL;
  process.env.WHISTLE_SEED_DEMO = "false";

  const app = buildWhistleApi();
  await app.ready();

  try {
    const configPayload = await jsonRequest<{ mode: string; config: AdminConfigSnapshot }>(app, {
      method: "GET",
      url: "/api/admin/config",
    });
    assert(configPayload.config.categories.some((category) => category.id === "water" && category.enabled), "Water should start enabled.");
    assert(
      configPayload.config.readiness.length === configPayload.config.categories.length,
      "Admin config should expose launch-readiness rows for every category.",
    );
    assert(
      configPayload.config.readiness.some(
        (readiness) => readiness.categoryId === "roads" && readiness.launchState === "ready" && readiness.sopStatus === "approved",
      ),
      "Roads should start launch-ready in the readiness matrix.",
    );
    assert(configPayload.config.slaPolicies.some((policy) => policy.stage === "local" && policy.durationDays === 7), "Local SLA should start at seven days.");
    assert(
      configPayload.config.appControls.some(
        (control) => control.id === "infra-citizen-otp-config-ref" && control.group === "Infrastructure" && control.valueType === "string",
      ),
      "Admin config should expose external provider reference controls for launch-gate handoff.",
    );
    assert(
      configPayload.config.appControls.some(
        (control) => control.id === "citizen-phone-otp-required" && control.group === "Privacy" && control.value === false,
      ),
      "Admin config should keep citizen phone OTP disabled until a real OTP provider is wired.",
    );
    assert(
      configPayload.config.appControls.some(
        (control) => control.id === "identity-gov-id-policy-mode" && control.group === "Privacy" && control.value === "phone-otp-only" && control.critical,
      ),
      "Admin config should expose a governed future Government ID policy mode.",
    );
    assert(
      configPayload.config.appControls.some(
        (control) => control.id === "identity-gov-id-provider-config-ref" && control.group === "Infrastructure" && control.valueType === "string" && control.critical,
      ),
      "Admin config should expose a governed Government ID provider/policy reference.",
    );
    assert(
      configPayload.config.appControls.some(
        (control) => control.id === "uat-launch-rehearsal-evidence-ref" && control.group === "Operations" && control.valueType === "string",
      ),
      "Admin config should expose MVP1 UAT evidence reference controls.",
    );
    assert(
      configPayload.config.appControls.some(
        (control) => control.id === "uat-verification-sop-approved" && control.group === "Operations" && control.critical,
      ),
      "Admin config should expose critical MVP1 operator UAT sign-off controls.",
    );
    assert(
      configPayload.config.appControls.some(
        (control) => control.id === "uat-defect-register-ref" && control.group === "Operations" && control.valueType === "string" && control.critical,
      ),
      "Admin config should expose MVP1 defect register reference controls.",
    );
    assert(
      configPayload.config.appControls.some(
        (control) => control.id === "uat-open-blocker-defects" && control.group === "Operations" && control.valueType === "number" && control.value === 0,
      ),
      "Admin config should expose MVP1 open defect count controls.",
    );
    assert(
      configPayload.config.appControls.some(
        (control) => control.id === "ops-restore-drill-evidence-ref" && control.group === "Operations" && control.valueType === "string",
      ),
      "Admin config should expose restore-drill evidence controls.",
    );
    assert(
      configPayload.config.appControls.some(
        (control) => control.id === "ops-incident-hold-policy-signed-off" && control.group === "Operations" && control.critical,
      ),
      "Admin config should expose critical deployment and incident sign-off controls.",
    );
    assert(
      configPayload.config.appControls.some(
        (control) => control.id === "ops-telemetry-launch-watch-evidence-ref" && control.group === "Operations" && control.valueType === "string" && control.critical,
      ),
      "Admin config should expose telemetry launch watch evidence controls.",
    );
    assert(
      configPayload.config.appControls.some(
        (control) => control.id === "ops-origin-allowlist-evidence-ref" && control.group === "Operations" && control.valueType === "string" && control.critical,
      ),
      "Admin config should expose browser origin allowlist evidence controls.",
    );
    assert(
      configPayload.config.appControls.some(
        (control) => control.id === "ops-incident-hold-policy-evidence-ref" && control.group === "Operations" && control.valueType === "string" && control.critical,
      ),
      "Admin config should expose incident hold policy evidence controls.",
    );
    pass("admin config snapshot loads with default category, readiness, and SLA policy");

    const launchReadiness = await jsonRequest<{ mode: string; report: LaunchReadinessReport }>(app, {
      method: "GET",
      url: "/api/admin/launch-readiness",
    });
    const initialAssetCheck = launchReadiness.report.checks.find((check) => check.id === "asset-review");
    const initialProductionCheck = launchReadiness.report.checks.find((check) => check.id === "production-seams");
    const initialOperatorUatCheck = launchReadiness.report.checks.find((check) => check.id === "operator-uat");
    const initialDeploymentIncidentCheck = launchReadiness.report.checks.find((check) => check.id === "deployment-incident");
    assert(launchReadiness.report.verdict === "no_go", "Default launch readiness should block public go-live until production seams are ready.");
    assert(initialAssetCheck?.status === "pass", "Asset and identity review should pass by default using neutral MVP1 placeholders.");
    assert(initialProductionCheck?.status === "blocker", "Prototype provider seams should block public launch by default.");
    assert(initialOperatorUatCheck?.status === "blocker", "Operator UAT and SOP sign-off should block public launch by default.");
    assert(initialDeploymentIncidentCheck?.status === "blocker", "Deployment and incident sign-off should block public launch by default.");
    assert(launchReadiness.report.counts.publicReadyCategories >= 1, "Launch readiness should count public-ready categories.");
    await jsonRequest(
      app,
      {
        method: "GET",
        url: "/api/admin/launch-readiness",
        headers: {
          "x-whistle-role": "minister",
          "x-whistle-actor": "minister:prototype",
        },
      },
      403,
    );
    pass("launch readiness gate uses neutral assets and blocks public go-live on production seams");

    await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "app_control",
        id: "identity-gov-id-policy-mode",
        value: "category-required",
      },
      "Enable category-scoped Government ID policy for launch-readiness smoke.",
    );
    await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "app_control",
        id: "identity-gov-id-required-categories",
        value: "ration,revenue",
      },
      "Set Government ID required categories for launch-readiness smoke.",
    );
    const govIdPolicyReadiness = await jsonRequest<{ mode: string; report: LaunchReadinessReport }>(app, {
      method: "GET",
      url: "/api/admin/launch-readiness",
    });
    const govIdProductionCheck = govIdPolicyReadiness.report.checks.find((check) => check.id === "production-seams");
    assert(
      govIdProductionCheck?.details.some((detail) => detail.includes("Government ID category policy")),
      "Launch readiness should block an enabled Government ID category policy without an approved provider/policy reference.",
    );
    await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "app_control",
        id: "identity-gov-id-policy-mode",
        value: "phone-otp-only",
      },
      "Restore MVP1 phone OTP identity policy after launch-readiness smoke.",
    );
    await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "app_control",
        id: "identity-gov-id-required-categories",
        value: "none",
      },
      "Restore MVP1 Government ID category policy after launch-readiness smoke.",
    );
    pass("Government ID identity policy options are governed and launch-gated when enabled");

    const citizenConfig = await jsonRequest<{ assetPolicy: PublicAssetPolicy; categories: CitizenCategoryAvailability[] }>(app, {
      method: "GET",
      url: "/api/citizen/config",
      headers: {},
    });
    const roadsAvailability = citizenConfig.categories.find((category) => category.id === "roads");
    const corruptionAvailability = citizenConfig.categories.find((category) => category.id === "corruption");
    const safetyAvailability = citizenConfig.categories.find((category) => category.id === "safety");
    assert(roadsAvailability?.intakeStatus === "open", "Citizen config should show roads as open.");
    assert(corruptionAvailability?.intakeStatus === "protected_pilot", "Citizen config should show corruption as protected pilot intake.");
    assert(safetyAvailability?.intakeStatus === "pilot_only", "Citizen config should show public safety as pilot-only.");
    assert(citizenConfig.assetPolicy.logo.src === "/assets/brand/whistle-fake-logo.svg", "Citizen config should expose the neutral Whistle logo placeholder by default.");
    assert(citizenConfig.assetPolicy.emblem.src === "/assets/brand/whistle-civic-mark.svg", "Citizen config should expose the neutral civic mark by default.");
    assert(citizenConfig.assetPolicy.portrait.src === "/assets/brand/whistle-service-portrait.svg", "Citizen config should expose the neutral service illustration by default.");
    assert(!("sopStatus" in citizenConfig.categories[0]), "Citizen config must not expose Admin SOP status.");
    assert(!("primaryOwner" in citizenConfig.categories[0]), "Citizen config must not expose Admin owner/routing internals.");
    pass("citizen config exposes only safe category intake availability");

    await jsonRequest(
      app,
      {
        method: "GET",
        url: "/api/admin/config",
        headers: {
          "x-whistle-role": "minister",
          "x-whistle-actor": "minister:prototype",
        },
      },
      403,
    );
    pass("admin config rejects non-admin roles");

    const trackableRoadsPayload = await verifiedTicketPayload(app, "roads", "Roads tracking during maintenance smoke");
    const createdBeforeMaintenance = await jsonRequest<{ ticket: TicketRecord }>(
      app,
      {
        method: "POST",
        url: "/api/tickets",
        payload: trackableRoadsPayload,
      },
      201,
    );
    assert(createdBeforeMaintenance.ticket.category === "roads", "Roads ticket should be accepted before maintenance mode is enabled.");

    const enabledMaintenance = await jsonRequest<{ control: { id: string; value: boolean } }>(app, {
      method: "PATCH",
      url: "/api/admin/config/app-controls/ops-maintenance",
      payload: { value: true },
    });
    assert(enabledMaintenance.control.id === "ops-maintenance" && enabledMaintenance.control.value === true, "Maintenance mode should be enabled.");

    const maintenanceCitizenConfig = await jsonRequest<{ categories: CitizenCategoryAvailability[] }>(app, {
      method: "GET",
      url: "/api/citizen/config",
      headers: {},
    });
    assert(
      maintenanceCitizenConfig.categories.every((category) => category.intakeStatus === "disabled"),
      "Maintenance mode should disable every category in citizen-safe config.",
    );
    assert(
      maintenanceCitizenConfig.categories.every((category) => category.message.toLowerCase().includes("maintenance")),
      "Maintenance mode should give citizens a safe public maintenance message.",
    );

    const pausedRoads = await jsonRequest<{ ticket: TicketRecord | null; rejected?: { error?: string } | null }>(app, {
      method: "POST",
      url: "/api/tickets",
      headers: {},
      payload: ticketPayload("roads", "Roads public intake paused smoke"),
    });
    assert(pausedRoads.ticket === null && pausedRoads.rejected?.error === "public_intake_paused", "Maintenance mode should pause new public ticket creation.");

    const trackedDuringMaintenance = await jsonRequest<{ ticket: TicketRecord }>(app, {
      method: "GET",
      url: `/api/tickets/${encodeURIComponent(createdBeforeMaintenance.ticket.id)}`,
      headers: {
        "x-whistle-citizen-phone": trackableRoadsPayload.phone,
        "x-whistle-citizen-token": trackableRoadsPayload.phoneVerificationToken,
      },
    });
    assert(trackedDuringMaintenance.ticket.id === createdBeforeMaintenance.ticket.id, "Maintenance mode should not block existing citizen ticket tracking.");

    const disabledMaintenance = await jsonRequest<{ control: { id: string; value: boolean } }>(app, {
      method: "PATCH",
      url: "/api/admin/config/app-controls/ops-maintenance",
      payload: { value: false },
    });
    assert(disabledMaintenance.control.id === "ops-maintenance" && disabledMaintenance.control.value === false, "Maintenance mode should be disabled again.");

    const restoredCitizenConfig = await jsonRequest<{ categories: CitizenCategoryAvailability[] }>(app, {
      method: "GET",
      url: "/api/citizen/config",
      headers: {},
    });
    assert(
      restoredCitizenConfig.categories.some((category) => category.id === "roads" && category.intakeStatus === "open"),
      "Citizen config should reopen launch-ready categories after maintenance mode is disabled.",
    );
    pass("maintenance mode pauses new public intake while preserving existing ticket tracking");

    const disabledWater = await jsonRequest<{ category: { id: string; enabled: boolean } }>(app, {
      method: "PATCH",
      url: "/api/admin/config/categories/water",
      payload: { enabled: false },
    });
    assert(disabledWater.category.enabled === false, "Water category should be disabled.");

    const blockedWater = await jsonRequest<{ ticket: TicketRecord | null; rejected?: { error?: string } | null }>(app, {
      method: "POST",
      url: "/api/tickets",
      payload: ticketPayload("water", "Water category disabled smoke"),
    });
    assert(blockedWater.ticket === null && blockedWater.rejected?.error === "category_disabled", "Disabled category should block citizen submission.");

    await jsonRequest(app, {
      method: "PATCH",
      url: "/api/admin/config/categories/water",
      payload: { enabled: true },
    });
    const allowedWater = await jsonRequest<{ ticket: TicketRecord }>(
      app,
      {
        method: "POST",
        url: "/api/tickets",
        payload: await verifiedTicketPayload(app, "water", "Water category enabled smoke"),
      },
      201,
    );
    assert(allowedWater.ticket.category === "water", "Re-enabled category should accept citizen submission.");
    pass("category toggles directly affect citizen ticket intake");

    const pilotWater = await jsonRequest<{ readiness: { categoryId: string; launchState: string; sopStatus: string } }>(app, {
      method: "PATCH",
      url: "/api/admin/config/category-readiness/water",
      payload: { launchState: "pilot_only", sopStatus: "scheduled" },
    });
    assert(pilotWater.readiness.launchState === "pilot_only" && pilotWater.readiness.sopStatus === "scheduled", "Readiness matrix should accept non-critical pilot edits.");

    const pilotOnlyWater = await jsonRequest<{ ticket: TicketRecord | null; rejected?: { error?: string; readiness?: { launchState: string } } | null }>(app, {
      method: "POST",
      url: "/api/tickets",
      headers: {},
      payload: await verifiedTicketPayload(app, "water", "Water readiness pilot smoke"),
    });
    assert(pilotOnlyWater.ticket === null && pilotOnlyWater.rejected?.error === "category_pilot_only", "Pilot-only readiness should block public citizen intake.");
    assert(pilotOnlyWater.rejected?.readiness?.launchState === "pilot_only", "Pilot-only rejection should include safe readiness state.");
    const pilotCitizenConfig = await jsonRequest<{ categories: CitizenCategoryAvailability[] }>(app, {
      method: "GET",
      url: "/api/citizen/config",
      headers: {},
    });
    assert(
      pilotCitizenConfig.categories.some((category) => category.id === "water" && category.intakeStatus === "pilot_only"),
      "Citizen config should reflect pilot-only category readiness before submission.",
    );

    await jsonRequest(
      app,
      {
        method: "PATCH",
        url: "/api/admin/config/category-readiness/water",
        payload: { launchState: "ready", sopStatus: "approved", trainingStatus: "approved" },
      },
      409,
    );
    const approvedWaterReadiness = await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "category_readiness",
        categoryId: "water",
        patch: { launchState: "ready", sopStatus: "approved", trainingStatus: "approved" },
      },
      "Restore water readiness to public launch-ready after smoke validation.",
    );
    assert(
      approvedWaterReadiness.config.readiness.some(
        (readiness) => readiness.categoryId === "water" && readiness.launchState === "ready" && readiness.sopStatus === "approved",
      ),
      "Launch-ready readiness changes should apply only after second Admin approval.",
    );
    pass("launch-readiness matrix requires approval before marking a category ready");

    await jsonRequest(
      app,
      {
        method: "PATCH",
        url: "/api/admin/config/sla-policies/local",
        payload: { durationDays: 5, enabled: true },
      },
      409,
    );
    const updatedLocalSla = await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "sla_policy",
        stage: "local",
        patch: { durationDays: 5, enabled: true },
      },
      "Reduce local SLA for smoke governance verification.",
    );
    assert(
      updatedLocalSla.config.slaPolicies.some((policy) => policy.stage === "local" && policy.durationDays === 5),
      "Local SLA duration should update to five days after second approval.",
    );
    pass("SLA policy updates require second-Admin approval before applying");

    await jsonRequest(
      app,
      {
        method: "PATCH",
        url: "/api/admin/config/categories/corruption",
        payload: { sensitivity: "identity_masked" },
      },
      409,
    );
    await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "category",
        id: "corruption",
        patch: { sensitivity: "identity_masked" },
      },
      "Temporarily relax corruption sensitivity for controlled smoke validation.",
    );
    await jsonRequest(
      app,
      {
        method: "PATCH",
        url: "/api/admin/config/app-controls/protected-bypass",
        payload: { value: false },
      },
      409,
    );
    await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "app_control",
        id: "protected-bypass",
        value: false,
      },
      "Temporarily disable protected bypass for controlled smoke validation.",
    );
    const unprotectedCorruption = await jsonRequest<{ ticket: TicketRecord }>(
      app,
      {
        method: "POST",
        url: "/api/tickets",
        payload: await verifiedTicketPayload(app, "corruption", "Configurable corruption routing smoke"),
      },
      201,
    );
    assert(!unprotectedCorruption.ticket.protected, "Corruption should not be protected when sensitivity and bypass are both disabled.");
    assert(unprotectedCorruption.ticket.primaryQueue.kind === "verification", "Unprotected corruption should enter ordinary verification.");

    await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "category",
        id: "corruption",
        patch: { sensitivity: "protected" },
      },
      "Restore protected corruption sensitivity after smoke validation.",
    );
    await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "app_control",
        id: "protected-bypass",
        value: true,
      },
      "Restore corruption protected bypass after smoke validation.",
    );
    const protectedCorruption = await jsonRequest<{ ticket: TicketRecord }>(
      app,
      {
        method: "POST",
        url: "/api/tickets",
        payload: await verifiedTicketPayload(app, "corruption", "Protected corruption routing smoke"),
      },
      201,
    );
    assert(protectedCorruption.ticket.protected, "Protected corruption configuration should mark the ticket protected.");
    assert(protectedCorruption.ticket.primaryQueue.kind === "protected_review", "Protected corruption should bypass ordinary local visibility.");
    pass("protected category controls require approval and affect corruption ticket routing");

    for (const [controlId, reason] of [
      ["asset-logo-approved", "Reconfirm neutral Whistle logo placeholder for launch-readiness smoke."],
      ["asset-portrait-approved", "Reconfirm neutral public-figure portrait replacement for launch-readiness smoke."],
      ["asset-tn-emblem-approved", "Reconfirm neutral government-emblem replacement for launch-readiness smoke."],
    ] as const) {
      await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
        app,
        {
          kind: "app_control",
          id: controlId,
          value: true,
        },
        reason,
      );
    }
    const approvedLaunchReadiness = await jsonRequest<{ mode: string; report: LaunchReadinessReport }>(app, {
      method: "GET",
      url: "/api/admin/launch-readiness",
    });
    const approvedCitizenConfig = await jsonRequest<{ assetPolicy: PublicAssetPolicy; categories: CitizenCategoryAvailability[] }>(app, {
      method: "GET",
      url: "/api/citizen/config",
      headers: {},
    });
    const approvedAssetCheck = approvedLaunchReadiness.report.checks.find((check) => check.id === "asset-review");
    const blockedProductionCheck = approvedLaunchReadiness.report.checks.find((check) => check.id === "production-seams");
    assert(approvedAssetCheck?.status === "pass", "Asset readiness should pass with governed neutral replacements.");
    assert(approvedCitizenConfig.assetPolicy.logo.src === "/assets/brand/whistle-fake-logo.svg", "Citizen config should keep the neutral Whistle logo placeholder.");
    assert(approvedCitizenConfig.assetPolicy.emblem.src === "/assets/brand/whistle-civic-mark.svg", "Citizen config should keep the neutral civic mark.");
    assert(approvedCitizenConfig.assetPolicy.portrait.src === "/assets/brand/whistle-service-portrait.svg", "Citizen config should keep the neutral service illustration.");
    assert(blockedProductionCheck?.status === "blocker", "Production seams should remain launch blockers after only asset approvals.");
    assert(
      approvedLaunchReadiness.report.verdict === "no_go",
      "Launch readiness should remain no-go until provider controls are approved and runtime deployment preflight passes.",
    );
    pass("asset approvals do not hide production provider seam blockers");

    const invalidProviderReference = await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "app_control",
        id: "infra-citizen-otp-config-ref",
        value: "https://provider.example.gov/otp-contract",
      },
      "Record deliberately invalid raw citizen OTP/SMS provider URL for validation smoke.",
    );
    assert(
      invalidProviderReference.config.appControls.some(
        (control) => control.id === "infra-citizen-otp-config-ref" && control.value === "https://provider.example.gov/otp-contract",
      ),
      "Invalid external provider reference should still save through second-Admin governance approval for review.",
    );
    const invalidProviderLaunchReadiness = await jsonRequest<{ mode: string; report: LaunchReadinessReport }>(app, {
      method: "GET",
      url: "/api/admin/launch-readiness",
    });
    const invalidProviderProductionCheck = invalidProviderLaunchReadiness.report.checks.find((check) => check.id === "production-seams");
    assert(
      invalidProviderProductionCheck?.details.some((detail) => detail.includes("controlled internal provider reference")),
      "Launch readiness should reject raw external provider references.",
    );
    for (const [controlId, value, reason] of [
      ["infra-official-oidc-config-ref", "secret-manager://whistle/mvp1/official-oidc-mfa/smoke", "Record approved official OIDC/MFA secret-manager reference."],
      ["infra-worker-auth-config-ref", "secret-manager://whistle/mvp1/worker-auth/smoke", "Record approved worker auth secret-manager reference."],
      ["infra-citizen-otp-config-ref", "secret-manager://whistle/mvp1/citizen-otp-provider/smoke", "Record approved citizen OTP/SMS provider secret-manager reference."],
      ["infra-evidence-storage-config-ref", "secret-manager://whistle/mvp1/evidence-storage-kms-scanner/smoke", "Record approved evidence storage/KMS/scanner reference."],
      ["infra-notification-provider-config-ref", "provider-contract://whistle/mvp1/notification-provider/smoke", "Record approved notification provider contract reference."],
      ["infra-rate-limit-config-ref", "secret-manager://whistle/mvp1/rate-limit-provider/smoke", "Record approved distributed rate-limit provider reference."],
      ["infra-deployment-observability-config-ref", "ops://whistle/mvp1/observability-siem-telemetry/smoke", "Record approved deployment/SIEM/telemetry reference."],
    ] as const) {
      await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
        app,
        {
          kind: "app_control",
          id: controlId,
          value,
        },
        reason,
      );
    }
    const approvedProviderReferencePayload = await jsonRequest<{ mode: string; config: AdminConfigSnapshot }>(app, {
      method: "GET",
      url: "/api/admin/config",
    });
    assert(
      approvedProviderReferencePayload.config.appControls.some(
        (control) => control.id === "infra-citizen-otp-config-ref" && control.value === "secret-manager://whistle/mvp1/citizen-otp-provider/smoke",
      ),
      "Critical external provider reference should save through second-Admin governance approval.",
    );
    pass("external provider config references are governed through Admin controls");

    await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "app_control",
        id: "platform-postgres-migration-evidence-ref",
        value: "postgres://whistle:whistle@localhost:54329/whistle",
      },
      "Record deliberately invalid Postgres migration evidence reference for validation smoke.",
    );
    const invalidPlatformEvidenceLaunchReadiness = await jsonRequest<{ mode: string; report: LaunchReadinessReport }>(app, {
      method: "GET",
      url: "/api/admin/launch-readiness",
    });
    const invalidPlatformProductionCheck = invalidPlatformEvidenceLaunchReadiness.report.checks.find((check) => check.id === "production-seams");
    assert(invalidPlatformProductionCheck?.status === "blocker", "Production seams should block when Postgres migration evidence is a raw database URL.");
    assert(
      invalidPlatformProductionCheck.details.some((detail) => detail.includes("Postgres migration evidence reference") && detail.includes("database URL")),
      "Production seam blocker should reject raw Postgres evidence references.",
    );
    for (const [controlId, value, reason] of [
      ["platform-postgres-migration-evidence-ref", "artifact://whistle/mvp1/postgres-migration/smoke", "Record Postgres migration evidence reference."],
      ["platform-postgres-mvp-check-evidence-ref", "artifact://whistle/mvp1/postgres-mvp-check/smoke", "Record Postgres-backed MVP check evidence reference."],
    ] as const) {
      await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
        app,
        {
          kind: "app_control",
          id: controlId,
          value,
        },
        reason,
      );
    }
    pass("Platform/Postgres launch evidence references are governed through Admin controls");

    const invalidUatEvidence = await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "app_control",
        id: "uat-launch-rehearsal-evidence-ref",
        value: "meeting-notes-only",
      },
      "Record deliberately invalid MVP1 rehearsal evidence reference for validation smoke.",
    );
    assert(
      invalidUatEvidence.config.appControls.some(
        (control) => control.id === "uat-launch-rehearsal-evidence-ref" && control.value === "meeting-notes-only",
      ),
      "Invalid MVP1 UAT evidence reference should still save through governance for review.",
    );
    for (const [controlId, reason] of [
      ["uat-citizen-lifecycle-rehearsed", "Approve citizen submit/track rehearsal for launch-readiness smoke."],
      ["uat-verification-sop-approved", "Approve verification SOP and training for launch-readiness smoke."],
      ["uat-role-dashboard-rehearsed", "Approve role-dashboard rehearsal for launch-readiness smoke."],
      ["uat-protected-track-sop-approved", "Approve protected-track SOP for launch-readiness smoke."],
      ["uat-defect-triage-ready", "Approve MVP1 defect-triage queue for launch-readiness smoke."],
    ] as const) {
      await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
        app,
        {
          kind: "app_control",
          id: controlId,
          value: true,
        },
        reason,
      );
    }
    const invalidUatLaunchReadiness = await jsonRequest<{ mode: string; report: LaunchReadinessReport }>(app, {
      method: "GET",
      url: "/api/admin/launch-readiness",
    });
    const invalidOperatorUatCheck = invalidUatLaunchReadiness.report.checks.find((check) => check.id === "operator-uat");
    assert(invalidOperatorUatCheck?.status === "blocker", "Operator UAT sign-off should still block when the evidence reference is not a controlled MVP1 artifact.");
    assert(
      invalidOperatorUatCheck.details.some((detail) => detail.includes("must use artifact://") || detail.includes("must identify MVP1")),
      "Operator UAT blocker should explain the required evidence reference format.",
    );
    const approvedUatEvidence = await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "app_control",
        id: "uat-launch-rehearsal-evidence-ref",
        value: "artifact://whistle/mvp1/rehearsal-packet/smoke",
      },
      "Record MVP1 rehearsal evidence reference for launch-readiness smoke.",
    );
    assert(
      approvedUatEvidence.config.appControls.some(
        (control) => control.id === "uat-launch-rehearsal-evidence-ref" && control.value === "artifact://whistle/mvp1/rehearsal-packet/smoke",
      ),
      "MVP1 UAT evidence reference should save through second-Admin governance approval.",
    );
    await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "app_control",
        id: "uat-defect-register-ref",
        value: "https://tracker.example.gov/uat-defects",
      },
      "Record deliberately invalid MVP1 defect register reference for validation smoke.",
    );
    const invalidDefectRegisterReadiness = await jsonRequest<{ mode: string; report: LaunchReadinessReport }>(app, {
      method: "GET",
      url: "/api/admin/launch-readiness",
    });
    const invalidDefectRegisterCheck = invalidDefectRegisterReadiness.report.checks.find((check) => check.id === "operator-uat");
    assert(invalidDefectRegisterCheck?.status === "blocker", "Operator UAT should block when defect register reference is a raw URL.");
    assert(
      invalidDefectRegisterCheck.details.some((detail) => detail.includes("MVP1 defect register reference") && detail.includes("controlled artifact reference")),
      "Operator UAT blocker should reject raw defect-register URLs.",
    );
    await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "app_control",
        id: "uat-defect-register-ref",
        value: "artifact://whistle/mvp1/defect-register/smoke",
      },
      "Record MVP1 defect register reference for launch-readiness smoke.",
    );
    await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "app_control",
        id: "uat-open-blocker-defects",
        value: 1,
      },
      "Record an open blocker defect for validation smoke.",
    );
    const openDefectLaunchReadiness = await jsonRequest<{ mode: string; report: LaunchReadinessReport }>(app, {
      method: "GET",
      url: "/api/admin/launch-readiness",
    });
    const openDefectOperatorCheck = openDefectLaunchReadiness.report.checks.find((check) => check.id === "operator-uat");
    assert(openDefectOperatorCheck?.status === "blocker", "Operator UAT should block while blocker defects remain open.");
    assert(
      openDefectOperatorCheck.details.some((detail) => detail.includes("blocker UAT defect")),
      "Operator UAT blocker should name open blocker defect counts.",
    );
    await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "app_control",
        id: "uat-open-blocker-defects",
        value: 0,
      },
      "Clear open blocker defects for launch-readiness smoke.",
    );
    const uatApprovedLaunchReadiness = await jsonRequest<{ mode: string; report: LaunchReadinessReport }>(app, {
      method: "GET",
      url: "/api/admin/launch-readiness",
    });
    const approvedOperatorUatCheck = uatApprovedLaunchReadiness.report.checks.find((check) => check.id === "operator-uat");
    assert(approvedOperatorUatCheck?.status === "pass", "Operator UAT sign-off should pass after governed rehearsal approvals.");
    pass("operator UAT and SOP sign-offs are governed through Admin controls");

    for (const [controlId, value, reason] of [
      ["ops-restore-drill-evidence-ref", "https://ops.example.gov/restore-drill", "Record deliberately invalid restore drill evidence reference for validation smoke."],
      ["ops-siem-worm-evidence-ref", "artifact://whistle/mvp1/siem-worm-export/smoke", "Record SIEM/WORM export evidence reference."],
      ["ops-telemetry-launch-watch-evidence-ref", "artifact://whistle/mvp1/telemetry-launch-watch/smoke", "Record telemetry launch watch evidence reference."],
      ["ops-origin-allowlist-evidence-ref", "artifact://whistle/mvp1/origin-allowlist/smoke", "Record browser origin allowlist evidence reference."],
      ["ops-incident-hold-policy-evidence-ref", "runbook-note-only", "Record deliberately invalid incident hold policy evidence reference for validation smoke."],
    ] as const) {
      await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
        app,
        {
          kind: "app_control",
          id: controlId,
          value,
        },
        reason,
      );
    }
    for (const [controlId, reason] of [
      ["ops-restore-drill-signed-off", "Approve production-like restore drill sign-off for launch-readiness smoke."],
      ["ops-siem-worm-signed-off", "Approve SIEM/WORM export sign-off for launch-readiness smoke."],
      ["ops-telemetry-launch-watch-signed-off", "Approve telemetry launch watch sign-off for launch-readiness smoke."],
      ["ops-origin-allowlist-signed-off", "Approve browser origin allowlist sign-off for launch-readiness smoke."],
      ["ops-incident-hold-policy-signed-off", "Approve incident hold policy sign-off for launch-readiness smoke."],
    ] as const) {
      await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
        app,
        {
          kind: "app_control",
          id: controlId,
          value: true,
        },
        reason,
      );
    }
    const invalidOpsLaunchReadiness = await jsonRequest<{ mode: string; report: LaunchReadinessReport }>(app, {
      method: "GET",
      url: "/api/admin/launch-readiness",
    });
    const invalidDeploymentIncidentCheck = invalidOpsLaunchReadiness.report.checks.find((check) => check.id === "deployment-incident");
    assert(invalidDeploymentIncidentCheck?.status === "blocker", "Deployment sign-off should still block when restore evidence is a raw URL.");
    assert(
      invalidDeploymentIncidentCheck.details.some((detail) => detail.includes("controlled artifact reference")),
      "Deployment blocker should reject raw evidence URLs.",
    );
    assert(
      invalidDeploymentIncidentCheck.details.some((detail) => detail.includes("Incident hold policy evidence reference")),
      "Deployment blocker should require controlled incident hold policy evidence.",
    );
    await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "app_control",
        id: "ops-restore-drill-evidence-ref",
        value: "artifact://whistle/mvp1/restore-drill/smoke",
      },
      "Record production-like restore drill evidence reference.",
    );
    await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
      app,
      {
        kind: "app_control",
        id: "ops-incident-hold-policy-evidence-ref",
        value: "artifact://whistle/mvp1/incident-hold-policy/smoke",
      },
      "Record incident hold policy evidence reference.",
    );
    const opsApprovedLaunchReadiness = await jsonRequest<{ mode: string; report: LaunchReadinessReport }>(app, {
      method: "GET",
      url: "/api/admin/launch-readiness",
    });
    const approvedDeploymentIncidentCheck = opsApprovedLaunchReadiness.report.checks.find((check) => check.id === "deployment-incident");
    assert(approvedDeploymentIncidentCheck?.status === "pass", "Deployment and incident sign-off should pass after governed ops approvals.");
    pass("deployment and incident sign-offs are governed through Admin controls");

    for (const [controlId, reason] of [
      ["infra-official-oidc-mfa-ready", "Approve official OIDC/MFA provider readiness for launch-readiness smoke."],
      ["infra-worker-auth-ready", "Approve worker service authentication readiness for launch-readiness smoke."],
      ["infra-citizen-otp-provider-ready", "Approve citizen OTP/SMS provider readiness for launch-readiness smoke."],
      ["infra-evidence-storage-ready", "Approve evidence storage, malware scanning, and KMS readiness for launch-readiness smoke."],
      ["infra-notification-provider-ready", "Approve notification provider contract readiness for launch-readiness smoke."],
      ["infra-distributed-rate-limit-ready", "Approve distributed public rate-limit readiness for launch-readiness smoke."],
      ["infra-deployment-runbook-ready", "Approve deployment, backup, and SIEM runbook readiness for launch-readiness smoke."],
    ] as const) {
      await proposeAndApproveConfigChange<{ config: AdminConfigSnapshot }>(
        app,
        {
          kind: "app_control",
          id: controlId,
          value: true,
        },
        reason,
      );
    }
    const productionReadyLaunchReadiness = await jsonRequest<{ mode: string; report: LaunchReadinessReport }>(app, {
      method: "GET",
      url: "/api/admin/launch-readiness",
    });
    const approvedProductionCheck = productionReadyLaunchReadiness.report.checks.find((check) => check.id === "production-seams");
    assert(approvedProductionCheck?.status === "blocker", "Production seam readiness should still block when runtime preflight remains local/mock.");
    assert(
      approvedProductionCheck.details.some((detail) => detail.includes("Runtime preflight blocker")),
      "Production seam readiness should surface runtime preflight blockers after Admin controls are approved.",
    );
    assert(
      productionReadyLaunchReadiness.report.verdict === "no_go",
      "Launch readiness should remain no-go when Admin approvals are present but runtime deployment preflight still has blockers.",
    );
    assert(productionReadyLaunchReadiness.report.warnings >= 1, "Launch readiness should preserve pilot-category warnings even while runtime preflight blocks launch.");
    pass("production provider seam approvals cannot bypass runtime deployment preflight blockers");

    const changeRequests = await jsonRequest<{ changeRequests: Array<{ status: string; decidedBy?: string }> }>(app, {
      method: "GET",
      url: "/api/admin/governance/config-change-requests",
    });
    assert(changeRequests.changeRequests.length >= 5, "Governance trail should retain config change requests.");
    assert(changeRequests.changeRequests.every((request) => request.status !== "pending"), "Smoke-approved changes should not remain pending.");
    assert(changeRequests.changeRequests.some((request) => request.decidedBy === "admin:reviewer"), "Governance trail should show second Admin approver.");
    pass("critical config governance trail is inspectable");

    pass("admin configuration smoke completed");
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
