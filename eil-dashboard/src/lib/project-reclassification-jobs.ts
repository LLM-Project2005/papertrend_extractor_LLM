import { getGoogleCloudProjectId, getGoogleCloudRegion, getWorkerWebhookSecret } from "@/lib/server-env";

export async function enqueueProjectReclassificationJob(jobId: string, ownerUserId: string, callbackBaseUrl: string): Promise<boolean> {
  const project = getGoogleCloudProjectId();
  const location = process.env.CLOUD_TASKS_LOCATION ?? getGoogleCloudRegion();
  const queue = process.env.RECLASSIFICATION_TASKS_QUEUE ?? process.env.REPOSITORY_CHAT_TASKS_QUEUE ?? process.env.CLOUD_TASKS_QUEUE ?? "";
  if (!project || !queue || !callbackBaseUrl) return false;
  const tokenResponse = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
  if (!tokenResponse.ok) return false;
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) return false;
  const response = await fetch(`https://cloudtasks.googleapis.com/v2/projects/${project}/locations/${location}/queues/${queue}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.access_token}` },
    body: JSON.stringify({ task: { httpRequest: {
      httpMethod: "POST",
      url: `${callbackBaseUrl.replace(/\/$/, "")}/api/workspace/projects/reclassify/process`,
      headers: { "Content-Type": "application/json", "x-worker-secret": getWorkerWebhookSecret() },
      body: Buffer.from(JSON.stringify({ jobId, ownerUserId })).toString("base64"),
    } } }),
  });
  return response.ok;
}
