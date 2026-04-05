import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import {
  ensureGoogleDriveAccessToken,
  getGoogleDriveConnection,
  getGoogleDriveFileMetadata,
} from "@/lib/google-drive";
import { ensureResearchFolder, sanitizeFolderName } from "@/lib/research-folders";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { triggerWorkerQueue } from "@/lib/worker-trigger";

export const runtime = "nodejs";

const AUTO_ANALYSIS_PROVIDER = "Automatic task routing";
const AUTO_ANALYSIS_MODEL = "automatic-task-routing";
const AUTO_ANALYSIS_LABEL = "Automatic per-task model routing";

export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      fileIds?: string[];
      folder?: string;
      projectId?: string;
    };

    const fileIds = (body.fileIds ?? []).filter(
      (fileId): fileId is string => typeof fileId === "string" && fileId.trim().length > 0
    );
    if (fileIds.length === 0) {
      return NextResponse.json(
        { error: "Select at least one Google Drive PDF file." },
        { status: 400 }
      );
    }
    if (!body.projectId?.trim()) {
      return NextResponse.json(
        { error: "projectId is required." },
        { status: 400 }
      );
    }

    const connection = await getGoogleDriveConnection(user.id);
    if (!connection) {
      return NextResponse.json(
        { error: "Connect Google Drive before queueing files." },
        { status: 400 }
      );
    }

    const accessToken = await ensureGoogleDriveAccessToken(connection);
    const folder = sanitizeFolderName(body.folder ?? "Inbox");
    const supabase = getSupabaseAdmin();
    const researchFolder = await ensureResearchFolder(
      supabase,
      user.id,
      body.projectId.trim(),
      folder
    );
    const folderId = researchFolder?.id ?? null;
    const { data: folderJob, error: folderJobError } = await supabase
      .from("folder_analysis_jobs")
      .insert({
        owner_user_id: user.id,
        folder_id: folderId,
        status: "queued",
        total_runs: fileIds.length,
        queued_runs: fileIds.length,
        progress_stage: "queued",
        progress_message: "Queued",
        progress_detail: `Preparing ${fileIds.length} Google Drive file${fileIds.length === 1 ? "" : "s"} for batch analysis.`,
      })
      .select("*")
      .single();

    if (folderJobError || !folderJob) {
      throw new Error(folderJobError?.message ?? "Failed to create folder analysis job.");
    }
    const createdRuns: Array<Record<string, unknown>> = [];

    for (const fileId of fileIds) {
      const file = await getGoogleDriveFileMetadata(accessToken, fileId);
      if (file.mimeType && file.mimeType !== "application/pdf") {
        continue;
      }

      const { data: runData, error: insertError } = await supabase
        .from("ingestion_runs")
        .insert({
          owner_user_id: user.id,
          folder_id: folderId,
          folder_analysis_job_id: folderJob.id,
          source_type: "upload",
          status: "queued",
          source_filename: file.name,
          display_name: file.name,
          source_path: file.id,
          source_extension: file.name.toLowerCase().split(".").pop() ?? "pdf",
          mime_type: file.mimeType ?? "application/pdf",
          file_size_bytes: file.size ? Number(file.size) : null,
          provider: AUTO_ANALYSIS_PROVIDER,
          model: AUTO_ANALYSIS_MODEL,
          input_payload: {
            source_kind: "google-drive",
            folder_name: folder,
            connector_user_id: user.id,
            drive_file_id: file.id,
            drive_web_view_link: file.webViewLink ?? null,
            mime_type: file.mimeType ?? "application/pdf",
            original_size: file.size ? Number(file.size) : null,
            uploaded_from: "/workspace/home",
            analysis_mode: "automatic",
            analysis_label: AUTO_ANALYSIS_LABEL,
            progress_stage: "queued",
            progress_message: "Queued",
            progress_detail:
              "Preparing Google Drive PDF for batch analysis and automatic per-task routing.",
          },
        })
        .select("*")
        .single();

      if (insertError || !runData) {
        throw new Error(insertError?.message ?? `Failed to queue ${file.name}`);
      }

      createdRuns.push(runData);
    }

    if (createdRuns.length === 0) {
      return NextResponse.json(
        { error: "No PDF files were queued from Google Drive." },
        { status: 400 }
      );
    }

    console.info("[google-drive.queue] queued drive runs", {
      userId: user.id,
      count: createdRuns.length,
      folder,
      provider: AUTO_ANALYSIS_PROVIDER,
      model: AUTO_ANALYSIS_MODEL,
    });
    try {
      const trigger = await triggerWorkerQueue({
        maxRuns: Math.min(createdRuns.length, 2),
        reason: "google-drive-queue",
      });
      console.info("[google-drive.queue] worker trigger result", trigger);
    } catch (triggerError) {
      console.error("[google-drive.queue] worker trigger failed", {
        error:
          triggerError instanceof Error ? triggerError.message : "unknown_error",
      });
    }
    return NextResponse.json({ runs: createdRuns, folderJob }, { status: 201 });
  } catch (error) {
    console.error("[google-drive.queue] queue failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to queue Google Drive files.",
      },
      { status: 500 }
    );
  }
}
