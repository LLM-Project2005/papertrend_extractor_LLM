/*
 * Sign-in errors in plain words.
 *
 * Firebase rejects a sign-in with a code (auth/too-many-requests,
 * auth/invalid-credential, ...) and a technical message such as
 * "Firebase: Error (auth/invalid-credential)." The sign-in page showed that
 * message as it came. Each code a reader can meet gets a sentence saying what
 * happened and what to do.
 *
 * Repeated failed attempts are throttled by Firebase itself; this is where
 * the reader learns that they have hit that limit.
 */

/** The shortest password a new account may choose (also enforced by Firebase). */
export const MIN_NEW_PASSWORD_LENGTH = 10;

const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "That email and password do not match. Try again, or reset your password.",
  "auth/wrong-password": "That email and password do not match. Try again, or reset your password.",
  "auth/user-not-found": "That email and password do not match. Try again, or reset your password.",
  "auth/invalid-login-credentials": "That email and password do not match. Try again, or reset your password.",
  "auth/too-many-requests":
    "Too many attempts for now. Wait a few minutes before trying again, or reset your password to sign in straight away.",
  "auth/email-already-in-use": "An account already uses this email address. Sign in instead, or reset your password.",
  "auth/weak-password": `Choose a longer password: at least ${MIN_NEW_PASSWORD_LENGTH} characters.`,
  "auth/password-does-not-meet-requirements": `Choose a longer password: at least ${MIN_NEW_PASSWORD_LENGTH} characters.`,
  "auth/invalid-email": "That email address does not look right. Check it and try again.",
  "auth/missing-password": "Enter your password.",
  "auth/popup-closed-by-user": "The sign-in window closed before it finished. Try again.",
  "auth/cancelled-popup-request": "The sign-in window closed before it finished. Try again.",
  "auth/popup-blocked": "Your browser blocked the sign-in window. Allow pop-ups for this site, then try again.",
  "auth/network-request-failed": "The sign-in service could not be reached. Check your connection and try again.",
  "auth/account-exists-with-different-credential":
    "This email already signs in another way. Use Google, or your email and password, instead.",
  "auth/user-disabled": "This account has been switched off. Contact the Papertrend team.",
  "auth/requires-recent-login": "For your security, sign in again before doing that.",
};

export function authErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") return code;
  const message = (error as { message?: unknown }).message;
  const match = typeof message === "string" ? /\((auth\/[a-z-]+)\)/.exec(message) : null;
  return match?.[1] ?? null;
}

export function friendlyAuthError(error: unknown, fallback: string): string {
  const code = authErrorCode(error);
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (error instanceof Error && error.message && !/^Firebase:/.test(error.message)) return error.message;
  return fallback;
}
