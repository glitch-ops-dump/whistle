import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import pg from "pg";
import { governmentPasswordAuthEnabled } from "../auth/governmentPasswordAuth.js";
import type { GovRole } from "../ticket-spine/types.js";

export type AccountSurface = "citizen" | "government";
export type AccountRole = "citizen" | GovRole;

export type WhistleAccount = {
  id: string;
  phone: string;
  phoneMasked: string;
  displayName: string;
  surface: AccountSurface;
  actorKey: string;
  roles: AccountRole[];
  status: "active" | "inactive";
  passwordUpdatedAt: string;
  createdAt: string;
};

export type WhistleSession = {
  sessionToken: string;
  accountId: string;
  phone: string;
  phoneMasked: string;
  displayName: string;
  surface: AccountSurface;
  actor: string;
  role: AccountRole;
  roles: AccountRole[];
  phoneVerificationToken?: string;
  expiresAt: string;
  createdAt: string;
};

export type PasswordMutationResult =
  | { ok: true }
  | { ok: false; status: number; error: string; message: string };

type StoredAccount = WhistleAccount & {
  passwordHash: string;
};

type AccountRow = {
  id: string;
  phone: string;
  phone_masked: string;
  display_name: string;
  surface: AccountSurface;
  actor_key: string;
  roles: AccountRole[];
  status: "active" | "inactive";
  password_hash: string;
  password_updated_at: Date;
  created_at: Date;
};

type SessionRow = {
  session_token: string;
  account_id: string;
  phone: string;
  phone_masked: string;
  display_name: string;
  surface: AccountSurface;
  actor_key: string;
  role: AccountRole;
  roles: AccountRole[];
  phone_verification_token: string | null;
  expires_at: Date;
  created_at: Date;
};

export type AccountRepository = {
  readonly mode: string;
  healthCheck(): Promise<void>;
  createCitizenAccount(input: { phone: string; displayName?: string; password: string }): Promise<WhistleAccount>;
  verifyPassword(phone: string, password: string, surface: AccountSurface): Promise<WhistleAccount | null>;
  findByPhone(phone: string, surface: AccountSurface): Promise<WhistleAccount | null>;
  createSession(input: {
    account: WhistleAccount;
    role: AccountRole;
    phoneVerificationToken?: string;
  }): Promise<WhistleSession>;
  getSession(sessionToken: string): Promise<WhistleSession | null>;
  changePassword(sessionToken: string, currentPassword: string, newPassword: string): Promise<PasswordMutationResult>;
  resetPassword(input: { surface: AccountSurface; phone: string; newPassword: string }): Promise<PasswordMutationResult>;
  deleteSession(sessionToken: string): Promise<void>;
  close(): Promise<void>;
};

const defaultPassword = process.env.WHISTLE_UAT_DEFAULT_PASSWORD ?? "Whistle@123";

const seededGovernmentAccounts: Array<{
  id: string;
  phone: string;
  displayName: string;
  actorKey: string;
  roles: GovRole[];
}> = [
  { id: "acct-admin-prototype", phone: "+91 90000 25005", displayName: "Meera Iyer", actorKey: "admin:prototype", roles: ["admin"] },
  { id: "acct-cm-cell-prototype", phone: "+91 90000 21001", displayName: "Anitha Raman", actorKey: "cm_cell:prototype", roles: ["cm_cell"] },
  { id: "acct-verification-prototype", phone: "+91 90000 26006", displayName: "Ticket Verification Officer", actorKey: "verification:prototype", roles: ["verification"] },
  { id: "acct-minister-prototype", phone: "+91 90000 22010", displayName: "R. Kavitha", actorKey: "minister:prototype", roles: ["minister"] },
  { id: "acct-dept-officer-prototype", phone: "+91 90000 22011", displayName: "MAWS Department Officer", actorKey: "department_officer:prototype", roles: ["department_officer"] },
  { id: "acct-mla-prototype", phone: "+91 90000 23003", displayName: "M. Selvi", actorKey: "mla:prototype", roles: ["mla"] },
  { id: "acct-councillor-prototype", phone: "+91 90000 24004", displayName: "D. Arun", actorKey: "councillor:prototype", roles: ["councillor"] },
];

const seededGovernmentAccountIds = seededGovernmentAccounts.map((account) => account.id);

function normalisePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

function maskPhone(phone: string) {
  const digits = normalisePhone(phone);
  if (digits.length < 4) return "verified phone";
  return `XXXXXX${digits.slice(-4)}`;
}

function accountId(prefix: string, phone: string) {
  return `${prefix}-${normalisePhone(phone).slice(-10)}`;
}

