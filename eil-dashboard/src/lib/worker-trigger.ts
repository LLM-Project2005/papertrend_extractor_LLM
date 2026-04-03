import {
  getWorkerServiceUrl,
  getWorkerWebhookSecret,
} from "@/lib/server-env";

async function triggerWorkerEndpoint(
  path: string,
  options?: {
    maxRuns?: number;
    reason?: string;
  }
): Promise<{ started: boolean; status: number; payload: Record<string, unknown> }> {
  const workerServiceUrl = getWorkerServiceUrl();
  const workerWebhookSecret = getWorkerWebhookSecret();

  if (!workerServiceUrl || !workerWebhookSecret) {
    return { started: false, status: 0, payload: { skipped: true, reason: "missing_worker_config" } };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(`${workerServiceUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerWebhookSecret}`,
      },
      body: JSON.stringify({
        async: true,
        maxRuns: Math.min(Math.max(options?.maxRuns ?? 1, 1), 5),
        reason: options?.reason ?? "api-trigger",
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      started: response.ok,
      status: response.status,
      payload,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function triggerWorkerQueue(options?: {
  maxRuns?: number;
  reason?: string;
}): Promise<{ started: boolean; status: number; payload: Record<string, unknown> }> {
  return triggerWorkerEndpoint("/process-queue", options);
}

export async function triggerResearchQueue(options?: {
  maxRuns?: number;
  reason?: string;
}): Promise<{ started: boolean; status: number; payload: Record<string, unknown> }> {
  return triggerWorkerEndpoint("/process-research-queue", options);
}
