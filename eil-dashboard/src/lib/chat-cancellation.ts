import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Propagates the browser's disconnect to the model calls made for it.
 *
 * The chat route never read `request.signal`, so pressing Stop aborted the
 * browser's fetch while the server carried on issuing model calls to the end.
 * Nobody saw the answer and the tokens were still paid for. Carrying the signal
 * through the async context reaches every call without changing the signature of
 * each function between the route and the model layer.
 */
const storage = new AsyncLocalStorage<AbortSignal>();

export function runWithCancellation<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  return storage.run(signal, fn);
}

/** The caller's abort signal, when one is in scope. */
export function cancellationSignal(): AbortSignal | undefined {
  return storage.getStore();
}

/** True once the caller has gone away. */
export function isCancelled(): boolean {
  return storage.getStore()?.aborted ?? false;
}

/** Thrown when work stops because the caller disconnected. */
export class ChatCancelledError extends Error {
  constructor() {
    super("The request was cancelled.");
    this.name = "ChatCancelledError";
  }
}

/** Stops at a safe point between steps rather than starting more work. */
export function throwIfCancelled(): void {
  if (isCancelled()) throw new ChatCancelledError();
}

/**
 * Combines the caller's signal with an optional timeout.
 *
 * Both matter: a request should stop when the reader leaves and when it has
 * taken too long, and whichever happens first should win.
 */
export function requestSignal(timeoutMs?: number): AbortSignal | undefined {
  const caller = cancellationSignal();
  const timeout =
    typeof timeoutMs === "number" ? AbortSignal.timeout(Math.max(1_000, timeoutMs)) : undefined;
  if (caller && timeout) return AbortSignal.any([caller, timeout]);
  return caller ?? timeout;
}
