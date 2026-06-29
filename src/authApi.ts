import type { GovRole } from "./govDashboardApi";

export type AuthSurface = "citizen" | "government";
export type AuthRole = "citizen" | GovRole;

export type WhistleAuthSession = {
  sessionToken?: string;
  accountId: string;
  phone: string;
  phoneMasked: string;
  displayName: string;
  surface: AuthSurface;
  actor: string;
  role: AuthRole;
  roles: AuthRole[];
  phoneVerificationToken?: string;
  expiresAt: string;
  createdAt: string;
  sessionCookie?: boolean;
  officialBearerToken?: string;
  officialBearerStorageKey?: string;
};

export type AuthConfig = {
  controls: {
    citizenOtpRequired: boolean;
    governmentOtpRequired: boolean;
  };
  demo: {
    governmentAccounts: Array<{
      phone: string;
      displayName: string;
      actor: string;
      roles: GovRole[];
      password: string;
    }>;
  };
};

export type AuthOtpChallenge = {
  challengeId: string;
  phoneMasked: string;
  expiresAt: string;
  resendAfter: string;
  mockOtp?: string;
  delivery: "sms_mock" | "sms_provider";
  deliveryProvider: string;
  providerMessageId: string;
};

export type AuthOtpVerification = {
  verificationToken: string;
  phoneMasked: string;
  verifiedAt: string;
  expiresAt: string;
};

export type AuthResult =
  | { ok: true; session: WhistleAuthSession }
  | { ok: false; status: number; error: string; message: string; otpRequired?: boolean };

export type OtpStartResult =
  | { ok: true; challenge: AuthOtpChallenge }
  | { ok: false; status: number; error: string; message: string };

export type OtpVerifyResult =
  | { ok: true; verification: AuthOtpVerification }
  | { ok: false; status: number; error: string; message: string };

export type PasswordResetResult =
  | { ok: true }
  | { ok: false; status: number; error: string; message: string };

const API_BASE = import.meta.env.VITE_WHISTLE_API_BASE ?? "http://localhost:3001";
const sessionStoragePrefix = "whistle.authSession";
const officialBearerTokenStorageKey = "whistle.officialBearerToken";
const accountSessionTokenStorageKey = "whistle.accountSessionToken";

declare global {
  interface Window {
    __WHISTLE_API_DISABLED__?: boolean;
  }
}

const offlineAuthConfig: AuthConfig = {
  controls: { citizenOtpRequired: true, governmentOtpRequired: false },
  demo: { governmentAccounts: [] },
};

function apiDisabled() {
  return typeof window !== "undefined" && window.__WHISTLE_API_DISABLED__ === true;
}

function storageKey(surface: AuthSurface, roleKey: string) {
  return `${sessionStoragePrefix}.${surface}.${roleKey}`;
}

function safeJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function rejected(response: Response, fallbackError: string, fallbackMessage: string) {
  const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string; otpRequired?: boolean };
  return {
    ok: false as const,
    status: response.status,
    error: body.error ?? fallbackError,
    message: body.message ?? fallbackMessage,
    otpRequired: body.otpRequired,
  };
}

function storageSafeSession(session: WhistleAuthSession): WhistleAuthSession {
  const {
    sessionToken: _sessionToken,
    phoneVerificationToken: _phoneVerificationToken,
    officialBearerToken: _officialBearerToken,
    officialBearerStorageKey: _officialBearerStorageKey,
    ...safeSession
  } = session;
  return safeSession;
}

export function storeAuthSession(session: WhistleAuthSession, surface: AuthSurface, roleKey: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(surface, roleKey), JSON.stringify(storageSafeSession(session)));
  } catch {
    // Session metadata persistence is a convenience; the HttpOnly API cookie remains authoritative.
  }
}

export function loadAuthSession(surface: AuthSurface, roleKey: string) {
  if (typeof window === "undefined") return null;
  const session = safeJson<WhistleAuthSession>(window.localStorage.getItem(storageKey(surface, roleKey)));
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    clearAuthSession(surface, roleKey);
    return null;
  }
  return storageSafeSession(session);
}

