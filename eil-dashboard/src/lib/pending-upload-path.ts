/* Pure: checked by the renew route, and by tests without the storage client. */

/**
 * The object a pending upload of `runId` was signed for, from the path the
 * browser was given; null for anything else (another bucket, another run, a
 * path that climbs out).
 */
export function pendingObjectName(storagePath: string, runId: string, bucket: string): string | null {
  if (storagePath.startsWith("gs://") && !storagePath.startsWith(`gs://${bucket}/`)) return null;
  const objectName = storagePath.replace(/^gs:\/\/[^/]+\//, "");
  const safe =
    objectName.startsWith("pending/") &&
    objectName.includes(`/${runId}/`) &&
    !objectName.includes("..") &&
    !objectName.includes("\\");
  return safe ? objectName : null;
}
