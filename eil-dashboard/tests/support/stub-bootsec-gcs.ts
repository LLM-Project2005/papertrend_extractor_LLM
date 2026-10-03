/*
 * src/lib/gcs-signed-urls.ts for upload route tests: no storage client and no
 * credentials. What storage reports for an object is what a test put in
 * globalThis.__bootsecStoredObjects (by path); every delete is recorded in
 * globalThis.__bootsecDeletedObjects.
 */
declare global {
  // eslint-disable-next-line no-var
  var __bootsecStoredObjects: Record<string, { sizeBytes: number; contentType: string }> | undefined;
  // eslint-disable-next-line no-var
  var __bootsecDeletedObjects: string[] | undefined;
}

const bucketOf = (bucketName?: string) => bucketName ?? process.env.GCS_UPLOAD_BUCKET ?? "route-test-uploads";

export async function createGcsSignedUploadUrl({ objectName, contentType, bucketName }: { objectName: string; contentType: string; expiresMinutes?: number; bucketName?: string; maxBytes?: number }) {
  const bucket = bucketOf(bucketName);
  return { signedUrl: `https://storage.test/${bucket}/${objectName}?signed=upload`, storagePath: `gs://${bucket}/${objectName}`, headers: { "Content-Type": contentType } };
}

export async function createGcsSignedReadUrl({ objectName, bucketName }: { objectName: string; expiresMinutes?: number; bucketName?: string }) {
  return `https://storage.test/${bucketOf(bucketName)}/${objectName}?signed=read`;
}

export function resolveStoredObject(_storagePath: string) {
  return null;
}

export async function gcsObjectInfo(storagePath: string): Promise<{ sizeBytes: number; contentType: string } | null> {
  return globalThis.__bootsecStoredObjects?.[storagePath] ?? null;
}

export async function gcsObjectExists(storagePath: string): Promise<boolean> {
  return Boolean(globalThis.__bootsecStoredObjects?.[storagePath]);
}

export async function deleteGcsObject(storagePath: string): Promise<void> {
  (globalThis.__bootsecDeletedObjects ??= []).push(storagePath);
}

export async function deleteRunUploads(_runId: string): Promise<number> {
  return 0;
}
