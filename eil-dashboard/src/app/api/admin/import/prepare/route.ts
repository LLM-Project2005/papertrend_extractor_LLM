import { NextResponse } from "next/server";
import {
  getAuthenticatedUserFromRequest,
  isAuthorizedUserOrAdminRequest,
} from "@/lib/admin-auth";
import { ensureResearchFolder, sanitizeFolderName } from "@/lib/research-folders";
import {
  getGcsUploadBucket,
  getDatabaseProvider,
  getStorageProvider,
  getWorkerServiceUrl,
  getWorkerWebhookSecret,
} from "@/lib/server-env";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getWorkspaceRepository } from "@/lib/workspace-repository";
import { cloudSqlIngestionRepository } from "@/lib/cloudsql/ingestion-repository";
import { serviceAuthorizationHeader } from "@/lib/google-service-auth";
import {
  MAX_FILES_PER_BATCH,
  sanitizeStorageFileName,
  validatePdfUploadMetadata,
} from "@/lib/upload-safety";

export const runtime = "nodejs";

const AUTO_ANALYSIS_PROVIDER = "Automatic task routing";
const AUTO_ANALYSIS_MODEL = "automatic-task-routing";
const AUTO_ANALYSIS_LABEL = "Automatic per-task model routing";

type PrepareUploadFile = {
  fileIndex: number;
  name: string;
  size: number;
  type?: string | null;
};

class UploadPreparationError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "UploadPreparationError";
  }
}

