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
