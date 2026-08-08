import "server-only";

import { Storage } from "@google-cloud/storage";
import { getGcsUploadBucket } from "@/lib/server-env";

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

export async function gcsObjectExists(storagePath: string): Promise<boolean> {
  if (!storagePath.startsWith("gs://")) return false;
  const withoutScheme = storagePath.slice(5);
  const slashIndex = withoutScheme.indexOf("/");
  if (slashIndex <= 0) return false;
  const bucket = withoutScheme.slice(0, slashIndex);
  const objectName = withoutScheme.slice(slashIndex + 1);
  if (!objectName || objectName.includes("..") || objectName.includes("\\")) return false;
  const [exists] = await storage.bucket(bucket).file(objectName).exists();
  return exists;
}
