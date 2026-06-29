import { resolve } from "node:path";
import { applyEnv, parseEnvFile } from "./env-file.js";

const envFile = resolve(process.cwd(), process.env.WHISTLE_MVP1_LOCAL_UAT_ENV_FILE ?? "ops/env/whistle-mvp1-local-uat.env.example");
applyEnv(parseEnvFile(envFile), { override: false });

console.log(`Loaded Whistle MVP1 local UAT env from ${envFile}`);
console.log("Local UAT uses smoke auth secrets and must not be used for staging or production.");

await import("../server/main.js");