async function createGcsSignedUploadUrl({
  storagePath,
  contentType,
}: {
  storagePath: string;
  contentType: string;
}): Promise<{
  signedUrl: string;
  storagePath: string;
  headers?: Record<string, string>;
}> {
  const workerServiceUrl = getWorkerServiceUrl();
  const workerSecret = getWorkerWebhookSecret();
  const bucket = getGcsUploadBucket();
  if (!workerServiceUrl || !workerSecret || !bucket) {
    throw new Error(
      "GCS upload signing is not configured. Check WORKER_SERVICE_URL, WORKER_WEBHOOK_SECRET, and GCS_UPLOAD_BUCKET."
    );
  }

  const authorization = await serviceAuthorizationHeader(workerServiceUrl, workerSecret);
  const response = await fetch(`${workerServiceUrl}/gcs/signed-upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify({
      bucket,
      objectName: storagePath,
      contentType,
      expiresMinutes: 30,
    }),
  });

  const payload = (await response.json().catch(() => null)) as {
    signedUrl?: string;
    storagePath?: string;
    headers?: Record<string, string>;
    error?: string;
  } | null;

  if (!response.ok || !payload?.signedUrl || !payload.storagePath) {
    throw new Error(payload?.error ?? "Failed to create GCS signed upload URL.");
  }

  return {
    signedUrl: payload.signedUrl,
    storagePath: payload.storagePath,
    headers: payload.headers,
  };
}

export async function POST(request: Request) {
  if (!(await isAuthorizedUserOrAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const user = await getAuthenticatedUserFromRequest(request);
    const databaseProvider = getDatabaseProvider();
    const supabase = databaseProvider === "supabase" ? getSupabaseAdmin() : null;
    const body = (await request.json()) as {
      folder?: string;
      source_kind?: string;
      project_id?: string;
      files?: PrepareUploadFile[];
    };

    const folder = sanitizeFolderName(String(body.folder ?? "Repository"));
    const sourceKind = String(body.source_kind ?? "pdf-upload") || "pdf-upload";
    const projectId = String(body.project_id ?? "").trim();
    const files = Array.isArray(body.files)
      ? body.files.filter((file) => file && typeof file.name === "string")
      : [];

    if (!projectId) {
      return NextResponse.json({ error: "project_id is required." }, { status: 400 });
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "Upload at least one PDF file." }, { status: 400 });
    }
    if (files.length > MAX_FILES_PER_BATCH) {
      return NextResponse.json(
        { error: `Upload at most ${MAX_FILES_PER_BATCH} files per batch.` },
        { status: 400 }
      );
    }

    for (const file of files) {
      const validationError = validatePdfUploadMetadata(file);
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
      }
    }

    if (databaseProvider === "cloud-sql") {
      if (!user?.id) {
        throw new UploadPreparationError(
          "An authenticated owner account is required to upload in the Cloud SQL pilot.",
          401
        );
      }
    } else if (!supabase) {
      throw new Error("Supabase database configuration is unavailable.");
    }

    const researchFolder = databaseProvider === "cloud-sql"
      ? await getWorkspaceRepository().ensureFolder(user!.id, projectId, folder)
      : await ensureResearchFolder(supabase!, user?.id ?? null, projectId, folder);
    const folderId = researchFolder?.id ?? null;
    if (!folderId) throw new Error("Failed to resolve the upload folder.");

    let folderJob: Record<string, unknown> & { id: string };
    let preparedRuns: Array<Record<string, unknown>> = [];
    if (databaseProvider === "cloud-sql") {
      const batch = await cloudSqlIngestionRepository.createUploadBatch({
        ownerUserId: user!.id,
        folderId,
        files,
        folderName: folder,
        sourceKind,
        provider: AUTO_ANALYSIS_PROVIDER,
        model: AUTO_ANALYSIS_MODEL,
        analysisLabel: AUTO_ANALYSIS_LABEL,
      });
      folderJob = batch.folderJob;
      preparedRuns = batch.runs as unknown as Array<Record<string, unknown>>;
    } else {
      const { data, error } = await supabase!
        .from("folder_analysis_jobs")
        .insert({
          owner_user_id: user?.id ?? null, folder_id: folderId, status: "queued",
          total_runs: files.length, queued_runs: 0, processing_runs: files.length,
          progress_stage: "uploading", progress_message: "Uploading files",
          progress_detail: `Uploading ${files.length} file${files.length === 1 ? "" : "s"} to storage before queueing analysis.`,
        }).select("*").single();
      if (error || !data) throw new Error(error?.message ?? "Failed to create folder analysis job.");
      folderJob = data as Record<string, unknown> & { id: string };
    }

    const uploads: Array<{
      fileIndex: number;
      runId: string;
      storagePath: string;
      token: string;
      signedUrl: string;
      uploadHeaders?: Record<string, string>;
      fileName: string;
    }> = [];

    const createdRuns: Array<Record<string, unknown>> = [];

    for (const [filePosition, file] of files.entries()) {
      const lowerName = file.name.toLowerCase();
      let runData = preparedRuns[filePosition] as Record<string, unknown> | undefined;
      if (!runData) {
        const { data, error: insertError } = await supabase!
          .from("ingestion_runs").insert({
          owner_user_id: user?.id ?? null,
          folder_id: folderId,
          folder_analysis_job_id: folderJob.id,
          source_type: "upload",
          status: "processing",
          source_filename: file.name,
          display_name: file.name,
          source_extension: lowerName.split(".").pop() ?? "pdf",
          mime_type: file.type || "application/pdf",
          file_size_bytes: file.size,
          provider: AUTO_ANALYSIS_PROVIDER,
          model: AUTO_ANALYSIS_MODEL,
          input_payload: {
            uploaded_from: "/workspace/imports",
            folder_name: folder,
            source_kind: sourceKind,
            original_size: file.size,
            mime_type: file.type || "application/pdf",
            analysis_mode: "automatic",
            analysis_label: AUTO_ANALYSIS_LABEL,
            progress_stage: "uploading",
            progress_message: "Uploading",
            progress_detail: "Uploading file directly to storage before queueing analysis.",
          },
          }).select("*").single();
        if (insertError || !data) {
          throw new Error(insertError?.message ?? `Failed to create run for ${file.name}`);
        }
        runData = data as Record<string, unknown>;
      }

      const objectPath = `pending/${folder}/${runData.id}/${sanitizeStorageFileName(file.name)}`;
      let storagePath = objectPath;
      let token = "";
      let signedUrl = "";
      let uploadHeaders: Record<string, string> | undefined;

      if (getStorageProvider() === "gcs") {
        const signedUpload = await createGcsSignedUploadUrl({
          storagePath: objectPath,
          contentType: file.type || "application/pdf",
        });
        storagePath = signedUpload.storagePath;
        signedUrl = signedUpload.signedUrl;
        uploadHeaders = signedUpload.headers;
      } else {
        const { data: signedUpload, error: signedUploadError } = await supabase!.storage
          .from("paper-uploads")
          .createSignedUploadUrl(objectPath);

        if (signedUploadError || !signedUpload) {
          throw new Error(
            signedUploadError?.message ?? `Failed to create signed upload URL for ${file.name}`
          );
        }
        token = signedUpload.token;
        signedUrl = signedUpload.signedUrl;
      }

      createdRuns.push(runData);
      uploads.push({
        fileIndex: file.fileIndex,
        runId: String(runData.id),
        storagePath,
        token,
        signedUrl,
        uploadHeaders,
        fileName: file.name,
      });
    }

    return NextResponse.json(
      {
        folderId,
        folderJob,
        runs: createdRuns,
        uploads,
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to prepare uploads.",
      },
      { status: error instanceof UploadPreparationError ? error.status : 500 }
    );
  }
}
