import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { KeyRound, LockKeyhole, LogOut, Phone, RefreshCcw, Settings, ShieldCheck, UserPlus } from "lucide-react";
import {
  changeSessionPassword,
  clearAuthSession,
  fetchAuthConfig,
  loadAuthSession,
  loginWithMobilePassword,
  logoutSession,
  registerCitizenAccount,
  resetAccountPassword,
  startAuthOtp,
  storeAuthSession,
  verifyAuthOtp,
  type AuthConfig,
  type AuthSurface,
  type WhistleAuthSession,
} from "./authApi";
import type { GovRole } from "./govDashboardApi";
import "./auth.css";
import "./focus.css";

type AuthGateProps = {
  allowedRoles?: GovRole[];
  children: ReactNode | ((session: WhistleAuthSession) => ReactNode);
  defaultRole?: GovRole;
  subtitle: string;
  surface: AuthSurface;
  title: string;
};

type OtpUiState = {
  status: "idle" | "sending" | "sent" | "verifying" | "verified" | "error";
  challengeId?: string;
  mockOtp?: string;
  token?: string;
  message?: string;
};

const roleLabels: Record<GovRole, string> = {
  admin: "Admin Console",
  cm_cell: "CM Cell",
  minister: "Minister",
  department_officer: "Department Officer",
  verification: "Verification Team",
  mla: "MLA Office",
  councillor: "Councillor / Local Owner",
};

// Prototype seed accounts. Keep in sync with seededGovernmentAccounts in
// server/account/repository.ts — these are stable local-UAT constants used
// only as a prefill fallback when /api/auth/config exposes no demo accounts.
const seededRolePhones: Record<GovRole, string> = {
  admin: "+91 90000 25005",
  cm_cell: "+91 90000 21001",
  minister: "+91 90000 22010",
  department_officer: "+91 90000 22011",
  verification: "+91 90000 26006",
  mla: "+91 90000 23003",
  councillor: "+91 90000 24004",
};

function roleKey(surface: AuthSurface, roles: GovRole[] | undefined, defaultRole: GovRole | undefined) {
  if (surface === "citizen") return "citizen";
  return roles?.join("_") || defaultRole || "government";
}

function phoneDigits(phone: string) {
  return phone.replace(/\D/g, "");
}

function passwordValid(password: string) {
  return password.length >= 8;
}

export default function AuthGate({ allowedRoles, children, defaultRole, subtitle, surface, title }: AuthGateProps) {
  const key = useMemo(() => roleKey(surface, allowedRoles, defaultRole), [allowedRoles, defaultRole, surface]);
  const [session, setSession] = useState<WhistleAuthSession | null>(() => loadAuthSession(surface, key));
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchAuthConfig().then((nextConfig) => {
      if (active) setConfig(nextConfig);
    });
    return () => {
      active = false;
    };
  }, []);

  const storeSession = (nextSession: WhistleAuthSession) => {
    storeAuthSession(nextSession, surface, key);
    setSession(nextSession);
  };

  const signOut = async () => {
    if (session) await logoutSession(session);
    clearAuthSession(surface, key);
    setAccountMenuOpen(false);
    setSettingsOpen(false);
    setSession(null);
  };

  if (!session) {
    return (
      <LoginPanel
        allowedRoles={allowedRoles}
        config={config}
        defaultRole={defaultRole}
        onSession={storeSession}
        subtitle={subtitle}
        surface={surface}
        title={title}
      />
    );
  }

  return (
    <div className={`auth-session-shell ${surface}`}>
      <div className="auth-user-bar">
        <span>
          <strong>{session.displayName}</strong>
          <small>{session.phoneMasked} · {session.role === "citizen" ? "Citizen" : roleLabels[session.role]}</small>
        </span>
        <div className="auth-session-actions">
          <button type="button" onClick={() => setSettingsOpen(true)}>
            <Settings size={15} />
            <span>Settings</span>
          </button>
          <button type="button" onClick={() => void signOut()}>
            <LogOut size={15} />
            <span>Sign out</span>
          </button>
        </div>
        <div className="auth-account-menu-wrap">
          <button
            aria-expanded={accountMenuOpen}
            aria-haspopup="menu"
            aria-label="Open account menu"
            className="auth-account-menu-button"
            type="button"
            onClick={() => setAccountMenuOpen((open) => !open)}
          >
            <Settings size={16} />
          </button>
          {accountMenuOpen && (
            <div className="auth-account-menu" role="menu">
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setAccountMenuOpen(false);
                  setSettingsOpen(true);
                }}
              >
                <Settings size={15} />
                <span>Settings</span>
              </button>
              <button role="menuitem" type="button" onClick={() => void signOut()}>
                <LogOut size={15} />
                <span>Sign out</span>
              </button>
            </div>
          )}
        </div>
      </div>
      {typeof children === "function" ? children(session) : children}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} onSignedOut={signOut} session={session} />}
    </div>
  );
}

