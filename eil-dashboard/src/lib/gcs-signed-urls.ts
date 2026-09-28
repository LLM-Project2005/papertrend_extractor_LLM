import "server-only";

import { Storage } from "@google-cloud/storage";
import { getGcsUploadBucket, getKnownUploadBuckets } from "@/lib/server-env";
import { parseStoredObject } from "@/lib/storage-path";

const storage = new Storage();

function resolveBucket(bucketName?: string): string {
  const bucket = String(bucketName ?? getGcsUploadBucket()).trim();
  if (!bucket) throw new Error("GCS upload bucket is not configured.");
  return bucket;
}

export async function createGcsSignedUploadUrl({
  objectName,
  contentType,
  expiresMinutes = 30,
  bucketName,
  maxBytes,
}: {
  objectName: string;
  contentType: string;
  expiresMinutes?: number;
  bucketName?: string;
  /** Storage refuses a body outside this range, so a signed URL cannot be used to store anything larger. */
  maxBytes?: number;
}): Promise<{ signedUrl: string; storagePath: string; headers: Record<string, string> }> {
  const bucket = resolveBucket(bucketName);
  // The size is part of what is signed. Without it the URL accepts a body of
  // any length, and the only limit is what the browser chose to report.
  const extensionHeaders = maxBytes && maxBytes > 0
    ? { "x-goog-content-length-range": `0,${Math.floor(maxBytes)}` }
    : undefined;
  const [signedUrl] = await storage.bucket(bucket).file(objectName).getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + expiresMinutes * 60_000,
    contentType,
    ...(extensionHeaders ? { extensionHeaders } : {}),
  });
  return {
    signedUrl,
    storagePath: `gs://${bucket}/${objectName}`,
    headers: { "Content-Type": contentType, ...(extensionHeaders ?? {}) },
  };
}

export async function createGcsSignedReadUrl({
  objectName,
  expiresMinutes = 60,
  bucketName,
}: {
  objectName: string;
  expiresMinutes?: number;
  bucketName?: string;
}): Promise<string> {
  const bucket = resolveBucket(bucketName);
  const [signedUrl] = await storage.bucket(bucket).file(objectName).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + expiresMinutes * 60_000,
  });
  return signedUrl;
}

/** See parseStoredObject; the buckets are this deployment's. */
export function resolveStoredObject(storagePath: string) {
  return parseStoredObject(storagePath, getGcsUploadBucket().trim(), getKnownUploadBuckets());
}

/**
 * The stored object's size and declared type, or null if it is not there.
 *
 * The browser uploads straight to storage, so what it later reports about a
 * file is not evidence. This asks storage itself, before the file is queued
 * for analysis.
 */
export async function gcsObjectInfo(
  storagePath: string
): Promise<{ sizeBytes: number; contentType: string } | null> {
  const stored = resolveStoredObject(storagePath);
  if (!stored?.known) return null;
  try {
    const [metadata] = await storage.bucket(stored.bucket).file(stored.objectName).getMetadata();
    return {
      sizeBytes: Number(metadata.size ?? 0),
      contentType: String(metadata.contentType ?? ""),
    };
  } catch {
    return null;
  }
}

export async function gcsObjectExists(storagePath: string): Promise<boolean> {
  if (!storagePath.startsWith("gs://")) return false;
  const stored = resolveStoredObject(storagePath);
  if (!stored?.known) return false;
  const [exists] = await storage.bucket(stored.bucket).file(stored.objectName).exists();
  return exists;
}

/**
 * Removes a stored object by its gs:// path; a missing object is not an error.
 * Only an object in a known upload bucket is ever deleted.
 */
export async function deleteGcsObject(storagePath: string): Promise<void> {
  if (!storagePath.startsWith("gs://")) return;
  const stored = resolveStoredObject(storagePath);
  if (!stored?.known) return;
  await storage.bucket(stored.bucket).file(stored.objectName).delete({ ignoreNotFound: true });
}

/**
 * Deletes every object uploaded for one run, in this deployment's bucket.
 * Upload paths are pending/<folder>/<runId>/<file>, so a glob on the run id
 * finds them without knowing the folder. Used for uploads that were refused or
 * never finished, whose run has no stored path to delete by.
 */
export async function deleteRunUploads(runId: string): Promise<number> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) return 0;
  const [files] = await storage.bucket(resolveBucket()).getFiles({ matchGlob: `pending/**/${runId}/**` });
  await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
  return files.length;
}
