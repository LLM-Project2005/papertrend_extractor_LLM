/**
 * Splits a stored file path into its bucket and object.
 *
 * A gs:// path names its own bucket; `known` says whether that bucket is one
 * this deployment may touch. A bare object path belongs to this deployment's
 * bucket. Paths that climb (..) or use backslashes are refused.
 */
export function parseStoredObject(
  storagePath: string,
  ownBucket: string,
  knownBuckets: readonly string[]
): { bucket: string; objectName: string; known: boolean } | null {
  const path = String(storagePath ?? "").trim();
  let bucket = "";
  let objectName = path.replace(/^\/+/, "");
  if (path.startsWith("gs://")) {
    const withoutScheme = path.slice(5);
    const slashIndex = withoutScheme.indexOf("/");
    if (slashIndex <= 0) return null;
    bucket = withoutScheme.slice(0, slashIndex);
    objectName = withoutScheme.slice(slashIndex + 1);
  }
  if (!objectName || objectName.includes("..") || objectName.includes("\\")) return null;
  if (!bucket) return ownBucket ? { bucket: ownBucket, objectName, known: true } : null;
  return { bucket, objectName, known: knownBuckets.includes(bucket) };
}

/**
 * The name a downloaded paper is saved under: its name in the Library, with
 * the original file's extension added back when a rename dropped it.
 */
export function downloadFileName(name: string | null | undefined, originalName: string | null | undefined): string {
  const extension = /\.[a-z0-9]{1,8}$/i.exec(String(originalName ?? ""))?.[0].toLowerCase() ?? "";
  const base =
    String(name ?? "")
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 150) || "paper";
  return extension && !base.toLowerCase().endsWith(extension) ? `${base}${extension}` : base;
}

/**
 * A Content-Disposition that has the browser save the file rather than show
 * it. The plain filename is an ASCII stand-in for browsers that read only
 * that one; filename* carries the real name, Thai included (RFC 6266).
 */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
