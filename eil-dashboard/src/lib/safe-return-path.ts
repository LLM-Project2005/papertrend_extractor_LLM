/**
 * A path to send the reader back to after sign-in, or the fallback.
 *
 * Only a path on this site is accepted. Checking that the text starts with one
 * slash is not enough: browsers read a backslash as a slash and drop tabs and
 * newlines, so "/\host" and "/<tab>/host" both leave the site. The value is
 * resolved the way a browser would, against a stand-in origin, and kept only if
 * it stays on that origin.
 */
export function safeReturnPath(raw: unknown, fallback: string): string {
  const value = String(raw ?? "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  const base = "https://return-path.invalid";
  try {
    const url = new URL(value, base);
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
