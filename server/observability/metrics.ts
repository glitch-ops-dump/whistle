import type { StructuredRequestLog } from "./requestLog.js";

export type RouteMetrics = {
  route: string;
  method: string;
  requests: number;
  errorResponses: number;
  statusCodes: Record<string, number>;
  latencyMs: {
    min: number;
    max: number;
    avg: number;
    p95: number;
  };
  buckets: Record<string, number>;
};

export type HttpMetricsSnapshot = {
  service: "whistle-ticket-spine";
  generatedAt: string;
  startedAt: string;
  uptimeMs: number;
  requests: number;
  errorResponses: number;
  statusCodes: Record<string, number>;
  routes: RouteMetrics[];
};

const latencyBuckets = [50, 100, 300, 500, 800, 1_000, 2_000, 5_000] as const;

type RouteAccumulator = {
  route: string;
  method: string;
  requests: number;
  errorResponses: number;
  statusCodes: Map<number, number>;
  durations: number[];
  buckets: Map<string, number>;
};

function increment<Key>(map: Map<Key, number>, key: Key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function bucketFor(durationMs: number) {
  const bucket = latencyBuckets.find((limit) => durationMs <= limit);
  return bucket ? `le_${bucket}ms` : "gt_5000ms";
}

function percentile(sortedValues: number[], percentileValue: number) {
  if (!sortedValues.length) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * percentileValue) - 1);
  return sortedValues[index];
}

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

function objectFromNumberMap(map: Map<number, number>) {
  return Object.fromEntries([...map.entries()].map(([key, value]) => [String(key), value]));
}

function objectFromStringMap(map: Map<string, number>) {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

export class InMemoryHttpMetrics {
  private readonly startedAt = new Date();
  private requests = 0;
  private errorResponses = 0;
  private readonly statusCodes = new Map<number, number>();
  private readonly routes = new Map<string, RouteAccumulator>();

  observe(entry: StructuredRequestLog) {
    const statusCode = entry.statusCode ?? 500;
    const durationMs = Math.max(0, entry.durationMs);
    const routeKey = `${entry.method} ${entry.route}`;
    const route =
      this.routes.get(routeKey) ??
      {
        route: entry.route,
        method: entry.method,
        requests: 0,
        errorResponses: 0,
        statusCodes: new Map<number, number>(),
        durations: [],
        buckets: new Map<string, number>(),
      };

    this.requests += 1;
    route.requests += 1;
    if (statusCode >= 500) {
      this.errorResponses += 1;
      route.errorResponses += 1;
    }
    increment(this.statusCodes, statusCode);
    increment(route.statusCodes, statusCode);
    route.durations.push(durationMs);
    increment(route.buckets, bucketFor(durationMs));
    this.routes.set(routeKey, route);
  }

  snapshot(): HttpMetricsSnapshot {
    return {
      service: "whistle-ticket-spine",
      generatedAt: new Date().toISOString(),
      startedAt: this.startedAt.toISOString(),
      uptimeMs: Date.now() - this.startedAt.getTime(),
      requests: this.requests,
      errorResponses: this.errorResponses,
      statusCodes: objectFromNumberMap(this.statusCodes),
      routes: [...this.routes.values()]
        .map((route) => routeSnapshot(route))
        .sort((left, right) => right.requests - left.requests || `${left.method} ${left.route}`.localeCompare(`${right.method} ${right.route}`)),
    };
  }
}

function routeSnapshot(route: RouteAccumulator): RouteMetrics {
  const sortedDurations = [...route.durations].sort((left, right) => left - right);
  const totalDuration = route.durations.reduce((sum, value) => sum + value, 0);
  return {
    route: route.route,
    method: route.method,
    requests: route.requests,
    errorResponses: route.errorResponses,
    statusCodes: objectFromNumberMap(route.statusCodes),
    latencyMs: {
      min: rounded(sortedDurations[0] ?? 0),
      max: rounded(sortedDurations[sortedDurations.length - 1] ?? 0),
      avg: rounded(route.requests ? totalDuration / route.requests : 0),
      p95: rounded(percentile(sortedDurations, 0.95)),
    },
    buckets: objectFromStringMap(route.buckets),
  };
}
