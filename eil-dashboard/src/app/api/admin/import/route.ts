import { NextResponse } from "next/server";
import {
  getAuthenticatedUserFromRequest,
  isAuthorizedAdminRequest,
} from "@/lib/admin-auth";
import { ensureResearchFolder, sanitizeFolderName } from "@/lib/research-folders";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  persistWorkerStartState,
  triggerWorkerQueueWithRetries,
  type WorkerQueueStartResult,
} from "@/lib/worker-queue-start";

export const runtime = "nodejs";

const AUTO_ANALYSIS_PROVIDER = "Automatic task routing";
const AUTO_ANALYSIS_MODEL = "automatic-task-routing";
const AUTO_ANALYSIS_LABEL = "Automatic per-task model routing";

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export async function GET(request: Request) {
  if (!(await isAuthorizedAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const user = await getAuthenticatedUserFromRequest(request);
    let query = supabase
      .from("ingestion_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(25);

    query = user ? query.eq("owner_user_id", user.id) : query.is("owner_user_id", null);

    const { data, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    console.info("[admin.import] listed runs", { count: data?.length ?? 0 });
    return NextResponse.json({ runs: data ?? [] });
  } catch (error) {
    console.error("[admin.import] list failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load ingestion runs." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (!(await isAuthorizedAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const user = await getAuthenticatedUserFromRequest(request);
    const formData = await request.formData();
    const folder = sanitizeFolderName(String(formData.get("folder") ?? "Inbox"));
    const sourceKind = String(formData.get("source_kind") ?? "pdf-upload") || "pdf-upload";
    const projectId = String(formData.get("project_id") ?? "").trim();
    const files = formData
      .getAll("files")
      .filter((item): item is File => item instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "Upload at least one PDF file." }, { status: 400 });
    }
    if (!projectId) {
      return NextResponse.json({ error: "project_id is required." }, { status: 400 });
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
        queued_runs: files.length,
        progress_stage: "queued",
        progress_message: "Queued",
        progress_detail: `Preparing ${files.length} file${files.length === 1 ? "" : "s"} for batch analysis.`,
      })
      .select("*")
      .single();

    if (folderJobError || !folderJob) {
      throw new Error(folderJobError?.message ?? "Failed to create folder analysis job.");
    }

    const createdRuns: Array<Record<string, unknown>> = [];
    for (const file of files) {
      const lowerName = file.name.toLowerCase();
      if (!lowerName.endsWith(".pdf")) {
        return NextResponse.json(
          { error: `Only PDF uploads are supported in v1. Invalid file: ${file.name}` },
          { status: 400 }
        );
      }

      const { data: runData, error: insertError } = await supabase
        .from("ingestion_runs")
        .insert({
          owner_user_id: user?.id ?? null,
          folder_id: folderId,
          folder_analysis_job_id: folderJob.id,
          source_type: "upload",
          status: "queued",
          source_filename: file.name,
          display_name: file.name,
          source_extension: lowerName.split(".").pop() ?? "pdf",
          mime_type: file.type || "application/pdf",
          file_size_bytes: file.size,
          provider: AUTO_ANALYSIS_PROVIDER,
          model: AUTO_ANALYSIS_MODEL,
          input_payload: {
            uploaded_from: "/organizations",
            folder_name: folder,
            source_kind: sourceKind,
            original_size: file.size,
            mime_type: file.type || "application/pdf",
            analysis_mode: "automatic",
            analysis_label: AUTO_ANALYSIS_LABEL,
            progress_stage: "queued",
            progress_message: "Queued",
            progress_detail:
              "Preparing file for batch analysis and automatic per-task routing.",
          },
        })
        .select("*")
        .single();

      if (insertError || !runData) {
        throw new Error(insertError?.message ?? `Failed to create run for ${file.name}`);
      }

      const storagePath = `pending/${folder}/${runData.id}/${sanitizeFileName(file.name)}`;
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      const { error: uploadError } = await supabase.storage
        .from("paper-uploads")
        .upload(storagePath, fileBuffer, {
          contentType: file.type || "application/pdf",
          upsert: false,
        });

      if (uploadError) {
        await supabase
          .from("ingestion_runs")
          .update({
            status: "failed",
            error_message: uploadError.message,
            updated_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          })
          .eq("id", runData.id);

        throw new Error(`Failed to upload ${file.name}: ${uploadError.message}`);
      }

      const { data: updatedRun, error: updateError } = await supabase
        .from("ingestion_runs")
        .update({
          source_path: storagePath,
          updated_at: new Date().toISOString(),
        })
        .eq("id", runData.id)
        .select("*")
        .single();

      if (updateError) {
        throw new Error(`Uploaded ${file.name} but failed to update run metadata.`);
      }

      createdRuns.push(updatedRun ?? runData);
    }

    console.info("[admin.import] queued upload runs", {
      count: createdRuns.length,
      folder,
      sourceKind,
      provider: AUTO_ANALYSIS_PROVIDER,
      model: AUTO_ANALYSIS_MODEL,
    });

    let queueStart: WorkerQueueStartResult;
    try {
      queueStart = await triggerWorkerQueueWithRetries({
        maxRuns: Math.min(createdRuns.length, 5),
        reason: "admin-import-upload",
      });
    } catch (triggerError) {
      queueStart = {
        started: false,
        alreadyRunning: false,
        attempts: 1,
        trigger: {
          started: false,
          status: 0,
          payload: {
            reason: "trigger_exception",
            message:
              triggerError instanceof Error ? triggerError.message : "unknown_error",
          },
        },
        progressStage: "queued_but_unstarted",
        progressMessage: "Upload succeeded, but processing did not start",
        progressDetail:
          "The files were uploaded successfully, but the app could not reach the analysis worker. Use “Start processing now” to retry once worker connectivity is restored.",
      };
    }

    await persistWorkerStartState({
      supabase,
      runIds: createdRuns
        .map((run) => String(run.id ?? ""))
        .filter(Boolean),
      folderJobId: String(folderJob.id ?? ""),
      result: queueStart,
    });

    console.info("[admin.import] worker trigger result", queueStart);
    return NextResponse.json(
      {
        runs: createdRuns,
        folderJob: {
          ...folderJob,
          progress_stage: queueStart.progressStage,
          progress_message: queueStart.progressMessage,
          progress_detail: queueStart.progressDetail,
        },
        queueStart,
        warning: queueStart.started ? null : queueStart.progressMessage,
      },
      { status: queueStart.started || queueStart.alreadyRunning ? 201 : 202 }
    );
  } catch (error) {
    console.error("[admin.import] upload failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed." },
      { status: 500 }
    );
  }
}
