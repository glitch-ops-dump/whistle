import type { NotificationIntent, NotificationStatus } from "../ticket-spine/types.js";

type EnvLike = Record<string, string | undefined>;

export type NotificationDeliveryResult = {
  status: Extract<NotificationStatus, "sent" | "failed" | "suppressed">;
  provider: string;
  reason: string;
  providerMessageId?: string;
  lastError?: string;
};

export type NotificationDeliveryProvider = {
  readonly mode: string;
  healthCheck(): Promise<void>;
  deliver(notification: NotificationIntent): Promise<NotificationDeliveryResult>;
};

export class MockNotificationDeliveryProvider implements NotificationDeliveryProvider {
  readonly mode = "mvp-mock-notification-provider";

  async healthCheck() {
    return;
  }

  async deliver() {
    return {
      status: "sent" as const,
      provider: "mvp-mock",
      providerMessageId: "mvp-mock-delivery",
      reason: "Delivered by MVP mock notification provider.",
    };
  }
}

export class DisabledNotificationDeliveryProvider implements NotificationDeliveryProvider {
  readonly mode = "notification-provider-disabled";

  async healthCheck() {
    throw new Error("Notification delivery provider is disabled; configure approved SMS/WhatsApp contracts before production launch.");
  }

  async deliver(notification: NotificationIntent) {
    const channelLabel = notification.channel.replace("_", " ");
    return {
      status: "failed" as const,
      provider: "disabled",
      reason: `No ${channelLabel} notification provider is configured.`,
      providerMessageId: undefined,
      lastError: "notification_provider_disabled",
    };
  }
}

function modeFromEnv(env: EnvLike = process.env) {
  return env.WHISTLE_NOTIFICATION_PROVIDER_MODE?.trim().toLowerCase() ?? "";
}

function deploymentRequiresNotificationProvider(env: EnvLike = process.env) {
  const value = (env.WHISTLE_DEPLOYMENT_PROFILE ?? env.WHISTLE_ENV ?? env.NODE_ENV ?? "").trim().toLowerCase();
  return ["production", "prod", "staging", "stage", "pilot", "uat"].includes(value);
}

function webhookUrlFromEnv(env: EnvLike = process.env) {
  return env.WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL?.trim() ?? "";
}

function webhookApiKeyFromEnv(env: EnvLike = process.env) {
  return env.WHISTLE_NOTIFICATION_PROVIDER_API_KEY?.trim() ?? "";
}

function isDeliveryStatus(value: unknown): value is NotificationDeliveryResult["status"] {
  return value === "sent" || value === "failed" || value === "suppressed";
}

export class WebhookNotificationDeliveryProvider implements NotificationDeliveryProvider {
  readonly mode = "notification-webhook-provider";

  constructor(private readonly webhookUrl = webhookUrlFromEnv(), private readonly apiKey = webhookApiKeyFromEnv()) {}

  async healthCheck() {
    if (!this.webhookUrl) throw new Error("WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL is required for webhook notification delivery.");
    if (!this.apiKey) throw new Error("WHISTLE_NOTIFICATION_PROVIDER_API_KEY is required for webhook notification delivery.");
  }

  async deliver(notification: NotificationIntent): Promise<NotificationDeliveryResult> {
    if (notification.channel === "in_app") {
      return {
        status: "sent",
        provider: "in-app",
        providerMessageId: `in_app_${notification.id}`,
        reason: "Delivered through Whistle in-app notification inbox.",
      };
    }
    try {
      await this.healthCheck();
    } catch (error) {
      return {
        status: "failed",
        provider: this.mode,
        reason: "Notification webhook provider is misconfigured.",
        lastError: error instanceof Error ? error.message : String(error),
      };
    }

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
          notificationId: notification.id,
          ticketId: notification.ticketId,
          channel: notification.channel,
          topic: notification.topic,
          language: notification.language,
          recipientMasked: notification.recipientMasked,
          safeMessage: notification.safeMessage,
          sensitive: notification.sensitive,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          status: "failed",
          provider: this.mode,
          reason: `Notification webhook returned ${response.status}.`,
          lastError: `notification_webhook_${response.status}`,
        };
      }
      const payload = (await response.json().catch(() => ({}))) as {
        providerMessageId?: unknown;
        messageId?: unknown;
        status?: unknown;
        reason?: unknown;
        error?: unknown;
      };
      const status = isDeliveryStatus(payload.status) ? payload.status : "sent";
      const providerMessageId = String(payload.providerMessageId ?? payload.messageId ?? `${notification.channel}_${notification.id}`);
      return {
        status,
        provider: this.mode,
        providerMessageId,
        reason: typeof payload.reason === "string" ? payload.reason : `Webhook ${notification.channel} notification ${status}.`,
        lastError: status === "failed" ? String(payload.error ?? "notification_webhook_failed") : undefined,
      };
    } catch (error) {
      return {
        status: "failed",
        provider: this.mode,
        reason: "Notification webhook delivery failed.",
        lastError: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function notificationDeliveryModeFromRuntimeEnv(env: EnvLike = process.env) {
  const mode = modeFromEnv(env);
  if (mode === "disabled") return "notification-provider-disabled";
  if (mode === "webhook") return "notification-webhook-provider";
  if (deploymentRequiresNotificationProvider(env)) return "notification-provider-disabled";
  return "mvp-mock-notification-provider";
}

export function createNotificationDeliveryProvider(): NotificationDeliveryProvider {
  const mode = modeFromEnv();
  if (mode === "disabled") return new DisabledNotificationDeliveryProvider();
  if (mode === "webhook") return new WebhookNotificationDeliveryProvider();
  if (deploymentRequiresNotificationProvider()) return new DisabledNotificationDeliveryProvider();
  return new MockNotificationDeliveryProvider();
}
