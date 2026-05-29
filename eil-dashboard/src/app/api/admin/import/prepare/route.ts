import { NextResponse } from "next/server";
import {
  getAuthenticatedUserFromRequest,
  isAuthorizedAdminRequest,
} from "@/lib/admin-auth";
import { ensureResearchFolder, sanitizeFolderName } from "@/lib/research-folders";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const AUTO_ANALYSIS_PROVIDER = "Automatic task routing";
const AUTO_ANALYSIS_MODEL = "automatic-task-routing";
const AUTO_ANALYSIS_LABEL = "Automatic per-task model routing";

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

type PrepareUploadFile = {
  fileIndex: number;
  name: string;
  size: number;
  type?: string | null;
};

export async function POST(request: Request) {
  if (!(await isAuthorizedAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const user = await getAuthenticatedUserFromRequest(request);
    const supabase = getSupabaseAdmin();
    const body = (await request.json()) as {
      folder?: string;
      source_kind?: string;
      project_id?: string;
      files?: PrepareUploadFile[];
    };

    const folder = sanitizeFolderName(String(body.folder ?? "Inbox"));
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

    for (const file of files) {
      const lowerName = String(file.name || "").toLowerCase();
      if (!lowerName.endsWith(".pdf")) {
        return NextResponse.json(
          { error: `Only PDF uploads are supported in v1. Invalid file: ${file.name}` },
          { status: 400 }
        );
      }
    }

    const researchFolder = await ensureResearchFolder(
      supabase,
      user?.id ?? null,
      projectId,
      folder
    );
    const folderId = researchFolder?.id ?? null;

    const { data: folderJob, error: folderJobError } = await supabase
      .from("folder_analysis_jobs")
      .insert({
        owner_user_id: user?.id ?? null,
        folder_id: folderId,
        status: "queued",
        total_runs: files.length,
        queued_runs: 0,
        processing_runs: files.length,
        progress_stage: "uploading",
        progress_message: "Uploading files",
        progress_detail: `Uploading ${files.length} file${files.length === 1 ? "" : "s"} to storage before queueing analysis.`,
      })
      .select("*")
      .single();

    if (folderJobError || !folderJob) {
      throw new Error(folderJobError?.message ?? "Failed to create folder analysis job.");
    }

    const uploads: Array<{
      fileIndex: number;
      runId: string;
      storagePath: string;
      token: string;
      signedUrl: string;
      fileName: string;
    }> = [];

    const createdRuns: Array<Record<string, unknown>> = [];

    for (const file of files) {
      const lowerName = file.name.toLowerCase();

      const { data: runData, error: insertError } = await supabase
        .from("ingestion_runs")
        .insert({
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
        })
        .select("*")
        .single();

      if (insertError || !runData) {
        throw new Error(insertError?.message ?? `Failed to create run for ${file.name}`);
      }

      const storagePath = `pending/${folder}/${runData.id}/${sanitizeFileName(file.name)}`;
      const { data: signedUpload, error: signedUploadError } = await supabase.storage
        .from("paper-uploads")
        .createSignedUploadUrl(storagePath);

      if (signedUploadError || !signedUpload) {
        throw new Error(
          signedUploadError?.message ?? `Failed to create signed upload URL for ${file.name}`
        );
      }

      createdRuns.push(runData);
      uploads.push({
        fileIndex: file.fileIndex,
        runId: String(runData.id),
        storagePath,
        token: signedUpload.token,
        signedUrl: signedUpload.signedUrl,
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
      { status: 500 }
    );
  }
}
