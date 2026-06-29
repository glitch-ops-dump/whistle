import { SignJWT } from "jose";
import { resolve } from "node:path";
import { parseEnvFile } from "./env-file.js";

type TokenOptions = {
  envFile: string;
  actor: string;
  role: string;
  expiresIn: string;
  json: boolean;
};

function parseArgs(argv: string[]): TokenOptions {
  const options: TokenOptions = {
    envFile: "ops/env/whistle-mvp1-local-uat.env.example",
    actor: "admin:prototype",
    role: "admin",
    expiresIn: "2h",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-file") {
      options.envFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--actor") {
      options.actor = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--role") {
      options.role = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--expires-in") {
      options.expiresIn = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export async function createLocalUatOfficialToken(input: {
  actor: string;
  role: string;
  env: Record<string, string | undefined>;
  expiresIn?: string;
  mfa?: boolean;
}) {
  const issuer = input.env.WHISTLE_OFFICIAL_OIDC_ISSUER?.trim();
  const audience = input.env.WHISTLE_OFFICIAL_OIDC_AUDIENCE?.trim();
  const secret = input.env.WHISTLE_OFFICIAL_OIDC_HS256_SECRET?.trim();
  if (!issuer || !audience || !secret) {
    throw new Error("Local UAT OIDC issuer, audience, and HS256 smoke secret are required.");
  }
  const token = await new SignJWT({
    whistle_role: input.role,
    amr: input.mfa === false ? ["pwd"] : ["pwd", "mfa"],
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.actor)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(input.expiresIn ?? "2h")
    .sign(new TextEncoder().encode(secret));
  return token;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const envFile = resolve(process.cwd(), options.envFile);
  const env = parseEnvFile(envFile);
  const token = await createLocalUatOfficialToken({
    actor: options.actor,
    role: options.role,
    env,
    expiresIn: options.expiresIn,
  });
  const actorStorageKey = `whistle.officialBearerToken.${options.actor}`;
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          kind: "whistle-mvp1-local-uat-official-token",
          envFile,
          actor: options.actor,
          role: options.role,
          storageKey: actorStorageKey,
          token,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  process.stdout.write(`# Whistle MVP1 Local UAT Token

Actor: \`${options.actor}\`  
Role: \`${options.role}\`  
Storage key: \`${actorStorageKey}\`

Paste this in the browser console for the matching prototype surface:

\`\`\`js
localStorage.setItem("${actorStorageKey}", "${token}");
\`\`\`

Use this only with \`npm run api:dev:mvp1-uat\`. It is signed with the local smoke secret and is not valid launch evidence.
`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
