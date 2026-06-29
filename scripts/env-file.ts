import { readFileSync } from "node:fs";

export function parseEnvFile(path: string) {
  const raw = readFileSync(path, "utf8");
  const env: Record<string, string> = {};
  for (const [index, originalLine] of raw.split(/\r?\n/).entries()) {
    const line = originalLine.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) {
      const keyHint = safeEnvKeyHint(line);
      throw new Error(`Invalid env line ${index + 1} in ${path}${keyHint ? ` for ${keyHint}` : ""}: expected KEY=value.`);
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new Error(`Invalid env key on line ${index + 1} in ${path}.`);
    env[key] = stripOptionalQuotes(value);
  }
  return env;
}

export function applyEnv(env: Record<string, string>, options: { override?: boolean } = {}) {
  for (const [key, value] of Object.entries(env)) {
    if (options.override || process.env[key] === undefined) process.env[key] = value;
  }
}

function stripOptionalQuotes(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function safeEnvKeyHint(line: string) {
  const firstToken = line.split(/\s+/)[0]?.replace(/=.*$/, "");
  if (firstToken && /^[A-Z_][A-Z0-9_]*$/.test(firstToken)) return firstToken;
  return "";
}
