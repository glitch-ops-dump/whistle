import { buildWhistleApi } from "../server/app.js";
import type { Mvp1LaunchHandoffReport } from "../server/config/types.js";

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

async function run() {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalSeedDemo = process.env.WHISTLE_SEED_DEMO;
  delete process.env.DATABASE_URL;
  process.env.WHISTLE_SEED_DEMO = "false";

  const app = buildWhistleApi();
  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/mvp1-launch-handoff",
      headers: adminHeaders,
    });
    assert(response.statusCode === 200, `MVP1 launch handoff returned ${response.statusCode}; expected 200. Body: ${response.body}`);

    const payload = response.json<{ mode: string; handoff: Mvp1LaunchHandoffReport }>();
    const handoff = payload.handoff;
    const laneIds = new Set(handoff.lanes.map((lane) => lane.id));

    assert(handoff.kind === "whistle-mvp1-launch-handoff", "MVP1 handoff should expose a stable report kind.");
    assert(handoff.activeBuild === "MVP1", "MVP1 handoff should stay scoped to MVP1.");
    assert(handoff.lanes.length >= 6, "MVP1 handoff should split work into provider, UAT, platform, identity, security, and ops lanes.");
    assert(laneIds.has("platform-postgres"), "MVP1 handoff should include the Platform/Postgres lane.");
    assert(laneIds.has("identity-and-worker-auth"), "MVP1 handoff should include the identity and worker-auth lane.");
    assert(laneIds.has("citizen-verification-and-messaging"), "MVP1 handoff should include citizen OTP, notification, and identity-policy lane.");
    assert(laneIds.has("evidence-and-protected-security"), "MVP1 handoff should include evidence/security lane.");
    assert(laneIds.has("observability-and-incident"), "MVP1 handoff should include observability and incident lane.");
    assert(laneIds.has("operator-uat"), "MVP1 handoff should include operator UAT lane.");

    const citizenLane = handoff.lanes.find((lane) => lane.id === "citizen-verification-and-messaging");
    assert(citizenLane, "Citizen verification lane should exist.");
    assert(
      citizenLane.adminControls.some((control) => control.id === "citizen-phone-otp-required"),
      "Citizen verification lane should show the phone OTP Admin control.",
    );
    assert(
      citizenLane.adminControls.some((control) => control.id === "identity-gov-id-policy-mode"),
      "Citizen verification lane should show the Government ID policy mode Admin control.",
    );
    assert(
      citizenLane.adminControls.some((control) => control.id === "identity-gov-id-provider-config-ref"),
      "Citizen verification lane should show the Government ID provider/policy reference Admin control.",
    );
    assert(
      citizenLane.nextActions.some((action) => action.includes("Government ID disabled")),
      "MVP1 handoff should preserve phone-OTP-first identity policy unless a future Government ID policy is approved.",
    );

    const platformLane = handoff.lanes.find((lane) => lane.id === "platform-postgres");
    assert(platformLane?.requiredEnv.includes("DATABASE_URL"), "Platform lane should name DATABASE_URL as a required env key.");
    assert(platformLane?.commands.some((command) => command.includes("mvp:check:postgres")), "Platform lane should name Postgres-backed MVP check.");
    assert(
      platformLane?.adminControls.some((control) => control.id === "platform-postgres-migration-evidence-ref"),
      "Platform lane should show the Postgres migration evidence reference.",
    );
    assert(
      platformLane?.adminControls.some((control) => control.id === "platform-postgres-mvp-check-evidence-ref"),
      "Platform lane should show the Postgres MVP check evidence reference.",
    );
    assert(
      platformLane?.adminControls.some((control) => control.id === "ops-restore-drill-evidence-ref"),
      "Platform lane should link to the restore drill evidence reference.",
    );
    assert(
      platformLane?.adminControls.some((control) => control.id === "infra-rate-limit-config-ref"),
      "Platform lane should include the distributed rate-limit provider reference.",
    );
    assert(
      platformLane?.evidenceNeeded.some((item) => item.includes("Controlled migration output")),
      "Platform lane should require controlled migration evidence.",
    );

    const uatLane = handoff.lanes.find((lane) => lane.id === "operator-uat");
    assert(uatLane?.adminControls.some((control) => control.id === "uat-defect-register-ref"), "Operator UAT lane should show the defect register reference.");
    assert(uatLane?.adminControls.some((control) => control.id === "uat-open-blocker-defects"), "Operator UAT lane should show open blocker defect counts.");
    assert(uatLane?.commands.some((command) => command.includes("mvp1:uat-run")), "Operator UAT lane should include the local role assertion runner.");
    assert(uatLane?.commands.some((command) => command.includes("mvp1:defect-register")), "Operator UAT lane should include the defect-register generator.");
    assert(uatLane?.commands.some((command) => command.includes("mvp1:uat-signoff")), "Operator UAT lane should include the sign-off checklist generator.");
    assert(
      uatLane?.evidenceNeeded.some((item) => item.includes("zero blocker/critical defects")),
      "Operator UAT lane should require zero blocker/critical defects before launch sign-off.",
    );

    const observabilityLane = handoff.lanes.find((lane) => lane.id === "observability-and-incident");
    assert(observabilityLane?.adminControls.some((control) => control.id === "ops-telemetry-launch-watch-evidence-ref"), "Observability lane should show telemetry watch evidence.");
    assert(observabilityLane?.adminControls.some((control) => control.id === "ops-origin-allowlist-evidence-ref"), "Observability lane should show origin allowlist evidence.");
    assert(observabilityLane?.adminControls.some((control) => control.id === "ops-incident-hold-policy-evidence-ref"), "Observability lane should show incident hold evidence.");
    assert(
      observabilityLane?.evidenceNeeded.some((item) => item.includes("Origin allowlist proof")),
      "Observability lane should require origin allowlist proof.",
    );

    assert(handoff.commands.some((command) => command.includes("mvp:check")), "Handoff should include the full MVP check command.");
    assert(handoff.commands.some((command) => command.includes("deployment:packet")), "Handoff should include the redacted deployment packet command.");
    assert(handoff.safeHandlingRules.some((rule) => rule.includes("raw secrets")), "Handoff should explicitly keep raw secrets out of Admin/shared packets.");
    assert(handoff.holdConditions.some((condition) => condition.includes("critical Admin control")), "Handoff should hold launch on pending critical Admin controls.");
    assert(handoff.lanes.some((lane) => lane.blockers.length > 0), "Handoff should expose unresolved launch blockers in local/prototype mode.");

    const serialized = JSON.stringify(handoff);
    assert(!serialized.includes("postgres://whistle:whistle"), "Handoff should not serialize local database passwords.");
    assert(!serialized.includes("admin123"), "Handoff should not serialize prototype admin credentials.");
    assert(!serialized.includes("REPLACE_WITH_"), "Handoff should not serialize provider placeholder secret values.");
    pass("MVP1 launch handoff exposes redacted owner lanes, controls, commands, and launch holds");

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/admin/mvp1-launch-handoff",
      headers: {
        "x-whistle-role": "minister",
        "x-whistle-actor": "minister:prototype",
      },
    });
    assert(forbidden.statusCode === 403, "MVP1 launch handoff should be Admin-readable governance metadata, not a minister workspace.");
    pass("MVP1 launch handoff rejects non-Admin roles");
  } finally {
    await app.close();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalSeedDemo === undefined) delete process.env.WHISTLE_SEED_DEMO;
    else process.env.WHISTLE_SEED_DEMO = originalSeedDemo;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
