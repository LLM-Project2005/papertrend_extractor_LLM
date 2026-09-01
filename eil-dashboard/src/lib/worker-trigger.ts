import {
  getWorkerServiceUrl,
  getWorkerWebhookSecret,
} from "@/lib/server-env";

type TriggerResult = {
  started: boolean;
  status: number;
  payload: Record<string, unknown>;
};

const WORKER_REQUEST_TIMEOUT_MS = 20_000;

let cachedIdentityToken: { audience: string; token: string; expiresAt: number } | null = null;

async function getWorkerAuthorization(workerServiceUrl: string): Promise<string> {
  const now = Date.now();
  if (
    cachedIdentityToken?.audience === workerServiceUrl &&
    cachedIdentityToken.expiresAt > now + 60_000
  ) {
    return `Bearer ${cachedIdentityToken.token}`;
  }

  if (process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT_ID) {
    try {
      const endpoint =
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity" +
        `?audience=${encodeURIComponent(workerServiceUrl)}&format=full`;
      const response = await fetch(endpoint, {
        headers: { "Metadata-Flavor": "Google" },
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const token = (await response.text()).trim();
        if (token) {
          const payload = token.split(".")[1];
          let expiresAt = now + 45 * 60_000;
          if (payload) {
            const decoded = JSON.parse(
              Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
            ) as { exp?: number };
            if (decoded.exp) expiresAt = decoded.exp * 1_000;
          }
          cachedIdentityToken = { audience: workerServiceUrl, token, expiresAt };
          return `Bearer ${token}`;
        }
      }
    } catch (error) {
      console.warn("Cloud Run worker identity token was unavailable; using webhook authentication.", {
        message: error instanceof Error ? error.message : "Unknown metadata error",
      });
    }
  }

  const webhookSecret = getWorkerWebhookSecret();
  return webhookSecret ? `Bearer ${webhookSecret}` : "";
}

async function postWorker(
  path: string,
  body: Record<string, unknown>
): Promise<{ status: number; ok: boolean; payload: Record<string, unknown> }> {
  const workerServiceUrl = getWorkerServiceUrl();
  if (!workerServiceUrl) {
    return { status: 0, ok: false, payload: { skipped: true, reason: "missing_worker_config" } };
  }
  const authorization = await getWorkerAuthorization(workerServiceUrl);
  if (!authorization) {
    return { status: 0, ok: false, payload: { skipped: true, reason: "missing_worker_auth" } };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${workerServiceUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authorization },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    return {
      status: response.status,
      ok: response.ok,
      payload: (await response.json().catch(() => ({}))) as Record<string, unknown>,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      status: 0,
      ok: false,
      payload: {
        reason: timedOut ? "worker_request_timeout" : "worker_request_failed",
        message: error instanceof Error ? error.message : "Unknown worker request error",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function triggerWorkerEndpoint(
  path: string,
  options?: { maxRuns?: number; reason?: string; force?: boolean }
): Promise<TriggerResult> {
  const response = await postWorker(path, {
    async: true,
    maxRuns: Math.min(Math.max(options?.maxRuns ?? 1, 1), 5),
    reason: options?.reason ?? "api-trigger",
    force: Boolean(options?.force),
  });
  return {
    started: response.ok && response.payload.queued !== false,
    status: response.status,
    payload: response.payload,
  };
}

export async function enqueueWorkerQueueTasks(options?: {
  taskCount?: number;
  maxRuns?: number;
  reason?: string;
  force?: boolean;
}): Promise<TriggerResult> {
  const response = await postWorker("/enqueue-ingestion-tasks", {
    taskCount: Math.min(Math.max(options?.taskCount ?? 1, 1), 50),
    maxRuns: Math.min(Math.max(options?.maxRuns ?? 1, 1), 5),
    reason: options?.reason ?? "api-cloud-task-trigger",
    force: Boolean(options?.force),
  });
  return {
    started: response.ok && response.payload.enqueued === true,
    status: response.status,
    payload: { ...response.payload, trigger_kind: "cloud_tasks" },
  };
}

export function triggerWorkerQueue(options?: {
  maxRuns?: number;
  reason?: string;
  force?: boolean;
}): Promise<TriggerResult> {
  return triggerWorkerEndpoint("/process-queue", options);
}

export function triggerResearchQueue(options?: {
  maxRuns?: number;
  reason?: string;
  force?: boolean;
}): Promise<TriggerResult> {
  return triggerWorkerEndpoint("/process-research-queue", options);
}

export async function resetWorkerQueueLock(): Promise<{
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
}> {
  const response = await postWorker("/debug/reset-queue-lock", {});
  return { ok: response.ok, status: response.status, payload: response.payload };
}
