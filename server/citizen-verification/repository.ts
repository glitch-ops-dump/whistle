import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { z } from "zod";
import { createOtpDeliveryProvider, type OtpDeliveryProvider, type OtpDeliveryReceipt } from "./otpDelivery.js";
import type { Language } from "../ticket-spine/types.js";

export type PhoneOtpChallenge = {
  challengeId: string;
  phoneMasked: string;
  expiresAt: string;
  resendAfter: string;
  mockOtp?: string;
  delivery: "sms_mock" | "sms_provider";
  deliveryProvider: string;
  providerMessageId: string;
};

export type PhoneOtpVerification = {
  verificationToken: string;
  phoneMasked: string;
  verifiedAt: string;
  expiresAt: string;
};

type StoredPhoneChallenge = {
  challengeId: string;
  phoneMasked: string;
  phoneHash: string;
  otpHash: string;
  status: "pending" | "verified" | "expired" | "locked";
  attempts: number;
  maxAttempts: number;
  verificationToken: string | null;
  expiresAt: string;
  tokenExpiresAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ValidationResult =
  | { ok: true; challenge: StoredPhoneChallenge }
  | { ok: false; status: number; error: string; message: string };

export const phoneOtpStartSchema = z.object({
  phone: z.string().trim().min(10).max(24),
  language: z.enum(["en", "ta"]).default("en"),
});

export const phoneOtpVerifySchema = z.object({
  challengeId: z.string().trim().min(8).max(80),
  otp: z.string().trim().regex(/^\d{6}$/),
});

export type PhoneVerificationRepository = {
  readonly mode: string;
  readonly deliveryMode: string;
  healthCheck(): Promise<void>;
  startChallenge(phone: string, language: Language): Promise<PhoneOtpChallenge>;
  verifyChallenge(challengeId: string, otp: string): Promise<PhoneOtpVerification | ValidationResult>;
  validateToken(token: string, phone: string): Promise<ValidationResult>;
  close(): Promise<void>;
};

const mockOtp = "123456";

function addMinutesIso(minutes: number) {
  const date = new Date();
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function normalisePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

export function maskCitizenPhone(phone: string) {
  const digits = normalisePhone(phone);
  if (digits.length < 4) return "verified phone";
  return `XXXXXX${digits.slice(-4)}`;
}

export function hashPhoneForVerification(phone: string) {
  return createHash("sha256").update(normalisePhone(phone)).digest("hex");
}

function hashOtp(challengeId: string, otp: string) {
  return createHash("sha256").update(`${challengeId}:${otp}`).digest("hex");
}

function token() {
  return `pvt_${randomUUID()}`;
}

function challengeId() {
  return `otp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isPast(iso: string | null) {
  return !iso || new Date(iso).getTime() <= Date.now();
}

function publicChallenge(challenge: StoredPhoneChallenge, delivery: OtpDeliveryReceipt): PhoneOtpChallenge {
  return {
    challengeId: challenge.challengeId,
    phoneMasked: challenge.phoneMasked,
    expiresAt: challenge.expiresAt,
    resendAfter: addMinutesIso(1),
    delivery: delivery.delivery,
    deliveryProvider: delivery.deliveryProvider,
    providerMessageId: delivery.providerMessageId,
    mockOtp: delivery.mockOtp,
  };
}

function verificationFromChallenge(challenge: StoredPhoneChallenge): PhoneOtpVerification {
  return {
    verificationToken: challenge.verificationToken ?? "",
    phoneMasked: challenge.phoneMasked,
    verifiedAt: challenge.verifiedAt ?? new Date().toISOString(),
    expiresAt: challenge.tokenExpiresAt ?? addMinutesIso(30),
  };
}

export class DevPhoneVerificationRepository implements PhoneVerificationRepository {
  readonly mode = "mvp-dev-memory";

  private readonly challenges = new Map<string, StoredPhoneChallenge>();

  constructor(private readonly otpDeliveryProvider: OtpDeliveryProvider) {}

  get deliveryMode() {
    return this.otpDeliveryProvider.mode;
  }

  async healthCheck() {
    await this.otpDeliveryProvider.healthCheck();
  }

  async startChallenge(phone: string, language: Language) {
    const id = challengeId();
    const now = new Date().toISOString();
    const challenge: StoredPhoneChallenge = {
      challengeId: id,
      phoneMasked: maskCitizenPhone(phone),
      phoneHash: hashPhoneForVerification(phone),
      otpHash: hashOtp(id, mockOtp),
      status: "pending",
      attempts: 0,
      maxAttempts: 5,
      verificationToken: null,
      expiresAt: addMinutesIso(10),
      tokenExpiresAt: null,
      verifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.challenges.set(id, challenge);
    const delivery = await this.otpDeliveryProvider.deliverOtp({
      challengeId: id,
      phone: `+${normalisePhone(phone)}`,
      phoneMasked: challenge.phoneMasked,
      phoneHash: challenge.phoneHash,
      otp: mockOtp,
      language,
    });
    return publicChallenge(challenge, delivery);
  }

  async verifyChallenge(challengeIdValue: string, otp: string) {
    const challenge = this.challenges.get(challengeIdValue);
    if (!challenge) return { ok: false as const, status: 404, error: "otp_challenge_not_found", message: "OTP challenge was not found. Start phone verification again." };
    const validation = this.validatePendingChallenge(challenge);
    if (!validation.ok) return validation;
    if (challenge.otpHash !== hashOtp(challenge.challengeId, otp)) {
      challenge.attempts += 1;
      challenge.status = challenge.attempts >= challenge.maxAttempts ? "locked" : "pending";
      challenge.updatedAt = new Date().toISOString();
      return { ok: false as const, status: 401, error: "invalid_otp", message: "The OTP does not match the latest verification code." };
    }
    challenge.status = "verified";
    challenge.verificationToken = token();
    challenge.verifiedAt = new Date().toISOString();
    challenge.tokenExpiresAt = addMinutesIso(30);
    challenge.updatedAt = challenge.verifiedAt;
    return verificationFromChallenge(challenge);
  }

  async validateToken(verificationToken: string, phone: string): Promise<ValidationResult> {
    const challenge = [...this.challenges.values()].find((item) => item.verificationToken === verificationToken);
    if (!challenge) return { ok: false, status: 401, error: "phone_verification_required", message: "Verify the citizen phone number before submitting this complaint." };
    return validateVerifiedChallenge(challenge, phone);
  }

  async close() {
    this.challenges.clear();
  }

  private validatePendingChallenge(challenge: StoredPhoneChallenge): ValidationResult {
    if (challenge.status === "locked") return { ok: false, status: 423, error: "otp_challenge_locked", message: "Too many OTP attempts. Start phone verification again." };
    if (challenge.status === "verified") return { ok: false, status: 409, error: "otp_challenge_already_verified", message: "This OTP challenge has already been verified." };
    if (isPast(challenge.expiresAt)) {
      challenge.status = "expired";
      challenge.updatedAt = new Date().toISOString();
      return { ok: false, status: 410, error: "otp_challenge_expired", message: "The OTP expired. Start phone verification again." };
    }
    return { ok: true, challenge };
  }
}

type PhoneChallengeRow = {
  challenge_id: string;
  phone_masked: string;
  phone_hash: string;
  otp_hash: string;
  status: StoredPhoneChallenge["status"];
  attempts: number;
  max_attempts: number;
  verification_token: string | null;
  expires_at: Date;
  token_expires_at: Date | null;
  verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export class PostgresPhoneVerificationRepository implements PhoneVerificationRepository {
  readonly mode = "mvp-postgres";

  private readonly pool: pg.Pool;

  constructor(databaseUrl: string, private readonly otpDeliveryProvider: OtpDeliveryProvider) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  get deliveryMode() {
    return this.otpDeliveryProvider.mode;
  }

  async healthCheck() {
    await this.pool.query("select 1 from citizen_phone_verifications limit 1");
    await this.otpDeliveryProvider.healthCheck();
  }

  async startChallenge(phone: string, language: Language) {
    const id = challengeId();
    const now = new Date().toISOString();
    const challenge: StoredPhoneChallenge = {
      challengeId: id,
      phoneMasked: maskCitizenPhone(phone),
      phoneHash: hashPhoneForVerification(phone),
      otpHash: hashOtp(id, mockOtp),
      status: "pending",
      attempts: 0,
      maxAttempts: 5,
      verificationToken: null,
      expiresAt: addMinutesIso(10),
      tokenExpiresAt: null,
      verifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.pool.query(
      `
        insert into citizen_phone_verifications (
          challenge_id, phone_masked, phone_hash, otp_hash, status, attempts, max_attempts,
          verification_token, expires_at, token_expires_at, verified_at, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        challenge.challengeId,
        challenge.phoneMasked,
        challenge.phoneHash,
        challenge.otpHash,
        challenge.status,
        challenge.attempts,
        challenge.maxAttempts,
        challenge.verificationToken,
        challenge.expiresAt,
        challenge.tokenExpiresAt,
        challenge.verifiedAt,
        challenge.createdAt,
        challenge.updatedAt,
      ],
    );
    const delivery = await this.otpDeliveryProvider.deliverOtp({
      challengeId: id,
      phone: `+${normalisePhone(phone)}`,
      phoneMasked: challenge.phoneMasked,
      phoneHash: challenge.phoneHash,
      otp: mockOtp,
      language,
    });
    return publicChallenge(challenge, delivery);
  }

  async verifyChallenge(challengeIdValue: string, otp: string) {
    const challenge = await this.findByChallengeId(challengeIdValue);
    if (!challenge) return { ok: false as const, status: 404, error: "otp_challenge_not_found", message: "OTP challenge was not found. Start phone verification again." };
    const pending = validatePendingChallenge(challenge);
    if (!pending.ok) {
      if (pending.error === "otp_challenge_expired") await this.updateChallenge(challenge);
      return pending;
    }
    if (challenge.otpHash !== hashOtp(challenge.challengeId, otp)) {
      challenge.attempts += 1;
      challenge.status = challenge.attempts >= challenge.maxAttempts ? "locked" : "pending";
      challenge.updatedAt = new Date().toISOString();
      await this.updateChallenge(challenge);
      return { ok: false as const, status: 401, error: "invalid_otp", message: "The OTP does not match the latest verification code." };
    }
    challenge.status = "verified";
    challenge.verificationToken = token();
    challenge.verifiedAt = new Date().toISOString();
    challenge.tokenExpiresAt = addMinutesIso(30);
    challenge.updatedAt = challenge.verifiedAt;
    await this.updateChallenge(challenge);
    return verificationFromChallenge(challenge);
  }

  async validateToken(verificationToken: string, phone: string): Promise<ValidationResult> {
    const challenge = await this.findByToken(verificationToken);
    if (!challenge) return { ok: false, status: 401, error: "phone_verification_required", message: "Verify the citizen phone number before submitting this complaint." };
    const validation = validateVerifiedChallenge(challenge, phone);
    if (!validation.ok && validation.error === "phone_verification_expired") await this.updateChallenge(challenge);
    return validation;
  }

  async close() {
    await this.pool.end();
  }

  private async findByChallengeId(challengeIdValue: string) {
    const result = await this.pool.query<PhoneChallengeRow>(
      `
        select challenge_id, phone_masked, phone_hash, otp_hash, status, attempts, max_attempts,
               verification_token, expires_at, token_expires_at, verified_at, created_at, updated_at
        from citizen_phone_verifications
        where challenge_id = $1
      `,
      [challengeIdValue],
    );
    return result.rows[0] ? rowToChallenge(result.rows[0]) : null;
  }

  private async findByToken(verificationToken: string) {
    const result = await this.pool.query<PhoneChallengeRow>(
      `
        select challenge_id, phone_masked, phone_hash, otp_hash, status, attempts, max_attempts,
               verification_token, expires_at, token_expires_at, verified_at, created_at, updated_at
        from citizen_phone_verifications
        where verification_token = $1
      `,
      [verificationToken],
    );
    return result.rows[0] ? rowToChallenge(result.rows[0]) : null;
  }

  private async updateChallenge(challenge: StoredPhoneChallenge) {
    await this.pool.query(
      `
        update citizen_phone_verifications
        set status = $2,
            attempts = $3,
            verification_token = $4,
            token_expires_at = $5,
            verified_at = $6,
            updated_at = $7
        where challenge_id = $1
      `,
      [
        challenge.challengeId,
        challenge.status,
        challenge.attempts,
        challenge.verificationToken,
        challenge.tokenExpiresAt,
        challenge.verifiedAt,
        challenge.updatedAt,
      ],
    );
  }
}

