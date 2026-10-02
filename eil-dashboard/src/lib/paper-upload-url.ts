import { createGcsSignedUploadUrl } from "@/lib/gcs-signed-urls";
import { getGcsUploadBucket, getMaxUploadBytes } from "@/lib/server-env";

/** A signed upload URL's life: short enough that one left lying around is of little use. */
export const UPLOAD_URL_MINUTES = 15;

/** Signs a browser PUT of one paper to this deployment's upload bucket. */
export async function signPaperUpload({
  objectName,
  contentType,
}: {
  objectName: string;
  contentType: string;
}): Promise<{ signedUrl: string; storagePath: string; headers?: Record<string, string> }> {
  const bucket = getGcsUploadBucket();
  if (!bucket) throw new Error("GCS_UPLOAD_BUCKET is not configured.");
  return createGcsSignedUploadUrl({
    bucketName: bucket,
    objectName,
    contentType,
    expiresMinutes: UPLOAD_URL_MINUTES,
    // The signed URL can also bind the body size, which is the stronger check,
    // but the browser must then send x-goog-content-length-range and storage
    // only permits request headers the bucket's CORS rule lists. Until that
    // rule includes it, sending it would fail every upload's preflight, so the
    // size is enforced at finalize instead (storage is asked for the object's
    // real size before anything is queued). Set GCS_SIGN_UPLOAD_SIZE=true once
    // the bucket allows the header.
    maxBytes: process.env.GCS_SIGN_UPLOAD_SIZE === "true" ? getMaxUploadBytes() : undefined,
  });
}