export function clearAuthSession(surface: AuthSurface, roleKey: string) {
  if (typeof window === "undefined") return;
  try {
    const existing = safeJson<WhistleAuthSession>(window.localStorage.getItem(storageKey(surface, roleKey)));
    if (existing?.surface === "government") {
      window.localStorage.removeItem(`${accountSessionTokenStorageKey}.${existing.actor}`);
      window.localStorage.removeItem(existing.officialBearerStorageKey || `${officialBearerTokenStorageKey}.${existing.actor}`);
    }
    window.localStorage.removeItem(officialBearerTokenStorageKey);
    window.localStorage.removeItem(storageKey(surface, roleKey));
  } catch {
    // Ignore storage cleanup failures.
  }
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  if (apiDisabled()) return offlineAuthConfig;
  try {
    const response = await fetch(`${API_BASE}/api/auth/config`, { credentials: "include" });
    if (!response.ok) return offlineAuthConfig;
    return (await response.json()) as AuthConfig;
  } catch {
    return offlineAuthConfig;
  }
}

export async function startAuthOtp(phone: string, language: "en" | "ta" = "en"): Promise<OtpStartResult> {
  try {
    const response = await fetch(`${API_BASE}/api/auth/otp/start`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, language }),
    });
    if (!response.ok) return rejected(response, "otp_start_rejected", "Could not start OTP validation.");
    const body = (await response.json()) as { challenge: AuthOtpChallenge };
    return { ok: true, challenge: body.challenge };
  } catch {
    return { ok: false, status: 503, error: "otp_unavailable", message: "OTP service is unavailable." };
  }
}

export async function verifyAuthOtp(challengeId: string, otp: string): Promise<OtpVerifyResult> {
  try {
    const response = await fetch(`${API_BASE}/api/auth/otp/verify`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId, otp }),
    });
    if (!response.ok) return rejected(response, "otp_verify_rejected", "Could not verify OTP.");
    const body = (await response.json()) as { verification: AuthOtpVerification };
    return { ok: true, verification: body.verification };
  } catch {
    return { ok: false, status: 503, error: "otp_unavailable", message: "OTP verification is unavailable." };
  }
}

export async function loginWithMobilePassword(input: {
  surface: AuthSurface;
  phone: string;
  password: string;
  role?: GovRole;
  phoneVerificationToken?: string;
}): Promise<AuthResult> {
  try {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) return rejected(response, "invalid_login", "Mobile number or password is incorrect.");
    const body = (await response.json()) as { session: WhistleAuthSession };
    return { ok: true, session: body.session };
  } catch {
    return { ok: false, status: 503, error: "auth_unavailable", message: "Auth service is unavailable." };
  }
}

export async function registerCitizenAccount(input: {
  phone: string;
  displayName?: string;
  password: string;
  phoneVerificationToken?: string;
}): Promise<AuthResult> {
  try {
    const response = await fetch(`${API_BASE}/api/auth/citizen/register`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) return rejected(response, "citizen_register_rejected", "Could not create citizen account.");
    const body = (await response.json()) as { session: WhistleAuthSession };
    return { ok: true, session: body.session };
  } catch {
    return { ok: false, status: 503, error: "auth_unavailable", message: "Auth service is unavailable." };
  }
}

export async function changeSessionPassword(session: WhistleAuthSession, currentPassword: string, newPassword: string) {
  try {
    const response = await fetch(`${API_BASE}/api/auth/password/change`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(session.sessionToken ? { "x-whistle-session-token": session.sessionToken } : {}),
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!response.ok) return rejected(response, "password_change_rejected", "Could not change password.");
    return { ok: true as const };
  } catch {
    return { ok: false as const, status: 503, error: "auth_unavailable", message: "Auth service is unavailable." };
  }
}

export async function resetAccountPassword(input: {
  surface: AuthSurface;
  phone: string;
  newPassword: string;
  phoneVerificationToken: string;
}): Promise<PasswordResetResult> {
  try {
    const response = await fetch(`${API_BASE}/api/auth/password/reset`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) return rejected(response, "password_reset_rejected", "Could not reset password.");
    return { ok: true };
  } catch {
    return { ok: false, status: 503, error: "auth_unavailable", message: "Auth service is unavailable." };
  }
}

export async function logoutSession(session: WhistleAuthSession) {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(session.sessionToken ? { "x-whistle-session-token": session.sessionToken } : {}),
      },
      body: JSON.stringify(session.sessionToken ? { sessionToken: session.sessionToken } : {}),
    });
  } catch {
    // Logging out is best-effort on the client.
  }
}
