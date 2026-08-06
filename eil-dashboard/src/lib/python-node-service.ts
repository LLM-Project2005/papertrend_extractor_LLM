import { getPythonNodeServiceUrl, getWorkerWebhookSecret } from "@/lib/server-env";
import { serviceAuthorizationHeader } from "@/lib/google-service-auth";

export async function callPythonNodeService<TResponse>(
  path: string,
  body: unknown
): Promise<TResponse | null> {
  const baseUrl = getPythonNodeServiceUrl();
  const workerWebhookSecret = getWorkerWebhookSecret();
  if (!baseUrl) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const authorization = await serviceAuthorizationHeader(baseUrl, workerWebhookSecret);
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Python node service failed: ${response.status} ${errorText}`);
    }

    return (await response.json()) as TResponse;
  } finally {
    clearTimeout(timeout);
  }
}
