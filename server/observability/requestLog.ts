import type { FastifyRequest } from "fastify";
import type { AuthRole } from "../auth/policy.js";

export type StructuredRequestLog = {
  event: "http_request_completed" | "http_request_error";
  service: "whistle-ticket-spine";
  correlationId: string;
  requestId: string;
  method: string;
  path: string;
  route: string;
  statusCode?: number;
  durationMs: number;
  role?: AuthRole | "unknown";
  actor?: string;
  remoteAddress?: string;
  errorName?: string;
  errorMessage?: string;
};

export type RequestLogSink = (entry: StructuredRequestLog) => void;

function firstHeader(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function cleanHeader(value: string | undefined) {
  return value?.trim().replace(/[^\w:@.+-]/g, "").slice(0, 120) || undefined;
}

function pathWithoutQuery(url: string) {
  return url.split("?")[0] || "/";
}

function routePattern(request: FastifyRequest) {
  return request.routeOptions.url || pathWithoutQuery(request.url);
}

export function structuredRequestBase(request: FastifyRequest, correlationId: string, startedAt: number) {
  return {
    service: "whistle-ticket-spine" as const,
    correlationId,
    requestId: request.id,
    method: request.method,
    path: pathWithoutQuery(request.url),
    route: routePattern(request),
    durationMs: Math.max(0, Date.now() - startedAt),
    role: cleanHeader(firstHeader(request.headers["x-whistle-role"])) as AuthRole | undefined,
    actor: cleanHeader(firstHeader(request.headers["x-whistle-actor"])),
    remoteAddress: request.ip,
  };
}

export function safeErrorMessage(error: Error) {
  return error.message.replace(/\s+/g, " ").slice(0, 180);
}
