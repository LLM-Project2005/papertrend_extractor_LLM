/**
 * What a failed profile check means for the person signed in (docs/32, 2.1).
 *
 * The profile is checked again every time Firebase refreshes the sign-in token,
 * about once an hour. A network blip or a server error during that check used
 * to sign the person out and show the server's internal message. Only a
 * definite refusal should do that: the token was rejected (401), or the account
 * is not allowed in (403, with or without a reason). Everything else — no
 * network, a timeout, a 5xx — keeps them signed in and tries again quietly.
 */

export type ProfileFailureKind = "signed_out" | "transient";

/** Reasons the server gives with a 403; each comes with wording meant for the reader. */
export const PROFILE_REFUSAL_CODES = [
  "email_unverified",
  "email_in_use",
  "invite_required",
  "not_linked",
  "pilot_restricted",
] as const;
export type ProfileRefusalCode = (typeof PROFILE_REFUSAL_CODES)[number];

export function isProfileRefusalCode(code: unknown): code is ProfileRefusalCode {
  return typeof code === "string" && (PROFILE_REFUSAL_CODES as readonly string[]).includes(code);
}

export function classifyProfileFailure(status: number | "network"): ProfileFailureKind {
  return status === 401 || status === 403 ? "signed_out" : "transient";
}

/** Waits between quiet retries; after the last, the next token refresh tries again. */
export const PROFILE_RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000] as const;

/** A profile check gives up waiting after this long and counts as a network failure. */
export const PROFILE_CHECK_TIMEOUT_MS = 15_000;

export const PROFILE_UNREACHABLE_MESSAGE = "Papertrend can't be reached right now. Trying again…";
export const PROFILE_GAVE_UP_MESSAGE = "Papertrend can't be reached right now. Check your connection, then reload the page.";
export const SESSION_ENDED_MESSAGE = "Your sign-in has ended. Please sign in again.";
export const NOT_LINKED_MESSAGE = "This sign-in isn't linked to a Papertrend account.";

/**
 * The message to show for a definite refusal. The server's own text is shown
 * only for the known reasons, whose wording is written for readers; anything
 * else could be an internal error message.
 */
export function refusalMessage(status: number, code: unknown, serverMessage: unknown): string {
  if (isProfileRefusalCode(code) && typeof serverMessage === "string" && serverMessage.trim()) return serverMessage;
  return status === 401 ? SESSION_ENDED_MESSAGE : NOT_LINKED_MESSAGE;
}
