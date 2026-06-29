import { pathToFileURL } from "node:url";

export type WorkerJobName = "sla" | "evidence" | "notifications";

export type WorkerRunnerOptions = {
  apiBaseUrl: string;
  token?: string;
  actor: string;
  jobs: WorkerJobName[];
  batchLimit: number;
  maxPasses: number;
  now?: string;
  dryRun?: boolean;
};

export type WorkerRunnerPass = {
  pass: number;
  statusCode: number;
  hasMore: boolean;
  result: Record<string, unknown>;
};

export type WorkerRunnerJobSummary = {
  job: WorkerJobName;
  endpoint: string;
  passes: WorkerRunnerPass[];
};

export type WorkerRunnerSummary = {
  dryRun: boolean;
  apiBaseUrl: string;
  actor: string;
  batchLimit: number;
  maxPasses: number;
  jobs: WorkerRunnerJobSummary[];
};

const jobEndpoints: Record<WorkerJobName, string> = {
  sla: "/api/jobs/sla-escalations/run",
  evidence: "/api/jobs/evidence-scans/run",
  notifications: "/api/jobs/notifications/run",
};

function envValue(name: string, fallback: string) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function numberFromEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function jobsFromEnv() {
  const raw = envValue("WHISTLE_WORKER_JOBS", "sla,evidence,notifications");
  const values = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const jobs = values.filter((item): item is WorkerJobName => item === "sla" || item === "evidence" || item === "notifications");
  if (!jobs.length) throw new Error("WHISTLE_WORKER_JOBS must include one of: sla, evidence, notifications.");
  return jobs;
}

function tokenFromEnv() {
  return process.env.WHISTLE_WORKER_SHARED_SECRET?.trim() || process.env.WHISTLE_WORKER_TOKEN?.trim() || "";
}

export function workerRunnerOptionsFromEnv(): WorkerRunnerOptions {
  return {
    apiBaseUrl: envValue("WHISTLE_API_BASE_URL", "http://127.0.0.1:3001"),
    token: tokenFromEnv(),
    actor: envValue("WHISTLE_WORKER_ACTOR", "worker:prototype"),
    jobs: jobsFromEnv(),
    batchLimit: Math.min(numberFromEnv("WHISTLE_WORKER_BATCH_LIMIT", 100), 500),
    maxPasses: Math.min(numberFromEnv("WHISTLE_WORKER_MAX_PASSES", 3), 100),
    now: process.env.WHISTLE_WORKER_NOW?.trim(),
    dryRun: process.env.WHISTLE_WORKER_DRY_RUN === "true",
  };
}

function bodyFor(job: WorkerJobName, options: WorkerRunnerOptions) {
  const body: Record<string, unknown> = {
    actor: options.actor,
    limit: options.batchLimit,
  };
  if (job === "sla" && options.now) body.now = options.now;
  return body;
}

function resultHasMore(result: Record<string, unknown>) {
  return result.hasMore === true;
}

async function callWorkerJob(job: WorkerJobName, options: WorkerRunnerOptions) {
  const endpoint = jobEndpoints[job];
  const response = await fetch(new URL(endpoint, options.apiBaseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-whistle-role": "worker",
      "x-whistle-actor": options.actor,
      authorization: `Bearer ${options.token}`,
    },
    body: JSON.stringify(bodyFor(job, options)),
  });
  const payload = (await response.json().catch(() => ({}))) as { result?: Record<string, unknown>; error?: string; message?: string };
  if (!response.ok) {
    const detail = payload.message || payload.error || response.statusText;
    throw new Error(`${job} worker job failed with ${response.status}: ${detail}`);
  }
  return {
    statusCode: response.status,
    result: payload.result ?? {},
  };
}

export async function runWorkerJobs(options: WorkerRunnerOptions): Promise<WorkerRunnerSummary> {
  if (!options.dryRun && !options.token) {
    throw new Error("WHISTLE_WORKER_SHARED_SECRET or WHISTLE_WORKER_TOKEN is required to run worker jobs.");
  }

  const summary: WorkerRunnerSummary = {
    dryRun: options.dryRun === true,
    apiBaseUrl: options.apiBaseUrl,
    actor: options.actor,
    batchLimit: options.batchLimit,
    maxPasses: options.maxPasses,
    jobs: [],
  };

  for (const job of options.jobs) {
    const jobSummary: WorkerRunnerJobSummary = {
      job,
      endpoint: jobEndpoints[job],
      passes: [],
    };
    summary.jobs.push(jobSummary);

    if (options.dryRun) continue;

    for (let pass = 1; pass <= options.maxPasses; pass += 1) {
      const result = await callWorkerJob(job, options);
      const hasMore = resultHasMore(result.result);
      jobSummary.passes.push({
        pass,
        statusCode: result.statusCode,
        hasMore,
        result: result.result,
      });
      if (!hasMore) break;
    }
  }

  return summary;
}

async function main() {
  const summary = await runWorkerJobs(workerRunnerOptionsFromEnv());
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
