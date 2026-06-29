export type OfficialClientAuth = {
  role: string;
  actor: string;
};

export const officialBearerTokenStorageKey = "whistle.officialBearerToken";
const API_BASE = import.meta.env.VITE_WHISTLE_API_BASE ?? "http://localhost:3001";
let localUatTokenBootstrapAvailable: boolean | null = null;
const memoryBearerTokens = new Map<string, string>();

function actorStorageKey(actor?: string) {
  return actor ? `${officialBearerTokenStorageKey}.${actor}` : officialBearerTokenStorageKey;
}

function actorScopedStorageToken(actor?: string) {
  if (!actor) return "";
  return memoryBearerTokens.get(actorStorageKey(actor)) || "";
}

function storageToken(actor?: string) {
  const actorKey = actorStorageKey(actor);
  return memoryBearerTokens.get(actorKey) || memoryBearerTokens.get(officialBearerTokenStorageKey) || "";
}

function storeToken(actor: string, token: string, storageKey?: string) {
  memoryBearerTokens.set(storageKey || actorStorageKey(actor), token);
}

async function canRequestLocalUatToken() {
  if (localUatTokenBootstrapAvailable !== null) return localUatTokenBootstrapAvailable;
  try {
    const response = await fetch(`${API_BASE}/api/auth/config`, { credentials: "include" });
    if (!response.ok) {
      localUatTokenBootstrapAvailable = false;
      return false;
    }
    const config = (await response.json()) as { demo?: { governmentAccounts?: unknown[] } };
    localUatTokenBootstrapAvailable = Array.isArray(config.demo?.governmentAccounts) && config.demo.governmentAccounts.length > 0;
    return localUatTokenBootstrapAvailable;
  } catch {
    localUatTokenBootstrapAvailable = false;
    return false;
  }
}

export async function ensureOfficialBearerToken(auth: OfficialClientAuth, options: { forceRefresh?: boolean } = {}) {
  if (!options.forceRefresh) {
    const current = actorScopedStorageToken(auth.actor);
    if (current) return current;
  }
  if (!(await canRequestLocalUatToken())) return "";
  try {
    const response = await fetch(`${API_BASE}/api/local-uat/official-token`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor: auth.actor, role: auth.role }),
    });
    if (!response.ok) return "";
    const payload = (await response.json()) as { token?: string; storageKey?: string };
    if (!payload.token) return "";
    storeToken(auth.actor, payload.token, payload.storageKey);
    return payload.token;
  } catch {
    return "";
  }
}

export function officialAuthHeaders(auth: OfficialClientAuth, options: { json?: boolean; accessReason?: string } = {}) {
  const headers: Record<string, string> = {};
  if (options.json) headers["content-type"] = "application/json";
  const bearerToken = storageToken(auth.actor);
  headers["x-whistle-role"] = auth.role;
  headers["x-whistle-actor"] = auth.actor;
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }
  if (options.accessReason) headers["x-whistle-access-reason"] = options.accessReason;
  return headers;
}

export async function officialAuthHeadersAsync(auth: OfficialClientAuth, options: { json?: boolean; accessReason?: string; forceRefresh?: boolean } = {}) {
  await ensureOfficialBearerToken(auth, { forceRefresh: options.forceRefresh });
  return officialAuthHeaders(auth, options);
}
