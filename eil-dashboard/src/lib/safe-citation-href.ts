/**
 * A citation link that is safe to render: an internal workspace or docs path,
 * or an http(s) address. Anything else - javascript:, data:, vbscript: - comes
 * back as "#". Citation addresses can come from a web-search provider's
 * annotations, which the app does not control.
 */
export function safeCitationHref(href: string): string {
  const value = String(href || "").trim();
  if (value.startsWith("/workspace/") || value.startsWith("/docs/")) {
    return value;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "#";
  } catch {
    return "#";
  }
}
