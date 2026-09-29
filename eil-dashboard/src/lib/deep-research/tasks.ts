/*
 * Queues a research run as a Cloud Task that calls back into this service,
 * with a Google-signed identity token the callback checks. A run is one
 * request of a few minutes; Cloud Tasks retries it if the instance dies, and
 * the run resumes from its last finished step.
 */
import { randomUUID } from "node:crypto";
import { taskOidcToken } from "@/lib/cloud-tasks-oidc";
import { getGoogleCloudProjectId, getGoogleCloudRegion } from "@/lib/server-env";

export const RESEARCH_PROCESS_PATH = "/api/chat/research/process";

export function researchQueue(): string {
  return process.env.DEEP_RESEARCH_TASKS_QUEUE || process.env.REPOSITORY_CHAT_TASKS_QUEUE || process.env.CLOUD_TASKS_QUEUE || "";
}

export async function enqueueResearchRun(sessionId: string, ownerUserId: string, callbackBaseUrl: string): Promise<boolean> {
  const project = getGoogleCloudProjectId();
  const location = process.env.CLOUD_TASKS_LOCATION ?? getGoogleCloudRegion();
  // Its own queue: the shared one runs one task at a time, so a run waited
  // behind a paper being analysed or a long chat report - 7 minutes, live.
  const queue = researchQueue();
  if (!project || !queue || !callbackBaseUrl) return false;
  const oidcToken = await taskOidcToken();
  if (!oidcToken) return false;
  const tokenResponse = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
    headers: { "Metadata-Flavor": "Google" },
  }).catch(() => null);
  if (!tokenResponse?.ok) return false;
  const { access_token: accessToken } = (await tokenResponse.json()) as { access_token?: string };
  if (!accessToken) return false;
  const response = await fetch(`https://cloudtasks.googleapis.com/v2/projects/${project}/locations/${location}/queues/${queue}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      task: {
        // Unique per call: a stalled run can be queued again, and the lease
        // makes sure only one worker runs it.
        name: `projects/${project}/locations/${location}/queues/${queue}/tasks/deep-research-${sessionId}-${randomUUID().slice(0, 8)}`,
        httpRequest: {
          httpMethod: "POST",
          url: `${callbackBaseUrl.replace(/\/$/, "")}${RESEARCH_PROCESS_PATH}`,
          headers: { "Content-Type": "application/json" },
          oidcToken,
          body: Buffer.from(JSON.stringify({ sessionId, ownerUserId })).toString("base64"),
        },
        dispatchDeadline: "1200s",
      },
    }),
  }).catch(() => null);
  return Boolean(response && (response.ok || response.status === 409));
}
