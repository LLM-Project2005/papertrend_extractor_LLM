import { getPythonNodeServiceUrl } from "@/lib/server-env";

export async function callPythonNodeService<TResponse>(
  path: string,
  body: unknown
): Promise<TResponse | null> {
  const baseUrl = getPythonNodeServiceUrl();
  if (!baseUrl) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
