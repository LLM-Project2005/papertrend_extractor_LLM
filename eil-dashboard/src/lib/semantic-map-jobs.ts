import { getGoogleCloudProjectId, getGoogleCloudRegion, getWorkerWebhookSecret } from "@/lib/server-env";

export async function enqueueSemanticMapJob(mapId: string, ownerUserId: string, callbackBaseUrl: string): Promise<boolean> {
  const project = getGoogleCloudProjectId();
  const location = process.env.CLOUD_TASKS_LOCATION ?? getGoogleCloudRegion();
  const queue = process.env.SEMANTIC_MAP_TASKS_QUEUE ?? process.env.REPOSITORY_CHAT_TASKS_QUEUE ?? process.env.CLOUD_TASKS_QUEUE ?? "";
  if (!project || !queue || !callbackBaseUrl) return false;
  const tokenResponse = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!tokenResponse.ok) return false;
  const { access_token: accessToken } = await tokenResponse.json() as { access_token?: string };
  if (!accessToken) return false;
  const response = await fetch(`https://cloudtasks.googleapis.com/v2/projects/${project}/locations/${location}/queues/${queue}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ task: { httpRequest: {
      httpMethod: "POST",
      url: `${callbackBaseUrl.replace(/\/$/, "")}/api/workspace/semantic-map/jobs/process`,
      headers: { "Content-Type": "application/json", "x-worker-secret": getWorkerWebhookSecret() },
      body: Buffer.from(JSON.stringify({ mapId, ownerUserId })).toString("base64"),
    } } }),
  });
  return response.ok;
}