function sessionToken() {
  return `ws_${randomBytes(32).toString("hex")}`;
}

function addHoursIso(hours: number) {
  const date = new Date();
  date.setHours(date.getHours() + hours);
  return date.toISOString();
}

function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPasswordHash(password: string, storedHash: string) {
  const [kind, salt, hash] = storedHash.split(":");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const candidate = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

function publicAccount(account: StoredAccount): WhistleAccount {
  const { passwordHash: _passwordHash, ...safeAccount } = account;
  return safeAccount;
}

function cloneSession(session: WhistleSession): WhistleSession {
  return {
    ...session,
    roles: [...session.roles],
  };
}

function seedAccount(seed: (typeof seededGovernmentAccounts)[number]): StoredAccount {
  const now = new Date().toISOString();
  return {
    id: seed.id,
    phone: normalisePhone(seed.phone),
    phoneMasked: maskPhone(seed.phone),
    displayName: seed.displayName,
    surface: "government",
    actorKey: seed.actorKey,
    roles: seed.roles,
    status: "active",
    passwordHash: passwordHash(defaultPassword),
    passwordUpdatedAt: now,
    createdAt: now,
  };
}

export class DevAccountRepository implements AccountRepository {
  readonly mode = "mvp-dev-memory";

  private readonly accounts = new Map<string, StoredAccount>();
  private readonly sessions = new Map<string, WhistleSession>();

  constructor() {
    if (!governmentPasswordAuthEnabled()) return;
    for (const seed of seededGovernmentAccounts) {
      const account = seedAccount(seed);
      this.accounts.set(`${account.surface}:${account.phone}`, account);
    }
  }

  async healthCheck() {
    return;
  }

  async createCitizenAccount(input: { phone: string; displayName?: string; password: string }) {
    const phone = normalisePhone(input.phone);
    const key = `citizen:${phone}`;
    const existing = this.accounts.get(key);
    if (existing) return publicAccount(existing);
    const now = new Date().toISOString();
    const account: StoredAccount = {
      id: accountId("acct-citizen", phone),
      phone,
      phoneMasked: maskPhone(phone),
      displayName: input.displayName?.trim() || `Citizen ${phone.slice(-4)}`,
      surface: "citizen",
      actorKey: `citizen:${phone.slice(-10)}`,
      roles: ["citizen"],
      status: "active",
      passwordHash: passwordHash(input.password),
      passwordUpdatedAt: now,
      createdAt: now,
    };
    this.accounts.set(key, account);
    return publicAccount(account);
  }

  async verifyPassword(phone: string, password: string, surface: AccountSurface) {
    const account = this.accounts.get(`${surface}:${normalisePhone(phone)}`);
    if (!account || account.status !== "active") return null;
    if (!verifyPasswordHash(password, account.passwordHash)) return null;
    return publicAccount(account);
  }

  async findByPhone(phone: string, surface: AccountSurface) {
    const account = this.accounts.get(`${surface}:${normalisePhone(phone)}`);
    return account ? publicAccount(account) : null;
  }

  async createSession(input: { account: WhistleAccount; role: AccountRole; phoneVerificationToken?: string }) {
    const now = new Date().toISOString();
    const session: WhistleSession = {
      sessionToken: sessionToken(),
      accountId: input.account.id,
      phone: input.account.phone,
      phoneMasked: input.account.phoneMasked,
      displayName: input.account.displayName,
      surface: input.account.surface,
      actor: input.account.actorKey,
      role: input.role,
      roles: [...input.account.roles],
      phoneVerificationToken: input.phoneVerificationToken,
      expiresAt: addHoursIso(12),
      createdAt: now,
    };
    this.sessions.set(session.sessionToken, session);
    return cloneSession(session);
  }

  async getSession(token: string) {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return cloneSession(session);
  }

  async changePassword(sessionTokenValue: string, currentPassword: string, newPassword: string) {
    const session = await this.getSession(sessionTokenValue);
    if (!session) return { ok: false as const, status: 401, error: "session_required", message: "Sign in again before changing password." };
    const account = this.accounts.get(`${session.surface}:${session.phone}`);
    if (!account || !verifyPasswordHash(currentPassword, account.passwordHash)) {
      return { ok: false as const, status: 401, error: "invalid_current_password", message: "Current password is incorrect." };
    }
    account.passwordHash = passwordHash(newPassword);
    account.passwordUpdatedAt = new Date().toISOString();
    return { ok: true as const };
  }

  async resetPassword(input: { surface: AccountSurface; phone: string; newPassword: string }) {
    const account = this.accounts.get(`${input.surface}:${normalisePhone(input.phone)}`);
    if (!account || account.status !== "active") {
      return { ok: false as const, status: 404, error: "account_not_found", message: "No active Whistle account was found for this mobile number." };
    }
    account.passwordHash = passwordHash(input.newPassword);
    account.passwordUpdatedAt = new Date().toISOString();
    for (const [token, session] of this.sessions.entries()) {
      if (session.accountId === account.id) this.sessions.delete(token);
    }
    return { ok: true as const };
  }

  async deleteSession(sessionTokenValue: string) {
    this.sessions.delete(sessionTokenValue);
  }

  async close() {
    this.sessions.clear();
  }
}

export class PostgresAccountRepository implements AccountRepository {
  readonly mode = "mvp-postgres";

  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  async healthCheck() {
    await this.ensureTables();
    await this.pool.query("select 1 from whistle_accounts limit 1");
  }

  async createCitizenAccount(input: { phone: string; displayName?: string; password: string }) {
    await this.ensureTables();
    const phone = normalisePhone(input.phone);
    const now = new Date().toISOString();
    const result = await this.pool.query<AccountRow>(
      `
        insert into whistle_accounts (
          id, phone, phone_masked, display_name, surface, actor_key, roles,
          status, password_hash, password_updated_at, created_at
        )
        values ($1, $2, $3, $4, 'citizen', $5, $6, 'active', $7, $8, $8)
        on conflict (surface, phone) do update
          set display_name = whistle_accounts.display_name
        returning id, phone, phone_masked, display_name, surface, actor_key, roles,
                  status, password_hash, password_updated_at, created_at
      `,
      [
        accountId("acct-citizen", phone),
        phone,
        maskPhone(phone),
        input.displayName?.trim() || `Citizen ${phone.slice(-4)}`,
        `citizen:${phone.slice(-10)}`,
        ["citizen"],
        passwordHash(input.password),
        now,
      ],
    );
    return publicAccount(rowToAccount(result.rows[0]));
  }

  async verifyPassword(phone: string, password: string, surface: AccountSurface) {
    await this.ensureTables();
    const account = await this.findStoredByPhone(phone, surface);
    if (!account || account.status !== "active") return null;
    if (!verifyPasswordHash(password, account.passwordHash)) return null;
    return publicAccount(account);
  }

  async findByPhone(phone: string, surface: AccountSurface) {
    await this.ensureTables();
    const account = await this.findStoredByPhone(phone, surface);
    return account ? publicAccount(account) : null;
  }

  async createSession(input: { account: WhistleAccount; role: AccountRole; phoneVerificationToken?: string }) {
    await this.ensureTables();
    const token = sessionToken();
    const now = new Date().toISOString();
    const expiresAt = addHoursIso(12);
    const result = await this.pool.query<SessionRow>(
      `
        insert into whistle_account_sessions (
          session_token, account_id, phone, phone_masked, display_name, surface,
          actor_key, role, roles, phone_verification_token, expires_at, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        returning session_token, account_id, phone, phone_masked, display_name, surface,
                  actor_key, role, roles, phone_verification_token, expires_at, created_at
      `,
      [
        token,
        input.account.id,
        input.account.phone,
        input.account.phoneMasked,
        input.account.displayName,
        input.account.surface,
        input.account.actorKey,
        input.role,
        input.account.roles,
        input.phoneVerificationToken ?? null,
        expiresAt,
        now,
      ],
    );
    return rowToSession(result.rows[0]);
  }

  async getSession(token: string) {
    await this.ensureTables();
    const result = await this.pool.query<SessionRow>(
      `
        select session_token, account_id, phone, phone_masked, display_name, surface,
               actor_key, role, roles, phone_verification_token, expires_at, created_at
        from whistle_account_sessions
        where session_token = $1 and expires_at > now()
      `,
      [token],
    );
    return result.rows[0] ? rowToSession(result.rows[0]) : null;
  }

  async changePassword(sessionTokenValue: string, currentPassword: string, newPassword: string) {
    await this.ensureTables();
    const session = await this.getSession(sessionTokenValue);
    if (!session) return { ok: false as const, status: 401, error: "session_required", message: "Sign in again before changing password." };
    const account = await this.findStoredByPhone(session.phone, session.surface);
    if (!account || !verifyPasswordHash(currentPassword, account.passwordHash)) {
      return { ok: false as const, status: 401, error: "invalid_current_password", message: "Current password is incorrect." };
    }
    await this.pool.query(
      `
        update whistle_accounts
        set password_hash = $2,
            password_updated_at = now()
        where id = $1
      `,
      [account.id, passwordHash(newPassword)],
    );
    return { ok: true as const };
  }

  async resetPassword(input: { surface: AccountSurface; phone: string; newPassword: string }) {
    await this.ensureTables();
    const account = await this.findStoredByPhone(input.phone, input.surface);
    if (!account || account.status !== "active") {
      return { ok: false as const, status: 404, error: "account_not_found", message: "No active Whistle account was found for this mobile number." };
    }
    await this.pool.query(
      `
        update whistle_accounts
        set password_hash = $2,
            password_updated_at = now()
        where id = $1
      `,
      [account.id, passwordHash(input.newPassword)],
    );
    await this.pool.query("delete from whistle_account_sessions where account_id = $1", [account.id]);
    return { ok: true as const };
  }

  async deleteSession(sessionTokenValue: string) {
    await this.ensureTables();
    await this.pool.query("delete from whistle_account_sessions where session_token = $1", [sessionTokenValue]);
  }

  async close() {
    await this.pool.end();
  }

  private async findStoredByPhone(phone: string, surface: AccountSurface) {
    const result = await this.pool.query<AccountRow>(
      `
        select id, phone, phone_masked, display_name, surface, actor_key, roles,
               status, password_hash, password_updated_at, created_at
        from whistle_accounts
        where surface = $1 and phone = $2
      `,
      [surface, normalisePhone(phone)],
    );
    return result.rows[0] ? rowToAccount(result.rows[0]) : null;
  }

  private async ensureTables() {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext('whistle_account_tables'))");
      await client.query(`
        create table if not exists whistle_accounts (
          id text primary key,
          phone text not null,
          phone_masked text not null,
          display_name text not null,
          surface text not null check (surface in ('citizen', 'government')),
          actor_key text not null,
          roles text[] not null,
          status text not null check (status in ('active', 'inactive')),
          password_hash text not null,
          password_updated_at timestamptz not null default now(),
          created_at timestamptz not null default now(),
          unique (surface, phone)
        )
      `);
      await client.query(`
        create table if not exists whistle_account_sessions (
          session_token text primary key,
          account_id text not null references whistle_accounts(id),
          phone text not null,
          phone_masked text not null,
          display_name text not null,
          surface text not null check (surface in ('citizen', 'government')),
          actor_key text not null,
          role text not null,
          roles text[] not null,
          phone_verification_token text,
          expires_at timestamptz not null,
          created_at timestamptz not null default now()
        )
      `);
      await client.query("create index if not exists whistle_account_sessions_expiry_idx on whistle_account_sessions (expires_at)");
      if (governmentPasswordAuthEnabled()) {
        for (const seed of seededGovernmentAccounts) {
          const account = seedAccount(seed);
          await client.query(
            `
              insert into whistle_accounts (
                id, phone, phone_masked, display_name, surface, actor_key, roles,
                status, password_hash, password_updated_at, created_at
              )
              values ($1, $2, $3, $4, 'government', $5, $6, 'active', $7, $8, $8)
              on conflict (surface, phone) do nothing
            `,
            [account.id, account.phone, account.phoneMasked, account.displayName, account.actorKey, account.roles, account.passwordHash, account.createdAt],
          );
        }
      } else {
        await client.query("delete from whistle_account_sessions where account_id = any($1::text[])", [seededGovernmentAccountIds]);
        await client.query(
          `
            update whistle_accounts
            set status = 'inactive'
            where surface = 'government' and id = any($1::text[])
          `,
          [seededGovernmentAccountIds],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

function rowToAccount(row: AccountRow): StoredAccount {
  return {
    id: row.id,
    phone: row.phone,
    phoneMasked: row.phone_masked,
    displayName: row.display_name,
    surface: row.surface,
    actorKey: row.actor_key,
    roles: row.roles,
    status: row.status,
    passwordHash: row.password_hash,
    passwordUpdatedAt: row.password_updated_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

function rowToSession(row: SessionRow): WhistleSession {
  return {
    sessionToken: row.session_token,
    accountId: row.account_id,
    phone: row.phone,
    phoneMasked: row.phone_masked,
    displayName: row.display_name,
    surface: row.surface,
    actor: row.actor_key,
    role: row.role,
    roles: row.roles,
    phoneVerificationToken: row.phone_verification_token ?? undefined,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

export function createAccountRepository(): AccountRepository {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) return new PostgresAccountRepository(databaseUrl);
  return new DevAccountRepository();
}

export function governmentUatDemoAccounts() {
  return seededGovernmentAccounts.map((account) => ({
    phone: account.phone,
    displayName: account.displayName,
    actor: account.actorKey,
    roles: account.roles,
    password: defaultPassword,
  }));
}
