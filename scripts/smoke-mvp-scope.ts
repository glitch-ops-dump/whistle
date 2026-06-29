import { buildWhistleApi } from "../server/app.js";
import type { MvpScopeReport } from "../server/config/types.js";

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
      url: "/api/admin/mvp-scope",
      headers: adminHeaders,
    });
    assert(response.statusCode === 200, `MVP scope returned ${response.statusCode}; expected 200. Body: ${response.body}`);
    const payload = response.json<{ mode: string; scope: MvpScopeReport }>();
    const scope = payload.scope;
    assert(scope.activeBuild === "MVP1", "MVP1 should remain the active build until the accountability spine is launch-ready.");
    assert(scope.currentBuildOrder.join(",") === "MVP1,MVP2,MVP3,MVP4", "MVP build order should be explicit and stable.");
    assert(scope.activeBuildWorkstreams.length >= 5, "MVP1 should expose parallel launch workstreams for focused execution.");
    assert(
      scope.activeBuildWorkstreams.every((workstream) => workstream.phaseId === "MVP1" && workstream.parallelizable),
      "Active launch workstreams should stay focused on MVP1 and show what can move in parallel.",
    );
    assert(
      scope.activeBuildWorkstreams.some((workstream) => workstream.owner === "government_ops" && workstream.id.includes("assets")),
      "MVP1 workstreams should separate government/ops asset approvals from engineering work.",
    );
    assert(
      scope.activeBuildWorkstreams.some((workstream) => workstream.owner === "external_provider" && workstream.blockers.length > 0),
      "MVP1 workstreams should expose provider and scale blockers as a parallel lane.",
    );
    assert(
      scope.activeBuildWorkstreams.some(
        (workstream) =>
          workstream.owner === "external_provider" &&
          workstream.evidence.some((item) => item.includes("citizen identity-policy controls")),
      ),
      "MVP1 provider lane should mention Admin external-provider options and citizen identity-policy controls.",
    );
    assert(
      scope.activeBuildWorkstreams.some((workstream) => workstream.id === "mvp1-operator-uat-and-sop" && workstream.blockers.some((blocker) => blocker.includes("rehearsal"))),
      "MVP1 workstreams should expose operator rehearsal and SOP sign-off as a tracked parallel lane.",
    );
    assert(
      scope.activeBuildWorkstreams.some(
        (workstream) =>
          workstream.id === "mvp1-operator-uat-and-sop" &&
          workstream.evidence.some((item) => item.includes("local UAT role runner")) &&
          workstream.evidence.some((item) => item.includes("sign-off checklist")) &&
          workstream.evidence.some((item) => item.includes("defect-register generator")),
      ),
      "MVP1 operator UAT workstream should expose the local role runner, sign-off checklist, and defect-register generator as repeatable evidence.",
    );
    assert(
      scope.activeBuildWorkstreams.some(
        (workstream) =>
          workstream.id === "mvp1-core-spine-hardening" &&
          workstream.evidence.some((item) => item.includes("migration-output and Postgres-backed MVP-check evidence references")),
      ),
      "MVP1 core-spine workstream should document controlled platform evidence for migration output and Postgres-backed checks.",
    );
    assert(
      scope.activeBuildWorkstreams.some(
        (workstream) =>
          workstream.id === "mvp1-deployment-and-incident-readiness" &&
          workstream.blockers.some((blocker) => blocker.includes("Production-like restore drill")) &&
          workstream.blockers.some((blocker) => blocker.includes("Incident hold conditions")),
      ),
      "MVP1 workstreams should expose deployment and incident sign-offs as a tracked launch gate.",
    );
    assert(scope.phases.length === 4, "MVP scope report should include MVP1 through MVP4.");
    assert(scope.phases[0].id === "MVP1", "MVP1 should be first.");
    assert(scope.phases[0].includedSurfaces.includes("Citizen PWA"), "MVP1 should include Citizen PWA.");
    assert(scope.phases[0].includedSurfaces.includes("CM Cell Dashboard"), "MVP1 should include CM Cell Dashboard.");
    assert(scope.phases[0].deferredSurfaces.includes("Public transparency"), "MVP1 should defer public transparency.");
    assert(scope.phases[1].id === "MVP2" && scope.phases[1].title.toLowerCase().includes("transparency"), "MVP2 should own transparency/intelligence.");
    assert(scope.phases[2].id === "MVP3" && scope.phases[2].title.toLowerCase().includes("field"), "MVP3 should own field execution.");
    assert(scope.phases[3].id === "MVP4" && scope.phases[3].title.toLowerCase().includes("governance"), "MVP4 should own advanced governance.");
    assert(scope.overallImplementationPercent > scope.overallLaunchReadinessPercent, "Implementation should be ahead of operational launch readiness in the MVP.");
    assert(
      scope.phases[0].items.some((item) => item.id === "asset-identity-approval" && item.status === "done"),
      "MVP1 should treat neutral placeholder assets as clearing the asset/identity blocker.",
    );
    assert(
      scope.phases[0].items.some((item) => item.id === "operator-uat-signoff" && item.status === "partial"),
      "MVP1 should track operator UAT/SOP sign-off as an implementation item instead of an informal runbook note.",
    );
    assert(
      scope.phases[0].items.some((item) => item.id === "production-security" && item.status === "blocked" && item.gaps.some((gap) => gap.includes("OIDC"))),
      "MVP1 should surface mock/provider production seams as launch blockers.",
    );
    pass("MVP scope report keeps MVP1-MVP4 build order, scope boundaries, and readiness gaps explicit");

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/admin/mvp-scope",
      headers: {
        "x-whistle-role": "minister",
        "x-whistle-actor": "minister:prototype",
      },
    });
    assert(forbidden.statusCode === 403, "MVP scope should be Admin-readable governance metadata, not a minister workspace.");
    pass("MVP scope report rejects non-Admin roles");
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
