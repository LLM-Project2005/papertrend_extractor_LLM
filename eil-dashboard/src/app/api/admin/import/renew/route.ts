import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { cloudSqlIngestionRepository } from "@/lib/cloudsql/ingestion-repository";
import { signPaperUpload } from "@/lib/paper-upload-url";
import { pendingObjectName } from "@/lib/pending-upload-path";
import { getDatabaseProvider, getGcsUploadBucket, getStorageProvider } from "@/lib/server-env";

export const runtime = "nodejs";

const RenewSchema = z.object({
  folderJobId: z.string().uuid(),
  runId: z.string().uuid(),
  storagePath: z.string().min(1).max(1024),
});

/**
 * A new upload URL for a file of a batch still uploading (docs/32, 4.5; audit
 * LIB-8): URLs are signed for 15 minutes when a batch is prepared, and a large
 * batch on a slow connection outlasted the last ones. Only the owner's own
 * run, still waiting for its file, and only the object it was first signed for.
 */
export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const bucket = getGcsUploadBucket();
  if (getDatabaseProvider() !== "cloud-sql" || getStorageProvider() !== "gcs" || !bucket) {
    return NextResponse.json({ error: "Upload links can't be renewed here." }, { status: 501 });
  }
  const parsed = RenewSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "That upload can't be renewed." }, { status: 400 });
  const { folderJobId, runId, storagePath } = parsed.data;
  const objectName = pendingObjectName(storagePath, runId, bucket);
  if (!objectName) return NextResponse.json({ error: "That upload can't be renewed." }, { status: 400 });
  try {
    const run = await cloudSqlIngestionRepository.pendingUploadRun(user.id, folderJobId, runId);
    if (!run) {
      return NextResponse.json({ error: "That upload is no longer waiting for its file. Add the paper again." }, { status: 404 });
    }
    const signed = await signPaperUpload({ objectName, contentType: run.mime_type || "application/pdf" });
    return NextResponse.json(
      { signedUrl: signed.signedUrl, uploadHeaders: signed.headers, storagePath: signed.storagePath },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Renewing an upload URL failed.", { message: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ error: "The upload link couldn't be renewed right now." }, { status: 503 });
  }
}
