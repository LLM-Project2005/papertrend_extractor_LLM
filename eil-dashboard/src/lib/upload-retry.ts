const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

class PermanentUploadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Storage refused the upload outright (a 4xx other than 408 and 429): retrying the same URL won't help. */
export class UploadRefusedError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "UploadRefusedError";
  }
}

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
        throw new PermanentUploadError(message, response.status);
      }
      lastError = new Error(message);
    } catch (error) {
      if (error instanceof PermanentUploadError) {
        throw new UploadRefusedError(error.message, error.status);
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

/** A signed upload URL lasts 15 minutes; one older than this is renewed before use. */
export const UPLOAD_URL_RENEW_AFTER_MS = 12 * 60_000;

export interface SignedUpload {
  signedUrl: string;
  uploadHeaders?: Record<string, string>;
  /** When the URL was signed, in the browser's clock. */
  signedAt: number;
}

/**
 * Uploads with a URL that is still good (docs/32, 4.5; audit LIB-8). A large
 * batch uploads one file after another, and the last files' URLs, all signed
 * at the start, could expire before their turn: storage then refused them and
 * they had to be added again by hand. A URL near its expiry is renewed first,
 * and one storage refuses (an expired signature is a 400 or 403) is renewed
 * once and tried again.
 */
export async function putWithFreshUrl(
  target: SignedUpload,
  body: Blob,
  headers: (upload: SignedUpload) => Record<string, string>,
  renew: () => Promise<Omit<SignedUpload, "signedAt">>,
  options: { now?: () => number; put?: typeof putFileWithRetry } = {}
): Promise<SignedUpload> {
  const now = options.now ?? Date.now;
  const put = options.put ?? putFileWithRetry;
  let current = target;
  let renewed = false;
  if (now() - current.signedAt > UPLOAD_URL_RENEW_AFTER_MS) {
    current = { ...(await renew()), signedAt: now() };
    renewed = true;
  }
  try {
    await put(current.signedUrl, body, headers(current));
    return current;
  } catch (error) {
    const expired = error instanceof UploadRefusedError && [400, 401, 403].includes(error.status);
    if (!expired || renewed) throw error;
    current = { ...(await renew()), signedAt: now() };
    await put(current.signedUrl, body, headers(current));
    return current;
  }
}
