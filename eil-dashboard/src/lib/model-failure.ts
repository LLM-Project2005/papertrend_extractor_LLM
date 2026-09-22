/**
 * What went wrong with a model call, and what the reader should do about it.
 *
 * Every failure produced the same sentence: "The request failed." A reader
 * cannot tell from that whether to wait ten seconds, shorten the question, or
 * tell the owner the account is out of credit - and the three need different
 * actions. The owner could not tell either, which is how this project ran to
 * within twenty cents of an empty balance without anything saying so.
 */

export type FailureKind =
  | "no_credit"
  | "rate_limited"
  | "provider_error"
  | "timeout"
  | "cancelled"
  | "unauthorized"
  | "too_long"
  | "unknown";

export interface FailureAdvice {
  kind: FailureKind;
  /** Shown to the reader. Says what failed and what to do next. */
  message: string;
  /** Whether trying the identical request again could plausibly work. */
  retryable: boolean;
}

const ADVICE: Record<FailureKind, Omit<FailureAdvice, "kind">> = {
  no_credit: {
    message:
      "The language-model account has run out of credit, so no answer can be generated. "
      + "This is an account-level problem rather than anything about your question: top up the "
      + "provider balance and the same question will work.",
    retryable: false,
  },
  rate_limited: {
    message:
      "The language model is rate limiting this project right now. Wait about a minute and ask again; "
      + "the question itself is fine.",
    retryable: true,
  },
  provider_error: {
    message:
      "The language model returned an error. This is usually temporary - ask again in a moment. "
      + "If it keeps happening, the provider is likely having an outage.",
    retryable: true,
  },
  timeout: {
    message:
      "The answer took longer than the time allowed and was stopped. A narrower question, or one "
      + "scoped to a single folder rather than every repository, will usually come back in time.",
    retryable: true,
  },
  cancelled: {
    message: "Stopped at your request. Nothing was saved.",
    retryable: true,
  },
  unauthorized: {
    message:
      "Your session is no longer valid. Sign in again and ask the question once more; nothing was lost.",
    retryable: false,
  },
  too_long: {
    message:
      "There was too much text to send to the model in one request. Narrow the scope to a folder or "
      + "fewer papers and ask again.",
    retryable: false,
  },
  unknown: {
    message:
      "The answer could not be generated. Ask again; if it keeps failing, report the time you asked "
      + "so the request can be traced in the logs.",
    retryable: true,
  },
};

/** Classifies a failure from what the provider actually returned. */
export function classifyFailure(input: {
  status?: number;
  message?: string;
  aborted?: boolean;
}): FailureKind {
  if (input.aborted) return "cancelled";
  const status = input.status ?? 0;
  const message = (input.message ?? "").toLowerCase();

  if (status === 402 || /insufficient|quota|credit|billing|payment/.test(message)) return "no_credit";
  if (status === 429 || /rate.?limit|too many requests/.test(message)) return "rate_limited";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 413 || /context length|too many tokens|maximum context|request too large/.test(message)) {
    return "too_long";
  }
  if (/abort|cancel/.test(message)) return "cancelled";
  if (/timeout|timed out|etimedout|deadline/.test(message)) return "timeout";
  if (status >= 500) return "provider_error";
  if (/fetch failed|econnreset|socket hang up|network/.test(message)) return "provider_error";
  return "unknown";
}

export function adviseOnFailure(input: {
  status?: number;
  message?: string;
  aborted?: boolean;
}): FailureAdvice {
  const kind = classifyFailure(input);
  return { kind, ...ADVICE[kind] };
}

/**
 * Whether a failed call is worth trying once more.
 *
 * Retrying a request that was refused for being malformed, unauthorized, too
 * long, or unpaid just doubles the wait before the same answer. Only failures
 * that are plausibly transient are retried.
 */
export function isTransient(input: { status?: number; message?: string; aborted?: boolean }): boolean {
  const kind = classifyFailure(input);
  return kind === "rate_limited" || kind === "provider_error" || kind === "timeout";
}

/** Milliseconds to wait before the single retry, with a little jitter. */
export function backoffMs(kind: FailureKind, random: number = Math.random()): number {
  // Rate limiting needs longer than a dropped connection: retrying a 429 after
  // 300ms usually earns another 429.
  const base = kind === "rate_limited" ? 2_000 : 600;
  return Math.round(base + random * base * 0.5);
}
