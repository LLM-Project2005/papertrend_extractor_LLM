import { NextResponse } from "next/server";
import {
  getAuthenticatedUserFromRequest,
  isAuthorizedUserOrAdminRequest,
} from "@/lib/admin-auth";
import { ensureResearchFolder, sanitizeFolderName } from "@/lib/research-folders";
import { getDatabaseProvider, getStorageProvider } from "@/lib/server-env";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getWorkspaceRepository } from "@/lib/workspace-repository";
import {
  cloudSqlIngestionRepository,
  UploadPolicyError,
} from "@/lib/cloudsql/ingestion-repository";
import { sanitizeAnalysisProfilePayload } from "@/lib/analysis-profile";
import {
  createGeneralAnalysisProfile,
  sanitizeProjectAnalysisProfile,
  toIngestionAnalysisProfile,
} from "@/lib/project-analysis-profile";
import { deleteRunUploads } from "@/lib/gcs-signed-urls";
import { signPaperUpload } from "@/lib/paper-upload-url";
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
  sha256?: string | null;
  /** Picked in Google Drive: recorded with the run (audit LIB-7). */
  drive_file_id?: string | null;
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
      analysis_profile?: unknown;
      files?: PrepareUploadFile[];
    };

    const folder = sanitizeFolderName(String(body.folder ?? "Repository"));
    const sourceKind = String(body.source_kind ?? "pdf-upload") || "pdf-upload";
    const projectId = String(body.project_id ?? "").trim();
    let analysisProfile: unknown = sanitizeAnalysisProfilePayload(body.analysis_profile);
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
      const project = await getWorkspaceRepository().getProject(user.id, projectId);
      if (!project) {
        throw new UploadPreparationError("Repository not found.", 404);
      }
      const authoritativeProfile = project.analysis_profile
        ? sanitizeProjectAnalysisProfile(project.analysis_profile)
        : createGeneralAnalysisProfile();
      analysisProfile = toIngestionAnalysisProfile(authoritativeProfile);
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
    // Files that go ahead, in order with preparedRuns, and those left out with a reason (docs/32, 4.5).
    let acceptedFiles: PrepareUploadFile[] = files;
    let skippedFiles: Array<{ fileIndex: number; name: string; reason: string }> = [];
    if (databaseProvider === "cloud-sql") {
      // This person's uploads that were prepared but never finished are
      // closed and their files deleted first, so they neither linger in the
      // bucket nor count against the paper limit below. Best effort: a
      // cleanup failure never blocks the new upload.
      const abandoned = await cloudSqlIngestionRepository.failAbandonedUploads(user!.id).catch(() => [] as string[]);
      await Promise.all(abandoned.map((runId) => deleteRunUploads(runId).catch(() => 0)));
      const batch = await cloudSqlIngestionRepository.createUploadBatch({
        ownerUserId: user!.id,
        projectId,
        folderId,
        files: files.map((file) => ({
          ...file,
          driveFileId: typeof file.drive_file_id === "string" ? file.drive_file_id : null,
        })),
        folderName: folder,
        sourceKind,
        provider: AUTO_ANALYSIS_PROVIDER,
        model: AUTO_ANALYSIS_MODEL,
        analysisLabel: AUTO_ANALYSIS_LABEL,
        analysisProfile,
      });
      folderJob = batch.folderJob;
      preparedRuns = batch.runs as unknown as Array<Record<string, unknown>>;
      acceptedFiles = batch.acceptedPositions.map((position) => files[position]);
      skippedFiles = batch.skipped.map((skip) => ({ fileIndex: files[skip.position]?.fileIndex ?? skip.position, name: skip.name, reason: skip.reason }));
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

    for (const [filePosition, file] of acceptedFiles.entries()) {
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
            analysis_profile: analysisProfile,
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
        const signedUpload = await signPaperUpload({
          objectName: objectPath,
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
        skipped: skippedFiles,
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to prepare uploads.",
        // Every file left out, so the dialog can say which (the dialog numbers its files in order).
        ...(error instanceof UploadPolicyError && error.skipped.length
          ? { skipped: error.skipped.map((skip) => ({ fileIndex: skip.position, name: skip.name, reason: skip.reason })) }
          : {}),
      },
      {
        status:
          error instanceof UploadPreparationError || error instanceof UploadPolicyError
            ? error.status
            : 500,
      }
    );
  }
}
