/*
 * src/lib/gcs-signed-urls.ts for upload route tests: no storage client and no
 * credentials. A signed URL is a fixed test address; nothing is stored, read
 * or deleted.
 */
const bucketOf = (bucketName?: string) => bucketName ?? process.env.GCS_UPLOAD_BUCKET ?? "route-test-uploads";

export async function createGcsSignedUploadUrl({
  objectName,
  contentType,
  bucketName,
}: {
  objectName: string;
  contentType: string;
  expiresMinutes?: number;
  bucketName?: string;
  maxBytes?: number;
}): Promise<{ signedUrl: string; storagePath: string; headers: Record<string, string> }> {
  const bucket = bucketOf(bucketName);
  return {
    signedUrl: `https://storage.test/${bucket}/${objectName}?signed=upload`,
    storagePath: `gs://${bucket}/${objectName}`,
    headers: { "Content-Type": contentType },
  };
}

export async function createGcsSignedReadUrl({ objectName, bucketName }: { objectName: string; expiresMinutes?: number; bucketName?: string }) {
  return `https://storage.test/${bucketOf(bucketName)}/${objectName}?signed=read`;
}

export function resolveStoredObject(_storagePath: string) {
  return null;
}

export async function gcsObjectInfo(_storagePath: string): Promise<{ sizeBytes: number; contentType: string } | null> {
  return null;
}

export async function gcsObjectExists(_storagePath: string): Promise<boolean> {
  return false;
}

export async function deleteGcsObject(_storagePath: string): Promise<void> {}

export async function deleteRunUploads(_runId: string): Promise<number> {
  return 0;
}
