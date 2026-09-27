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
}: {
  objectName: string;
  contentType: string;
  expiresMinutes?: number;
  bucketName?: string;
}): Promise<{ signedUrl: string; storagePath: string; headers: Record<string, string> }> {
  const bucket = resolveBucket(bucketName);
  const [signedUrl] = await storage.bucket(bucket).file(objectName).getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + expiresMinutes * 60_000,
    contentType,
  });
  return {
    signedUrl,
    storagePath: `gs://${bucket}/${objectName}`,
    headers: { "Content-Type": contentType },
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
