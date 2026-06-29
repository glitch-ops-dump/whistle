import { AsyncLocalStorage } from "node:async_hooks";

type CorrelationContext = {
  correlationId: string;
};

const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

function cleanCorrelationId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 120);
}

export function resolveCorrelationId(incoming: unknown, fallback: string) {
  const raw = Array.isArray(incoming) ? incoming[0] : incoming;
  if (typeof raw === "string") {
    const cleaned = cleanCorrelationId(raw);
    if (cleaned) return cleaned;
  }
  return cleanCorrelationId(fallback) || `req-${Date.now().toString(36)}`;
}

export function enterCorrelationContext(correlationId: string) {
  correlationStorage.enterWith({ correlationId });
}

export function currentCorrelationId() {
  return correlationStorage.getStore()?.correlationId;
}
