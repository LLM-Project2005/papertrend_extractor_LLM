/**
 * Lets a reader stop an answer that is already running.
 *
 * Carrying the browser's disconnect through `request.signal`, and listening for
 * the response stream being cancelled, both work on a plain Node server and
 * neither fires behind the Cloud Run proxy. Measured on the pilot: a reader that
 * disconnected 0.6 seconds into a question still had all five model calls run to
 * completion, 25.0 seconds of model time, with the request never observing the
 * disconnect. Stop cleared the screen and the bill kept going.
 *
 * So Stop sends an explicit message instead of relying on transport semantics. A
 * request registers itself under an id the client chose, and a later call to the
 * cancel route aborts it by that id.
 *
 * Known limit: the registry lives in one container's memory, so a cancel only
 * reaches the request when both land on the same instance. At this project's
 * traffic there is usually one instance, and the failure mode when there is not
 * is the previous behaviour - the answer finishes unread - rather than anything
 * worse. Making it exact would need shared state, which is not worth a
 * round trip on every cancel at this scale.
 */

interface LiveRequest {
  controller: AbortController;
  expiresAt: number;
}

/** Long enough to cover the slowest answer, short enough to not leak. */
const ENTRY_TTL_MS = 5 * 60_000;

/** A runaway client cannot pin unbounded memory by never finishing requests. */
const MAX_ENTRIES = 500;

const live = new Map<string, LiveRequest>();

function key(userId: string, requestId: string): string {
  return `${userId}:${requestId}`;
}

function evictExpired(now: number): void {
  for (const [entryKey, entry] of live) {
    if (entry.expiresAt <= now) live.delete(entryKey);
  }
}

/** Ids are echoed in errors and used as map keys, so they stay simple and short. */
export function isValidRequestId(requestId: unknown): requestId is string {
  return typeof requestId === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(requestId);
}

/**
 * Registers a running request, returning the function that removes it.
 *
 * Always call the returned function in a `finally`, or a cancelled-but-finished
 * request stays in the map until its TTL.
 */
export function registerCancellable(
  userId: string,
  requestId: string,
  controller: AbortController,
  now: number = Date.now()
): () => void {
  evictExpired(now);
  if (live.size >= MAX_ENTRIES) {
    // Drop the oldest rather than refuse the request: losing the ability to
    // cancel is a far smaller harm than losing the answer.
    const oldest = [...live.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (oldest) live.delete(oldest[0]);
  }
  const entryKey = key(userId, requestId);
  live.set(entryKey, { controller, expiresAt: now + ENTRY_TTL_MS });
  return () => {
    live.delete(entryKey);
  };
}

/**
 * Aborts a running request owned by this user.
 *
 * Returns false when there is nothing to cancel, which is the ordinary result
 * for an answer that already finished, and is not an error worth showing.
 */
export function cancelRequest(userId: string, requestId: string, now: number = Date.now()): boolean {
  evictExpired(now);
  const entry = live.get(key(userId, requestId));
  if (!entry) return false;
  entry.controller.abort();
  live.delete(key(userId, requestId));
  return true;
}

/** Test seam: the number of requests currently cancellable. */
export function liveRequestCount(now: number = Date.now()): number {
  evictExpired(now);
  return live.size;
}

/** Test seam: forget everything, so one test cannot see another's requests. */
export function resetCancelRegistry(): void {
  live.clear();
}
