/**
 * An invite code waiting to be used (docs/32, 2.11, AUTH-2).
 *
 * It was kept in sessionStorage, which belongs to one tab: the email
 * confirmation link opens a new tab, where the code was gone and the reader
 * met the invite screen with nothing filled in. It now lives in localStorage
 * for a week, on this device only, and is removed once it is used.
 */

export const PENDING_INVITE_KEY = "papertrend.pendingInvite";
export const PENDING_INVITE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The stored code, or "" when there is none, it is malformed, or it is older than a week. */
export function parsePendingInvite(raw: string | null, now = Date.now()): string {
  if (!raw) return "";
  try {
    const value = JSON.parse(raw) as { code?: unknown; savedAt?: unknown };
    const code = typeof value.code === "string" ? value.code : "";
    const savedAt = typeof value.savedAt === "number" ? value.savedAt : NaN;
    if (!/^[A-Za-z0-9-]{1,40}$/.test(code) || !Number.isFinite(savedAt) || now - savedAt > PENDING_INVITE_MAX_AGE_MS) return "";
    return code;
  } catch {
    return "";
  }
}

export function savePendingInvite(code: string): void {
  try {
    window.localStorage.setItem(PENDING_INVITE_KEY, JSON.stringify({ code, savedAt: Date.now() }));
  } catch {
    // Storage can be unavailable; the code is still used on this page.
  }
}

export function readPendingInvite(): string {
  try {
    const code = parsePendingInvite(window.localStorage.getItem(PENDING_INVITE_KEY));
    if (!code) window.localStorage.removeItem(PENDING_INVITE_KEY);
    return code;
  } catch {
    return "";
  }
}

export function clearPendingInvite(): void {
  try {
    window.localStorage.removeItem(PENDING_INVITE_KEY);
    // The key's old home, for a code saved before the move.
    window.sessionStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // Nothing stored.
  }
}
