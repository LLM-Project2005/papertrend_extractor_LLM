/*
 * Profile pictures (2026-11-05). A picture is uploaded in Settings > Profile:
 * the browser crops it to a square, scales it to AVATAR_SIZE pixels and saves
 * it on the profile as a JPEG data URL, so there is no file in storage to
 * manage or to leave behind when the account goes. A picture from a sign-in
 * provider (Google) arrives as an https link and is kept as one.
 *
 * The server takes nothing else: an https link, a small data URL of a JPEG,
 * PNG or WebP image, or nothing (initials are shown).
 */

export const AVATAR_SIZE = 256;
/** Characters, the whole data URL. A 256-pixel JPEG at quality 0.85 is about 20-40 thousand. */
export const AVATAR_DATA_URL_MAX = 150_000;
/** The largest file the picker accepts before it is scaled down. */
export const AVATAR_SOURCE_MAX_BYTES = 10 * 1024 * 1024;

const DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const HTTPS_URL = /^https:\/\/\S+$/i;

export function isUploadedAvatar(value: string): boolean {
  return value.startsWith("data:");
}

/** True for a value the profile may store as its picture ("" clears it). */
export function isAllowedAvatarUrl(value: string | null | undefined): boolean {
  const url = String(value ?? "").trim();
  if (!url) return true;
  if (isUploadedAvatar(url)) return url.length <= AVATAR_DATA_URL_MAX && DATA_URL.test(url);
  return url.length <= 2_000 && HTTPS_URL.test(url);
}

/** True for a value worth putting in an <img>: the same rule, minus the empty case. */
export function isDisplayableAvatar(value: string | null | undefined): boolean {
  const url = String(value ?? "").trim();
  return Boolean(url) && isAllowedAvatarUrl(url);
}
