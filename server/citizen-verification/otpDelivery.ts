import type { Language } from "../ticket-spine/types.js";

type EnvLike = Record<string, string | undefined>;

export type OtpDeliveryReceipt = {
  delivery: "sms_mock" | "sms_provider";
  deliveryProvider: string;
  providerMessageId: string;
  mockOtp?: string;
};

export type OtpDeliveryProvider = {
  readonly mode: string;
  readonly exposesOtpToApi: boolean;
  healthCheck(): Promise<void>;
  deliverOtp(input: {
    challengeId: string;
    phone: string;
    phoneMasked: string;
    phoneHash: string;
    otp: string;
    language: Language;
  }): Promise<OtpDeliveryReceipt>;
};

function exposeMockOtpFromEnv(env: EnvLike = process.env) {
  return env.WHISTLE_EXPOSE_MOCK_OTP !== "false";
}

function otpDeliveryModeFromEnv(env: EnvLike = process.env) {
  return env.WHISTLE_OTP_PROVIDER_MODE?.trim().toLowerCase() ?? "";
}

function deploymentRequiresOtpProvider(env: EnvLike = process.env) {
  const value = (env.WHISTLE_DEPLOYMENT_PROFILE ?? env.WHISTLE_ENV ?? env.NODE_ENV ?? "").trim().toLowerCase();
  return ["production", "prod", "staging", "stage", "pilot", "uat"].includes(value);
}

function webhookUrlFromEnv(env: EnvLike = process.env) {
  return env.WHISTLE_OTP_PROVIDER_WEBHOOK_URL?.trim() ?? "";
}

function webhookSecretFromEnv(env: EnvLike = process.env) {
  return env.WHISTLE_OTP_PROVIDER_API_KEY?.trim() ?? "";
}

export class MockSmsOtpDeliveryProvider implements OtpDeliveryProvider {
  readonly exposesOtpToApi: boolean;

  constructor(exposesOtpToApi = exposeMockOtpFromEnv()) {
    this.exposesOtpToApi = exposesOtpToApi;
  }

  get mode() {
    return this.exposesOtpToApi ? "mock-sms-exposed" : "mock-sms-hidden";
  }

  async healthCheck() {
    return;
  }

  async deliverOtp(input: {
    challengeId: string;
    phone: string;
    phoneMasked: string;
    phoneHash: string;
    otp: string;
    language: Language;
  }): Promise<OtpDeliveryReceipt> {
    return {
      delivery: "sms_mock",
      deliveryProvider: this.mode,
      providerMessageId: `mock_sms_${input.challengeId}`,
      mockOtp: this.exposesOtpToApi ? input.otp : undefined,
    };
  }
}

export class DisabledOtpDeliveryProvider implements OtpDeliveryProvider {
  readonly mode = "otp-provider-disabled";
  readonly exposesOtpToApi = false;

  async healthCheck() {
    throw new Error("Citizen OTP delivery provider is disabled; configure approved SMS/OTP contracts before launch.");
  }

  async deliverOtp(): Promise<OtpDeliveryReceipt> {
    throw new Error("Citizen OTP delivery provider is disabled.");
  }
}

export class WebhookSmsOtpDeliveryProvider implements OtpDeliveryProvider {
  readonly mode = "sms-webhook-provider";
  readonly exposesOtpToApi = false;

  constructor(private readonly webhookUrl = webhookUrlFromEnv(), private readonly apiKey = webhookSecretFromEnv()) {}

  async healthCheck() {
    if (!this.webhookUrl) throw new Error("WHISTLE_OTP_PROVIDER_WEBHOOK_URL is required for webhook OTP delivery.");
    if (!this.apiKey) throw new Error("WHISTLE_OTP_PROVIDER_API_KEY is required for webhook OTP delivery.");
  }

  async deliverOtp(input: {
    challengeId: string;
    phone: string;
    phoneMasked: string;
    phoneHash: string;
    otp: string;
    language: Language;
  }): Promise<OtpDeliveryReceipt> {
    await this.healthCheck();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          purpose: "citizen_phone_verification",
          challengeId: input.challengeId,
          phone: input.phone,
          phoneMasked: input.phoneMasked,
          phoneHash: input.phoneHash,
          otp: input.otp,
          language: input.language,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`OTP webhook returned ${response.status}`);
      }
      const payload = (await response.json().catch(() => ({}))) as { providerMessageId?: unknown; messageId?: unknown };
      const providerMessageId = String(payload.providerMessageId ?? payload.messageId ?? `sms_webhook_${input.challengeId}`);
      return {
        delivery: "sms_provider",
        deliveryProvider: this.mode,
        providerMessageId,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function otpDeliveryModeFromRuntimeEnv(env: EnvLike = process.env) {
  const mode = otpDeliveryModeFromEnv(env);
  if (mode === "disabled") return "otp-provider-disabled";
  if (mode === "webhook") return "sms-webhook-provider";
  if (deploymentRequiresOtpProvider(env)) return "otp-provider-disabled";
  return exposeMockOtpFromEnv(env) ? "mock-sms-exposed" : "mock-sms-hidden";
}

export function createOtpDeliveryProvider(): OtpDeliveryProvider {
  const mode = otpDeliveryModeFromEnv();
  if (mode === "disabled") return new DisabledOtpDeliveryProvider();
  if (mode === "webhook") return new WebhookSmsOtpDeliveryProvider();
  if (deploymentRequiresOtpProvider()) return new DisabledOtpDeliveryProvider();
  return new MockSmsOtpDeliveryProvider();
}
