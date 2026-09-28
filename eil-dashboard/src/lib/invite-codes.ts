import { createHash, randomInt } from "crypto";

/*
 * Invite codes: who may create a Papertrend account while the site is closed.
 *
 * A code is 16 characters drawn at random from 31 that are hard to misread (no
 * 0/O, 1/I/L), so about 79 bits: guessing one, even at many thousands of tries
 * a second, would take longer than the universe has existed, and redemption is
 * limited to a handful of tries an hour per account.
 *
 * Only a hash of a code is stored. The code itself is shown once, to the admin
 * who made it, so a copy of the database does not hand out working invites.
 */

export const INVITE_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const INVITE_CODE_LENGTH = 16;
export const INVITE_DEFAULT_EXPIRY_DAYS = 14;
export const INVITE_MAX_EXPIRY_DAYS = 90;
export const INVITE_MAX_USES = 50;
export const INVITE_MAX_ACTIVE_CODES = 200;

/** One message for every refusal, so a wrong, used, expired and revoked code look alike. */
export const INVITE_REFUSED_MESSAGE =
  "That invite code isn't valid. Check it and try again, or ask for a new one.";

const CODE_PATTERN = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);

/** A new code, from the operating system's cryptographic random source. */
export function generateInviteCode(): string {
  let code = "";
  for (let index = 0; index < INVITE_CODE_LENGTH; index += 1) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * The code as typed or pasted, reduced to its 16 characters; null when it
 * cannot be a code. Case, spaces and dashes do not matter.
 */
export function normalizeInviteCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 64) return null;
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  return CODE_PATTERN.test(code) ? code : null;
}

/** XXXX-XXXX-XXXX-XXXX, for showing and copying. */
export function formatInviteCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

export function hashInviteCode(normalizedCode: string): string {
  return createHash("sha256").update(`papertrend-invite:v1:${normalizedCode}`).digest("hex");
}

export type InviteStatus = "active" | "used" | "expired" | "revoked";

export function inviteStatus(
  invite: { revoked_at: string | null; expires_at: string; use_count: number; max_uses: number },
  now = Date.now()
): InviteStatus {
  if (invite.revoked_at) return "revoked";
  if (invite.use_count >= invite.max_uses) return "used";
  if (new Date(invite.expires_at).getTime() <= now) return "expired";
  return "active";
}