function validatePendingChallenge(challenge: StoredPhoneChallenge): ValidationResult {
  if (challenge.status === "locked") return { ok: false, status: 423, error: "otp_challenge_locked", message: "Too many OTP attempts. Start phone verification again." };
  if (challenge.status === "verified") return { ok: false, status: 409, error: "otp_challenge_already_verified", message: "This OTP challenge has already been verified." };
  if (isPast(challenge.expiresAt)) {
    challenge.status = "expired";
    challenge.updatedAt = new Date().toISOString();
    return { ok: false, status: 410, error: "otp_challenge_expired", message: "The OTP expired. Start phone verification again." };
  }
  return { ok: true, challenge };
}

function validateVerifiedChallenge(challenge: StoredPhoneChallenge, phone: string): ValidationResult {
  if (challenge.status !== "verified" || !challenge.verificationToken) {
    return { ok: false, status: 401, error: "phone_verification_required", message: "Verify the citizen phone number before submitting this complaint." };
  }
  if (isPast(challenge.tokenExpiresAt)) {
    challenge.status = "expired";
    challenge.updatedAt = new Date().toISOString();
    return { ok: false, status: 410, error: "phone_verification_expired", message: "Phone verification expired. Verify the number again." };
  }
  if (challenge.phoneHash !== hashPhoneForVerification(phone)) {
    return { ok: false, status: 403, error: "phone_verification_phone_mismatch", message: "The verified phone does not match the complaint phone number." };
  }
  return { ok: true, challenge };
}

function rowToChallenge(row: PhoneChallengeRow): StoredPhoneChallenge {
  return {
    challengeId: row.challenge_id,
    phoneMasked: row.phone_masked,
    phoneHash: row.phone_hash,
    otpHash: row.otp_hash,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    verificationToken: row.verification_token,
    expiresAt: row.expires_at.toISOString(),
    tokenExpiresAt: row.token_expires_at?.toISOString() ?? null,
    verifiedAt: row.verified_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function createPhoneVerificationRepository(otpDeliveryProvider = createOtpDeliveryProvider()): PhoneVerificationRepository {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) return new PostgresPhoneVerificationRepository(databaseUrl, otpDeliveryProvider);
  return new DevPhoneVerificationRepository(otpDeliveryProvider);
}