function LoginPanel({
  allowedRoles,
  config,
  defaultRole,
  onSession,
  subtitle,
  surface,
  title,
}: {
  allowedRoles?: GovRole[];
  config: AuthConfig | null;
  defaultRole?: GovRole;
  onSession: (session: WhistleAuthSession) => void;
  subtitle: string;
  surface: AuthSurface;
  title: string;
}) {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [phone, setPhone] = useState(surface === "government" ? demoPhone(config, allowedRoles, defaultRole) : "+91 ");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState(surface === "government" ? "Whistle@123" : "");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<GovRole>(defaultRole ?? allowedRoles?.[0] ?? "cm_cell");
  const [otpCode, setOtpCode] = useState("");
  const [otpState, setOtpState] = useState<OtpUiState>({ status: "idle" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [roleMismatch, setRoleMismatch] = useState(false);
  const resetMode = mode === "reset";
  const otpRequiredByAdmin = surface === "citizen" ? config?.controls.citizenOtpRequired !== false : config?.controls.governmentOtpRequired === true;
  const otpRequired = resetMode || otpRequiredByAdmin;
  const passwordReady = passwordValid(password) && (!resetMode || password === confirmPassword);
  const canSubmit = phoneDigits(phone).length >= 10 && passwordReady && (!otpRequired || otpState.status === "verified");
  const canSendOtp = phoneDigits(phone).length >= 10 && otpState.status !== "sending";

  useEffect(() => {
    if (surface !== "government") return;
    setPhone(demoPhone(config, allowedRoles, defaultRole));
  }, [allowedRoles, config, defaultRole, surface]);

  const resetOtpState = () => {
    setOtpCode("");
    setOtpState({ status: "idle" });
  };

  const switchMode = (nextMode: "login" | "register" | "reset") => {
    setMode(nextMode);
    setMessage(null);
    setRoleMismatch(false);
    setConfirmPassword("");
    resetOtpState();
    if (nextMode === "reset") setPassword("");
    if (nextMode === "login" && surface === "government") setPassword("Whistle@123");
  };

  const sendOtp = async () => {
    if (!canSendOtp) return;
    setMessage(null);
    setOtpState({ status: "sending", message: "Sending OTP..." });
    const result = await startAuthOtp(phone, "en");
    if (!result.ok) {
      setOtpState({ status: "error", message: result.message });
      return;
    }
    setOtpCode(result.challenge.mockOtp ?? "");
    setOtpState({
      status: "sent",
      challengeId: result.challenge.challengeId,
      mockOtp: result.challenge.mockOtp,
      message: `OTP sent to ${result.challenge.phoneMasked}.`,
    });
  };

  const verifyOtp = async () => {
    if (!otpState.challengeId || otpCode.length < 6) return;
    setOtpState((current) => ({ ...current, status: "verifying", message: "Verifying OTP..." }));
    const result = await verifyAuthOtp(otpState.challengeId, otpCode);
    if (!result.ok) {
      setOtpState((current) => ({ ...current, status: "error", message: result.message }));
      return;
    }
    setOtpState((current) => ({
      ...current,
      status: "verified",
      token: result.verification.verificationToken,
      message: `Verified ${result.verification.phoneMasked}.`,
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setMessage(null);
    setRoleMismatch(false);
    if (resetMode) {
      const resetResult = await resetAccountPassword({
        surface,
        phone,
        newPassword: password,
        phoneVerificationToken: otpState.token ?? "",
      });
      setBusy(false);
      if (!resetResult.ok) {
        setMessage(resetResult.message);
        return;
      }
      setMode("login");
      setPassword("");
      setConfirmPassword("");
      resetOtpState();
      setMessage("Password reset. Login with your new password.");
      return;
    }
    const result =
      surface === "citizen" && mode === "register"
        ? await registerCitizenAccount({ phone, displayName, password, phoneVerificationToken: otpState.token })
        : await loginWithMobilePassword({
            surface,
            phone,
            password,
            role: surface === "government" ? role : undefined,
            phoneVerificationToken: otpState.token,
          });
    setBusy(false);
    if (!result.ok) {
      if (result.error === "role_not_allowed" && surface === "government") {
        setRoleMismatch(true);
        setMessage(
          `This account cannot open the ${roleLabels[role]} console. ` +
            `Sign in with a ${roleLabels[role]} account (seeded UAT: ${demoPhoneForRole(config, role)}), ` +
            "or pick the right console for your account from the launcher.",
        );
        return;
      }
      setRoleMismatch(false);
      setMessage(result.message);
      return;
    }
    onSession(result.session);
  };

  return (
    <main className={`auth-login-page ${surface}`}>
      <section className="auth-login-card">
        <div className="auth-brand-row">
          <img src="/assets/brand/whistle-fake-logo.svg" alt="" />
          <span>
            <strong>Whistle</strong>
            <small>{subtitle}</small>
          </span>
        </div>
        <div className="auth-title-block">
          <p>{surface === "citizen" ? "Citizen mobile account" : "Government console account"}</p>
          <h1>{resetMode ? "Reset Password" : title}</h1>
          <span>
            {resetMode
              ? "Verify your mobile number by OTP before setting a new password."
              : "Sign in with mobile number and password. OTP is asked for only when extra verification is turned on."}
          </span>
        </div>

        {surface === "citizen" && !resetMode && (
          <div className="auth-mode-tabs">
            <button className={mode === "login" ? "active" : ""} type="button" onClick={() => switchMode("login")}>Login</button>
            <button className={mode === "register" ? "active" : ""} type="button" onClick={() => switchMode("register")}>Create account</button>
          </div>
        )}

        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          {surface === "government" && allowedRoles && allowedRoles.length > 1 && (
            <label>
              <span>Console role</span>
              <select
                value={role}
                onChange={(event) => {
                  const nextRole = event.target.value as GovRole;
                  setRole(nextRole);
                  // Keep the prefill in step with the selected role, but never
                  // clobber a phone number the user typed themselves.
                  setPhone((current) => (isPrefillPhone(config, current) ? demoPhoneForRole(config, nextRole) : current));
                }}
              >
                {allowedRoles.map((item) => <option key={item} value={item}>{roleLabels[item]}</option>)}
              </select>
            </label>
          )}
          {mode === "register" && surface === "citizen" && (
            <label>
              <span>Name</span>
              <input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your name" />
            </label>
          )}
          <label>
            <span>Mobile number</span>
            <input autoComplete="tel" inputMode="tel" value={phone} onChange={(event) => {
              setPhone(event.target.value);
              setOtpCode("");
              setOtpState({ status: "idle" });
            }} />
          </label>
          <label>
            <span>{resetMode ? "New password" : "Password"}</span>
            <input
              autoComplete={mode === "register" || resetMode ? "new-password" : "current-password"}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={resetMode ? "New password" : "Minimum 8 characters"}
            />
          </label>
          {resetMode && (
            <label>
              <span>Confirm new password</span>
              <input autoComplete="new-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Re-enter new password" />
            </label>
          )}

          {mode === "login" && (
            <div className="auth-inline-actions">
              <button type="button" onClick={() => switchMode("reset")}>Forgot password?</button>
            </div>
          )}
          {resetMode && (
            <div className="auth-inline-actions">
              <button type="button" onClick={() => switchMode("login")}>Back to login</button>
            </div>
          )}

          {otpRequired && (
            <div className="auth-otp-box">
              <div>
                <ShieldCheck size={18} />
                <span>
                  <strong>{resetMode ? "OTP required for reset" : "OTP verification required"}</strong>
                  <small>{resetMode ? "Confirm this mobile number before setting a new password." : "Validate this mobile number before continuing."}</small>
                </span>
              </div>
              <button className="auth-secondary" disabled={!canSendOtp} type="button" onClick={() => void sendOtp()}>
                <Phone size={15} />
                {otpState.status === "sending" ? "Sending..." : "Send OTP"}
              </button>
              {otpState.status !== "idle" && (
                <div className="auth-otp-row">
                  <input inputMode="numeric" maxLength={6} placeholder="6 digit OTP" value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
                  <button className="auth-secondary red" disabled={otpCode.length < 6 || otpState.status === "verifying"} type="button" onClick={() => void verifyOtp()}>
                    {otpState.status === "verifying" ? "..." : "Verify"}
                  </button>
                </div>
              )}
              {otpState.mockOtp && <small className="auth-hint">Local UAT OTP: {otpState.mockOtp}</small>}
              {otpState.message && <small className={`auth-hint ${otpState.status}`}>{otpState.message}</small>}
            </div>
          )}

          {!otpRequired && (
            <div className="auth-soft-note">
              <LockKeyhole size={16} />
              <span>OTP is optional right now.</span>
            </div>
          )}

          {message && (
            <div className={message.startsWith("Password reset") ? "auth-success" : "auth-error"}>
              {message}
              {roleMismatch && (
                <>
                  {" "}
                  <a href="/index.html">Open console launcher</a>
                </>
              )}
            </div>
          )}
          {resetMode && password && confirmPassword && password !== confirmPassword && <div className="auth-error">New password and confirmation do not match.</div>}
          <button className="auth-primary" disabled={!canSubmit || busy} type="submit">
            {resetMode ? <RefreshCcw size={17} /> : mode === "register" ? <UserPlus size={17} /> : <KeyRound size={17} />}
            {busy ? "Checking..." : resetMode ? "Reset password" : mode === "register" ? "Create and continue" : "Login"}
          </button>
        </form>

        {surface === "government" && (
          <div className="auth-demo-list">
            <strong>UAT demo credentials</strong>
            <span>{demoCredentialLine(config, allowedRoles, defaultRole)}</span>
          </div>
        )}
      </section>
    </main>
  );
}

function isPrefillPhone(config: AuthConfig | null, phone: string) {
  if (Object.values(seededRolePhones).includes(phone)) return true;
  return Boolean(config?.demo.governmentAccounts.some((item) => item.phone === phone));
}

function demoPhoneForRole(config: AuthConfig | null, targetRole: GovRole | undefined) {
  const account = config?.demo.governmentAccounts.find((item) => !targetRole || item.roles.includes(targetRole));
  if (account) return account.phone;
  return targetRole ? seededRolePhones[targetRole] : seededRolePhones.cm_cell;
}

function demoPhone(config: AuthConfig | null, roles?: GovRole[], defaultRole?: GovRole) {
  return demoPhoneForRole(config, defaultRole ?? roles?.[0]);
}

function demoCredentialLine(config: AuthConfig | null, roles?: GovRole[], defaultRole?: GovRole) {
  const targetRole = defaultRole ?? roles?.[0];
  const account = config?.demo.governmentAccounts.find((item) => !targetRole || item.roles.includes(targetRole));
  if (!account) {
    return targetRole
      ? `Prefilled with the seeded ${roleLabels[targetRole]} UAT account (${seededRolePhones[targetRole]}).`
      : "Prefilled with the seeded UAT account for this console.";
  }
  return `${account.displayName}: ${account.phone} / ${account.password}`;
}

function SettingsPanel({
  onClose,
  onSignedOut,
  session,
}: {
  onClose: () => void;
  onSignedOut: () => Promise<void>;
  session: WhistleAuthSession;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canSubmit = passwordValid(currentPassword) && passwordValid(newPassword) && newPassword === confirmPassword;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await changeSessionPassword(session, currentPassword, newPassword);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage("Password changed. Sign in again with the new password.");
    await onSignedOut();
  };

  return (
    <div className="auth-settings-backdrop" role="dialog" aria-modal="true" aria-label="Account settings">
      <section className="auth-settings-panel">
        <div className="auth-settings-head">
          <span>
            <small>Account settings</small>
            <strong>{session.displayName}</strong>
            <em>{session.phoneMasked}</em>
          </span>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>Current password</span>
            <input autoComplete="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
          </label>
          <label>
            <span>New password</span>
            <input autoComplete="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          </label>
          <label>
            <span>Confirm new password</span>
            <input autoComplete="new-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          </label>
          {newPassword && confirmPassword && newPassword !== confirmPassword && <div className="auth-error">New password and confirmation do not match.</div>}
          {message && <div className={message.startsWith("Password changed") ? "auth-success" : "auth-error"}>{message}</div>}
          <button className="auth-primary" disabled={!canSubmit || busy} type="submit">
            <KeyRound size={17} />
            {busy ? "Changing..." : "Change password"}
          </button>
        </form>
      </section>
    </div>
  );
}
