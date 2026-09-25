const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

class PermanentUploadError extends Error {}

type Sleep = (milliseconds: number) => Promise<void>;

const defaultSleep: Sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * PUT a file to a signed storage URL, retrying a dropped connection or a
 * server error. A browser upload that loses its connection once used to fail
 * the paper outright ("Failed to fetch").
 *
 * A signed GCS upload is safe to repeat: it only overwrites the same object.
 * A 409 on a retry means an earlier attempt already stored the file.
 */
export async function putFileWithRetry(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  options: { attempts?: number; baseDelayMs?: number; sleep?: Sleep; fetchImpl?: typeof fetch } = {}
): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  const fetchImpl = options.fetchImpl ?? fetch;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { method: "PUT", headers, body });
      if (response.ok || (attempt > 1 && response.status === 409)) {
        return;
      }
      const text = await response.text().catch(() => "");
      const message =
        text || `Storage upload failed with status ${response.status} ${response.statusText}.`;
      const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
      if (!retryable) {
        throw new PermanentUploadError(message);
      }
      lastError = new Error(message);
    } catch (error) {
      if (error instanceof PermanentUploadError) {
        throw new Error(error.message);
      }
      lastError = error;
    }
    if (attempt < attempts) {
      await sleep(baseDelayMs * 3 ** (attempt - 1));
    }
  }

  const reason = lastError instanceof Error ? lastError.message : "Failed to upload file to storage.";
  throw new Error(`${reason} (after ${attempts} attempts)`);
}
