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

/**
 * The Cloud SQL pilot owns workspace/project records, while ingestion still
 * writes to Supabase. Mirror only the authenticated project's exact IDs until
 * the ingestion repository is migrated, so the Supabase foreign keys remain
 * valid without making Cloud SQL globally writable from this route.
 */
async function ensureCloudSqlPilotWorkspaceMirror(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  ownerUserId: string,
  projectId: string
) {
  const { data: authData, error: authError } = await supabase.auth.admin.getUserById(
    ownerUserId
  );
  if (authError || !authData.user) {
    throw new UploadPreparationError(
      "This Cloud SQL pilot account is not linked to a Supabase owner account yet. Upload testing requires the account to be linked before ingestion can start.",
      403
    );
  }

  const repository = getWorkspaceRepository();
  const [organizations, projects] = await Promise.all([
    repository.listOrganizations(ownerUserId),
    repository.listProjects(ownerUserId),
  ]);
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) {
    throw new UploadPreparationError(
      "The selected project was not found in the Cloud SQL pilot for this account. Refresh the project list and try again.",
      404
    );
  }

  const organization = organizations.find(
    (candidate) => candidate.id === project.organization_id
  );
  if (!organization) {
    throw new UploadPreparationError(
      "The selected project's workspace was not found in the Cloud SQL pilot. Refresh the project list and try again.",
      409
    );
  }

  const { data: existingOrganization, error: organizationLookupError } = await supabase
    .from("workspace_organizations")
    .select("owner_user_id")
    .eq("id", organization.id)
    .maybeSingle();
  if (organizationLookupError) throw new Error(organizationLookupError.message);
  if (
    existingOrganization?.owner_user_id &&
    existingOrganization.owner_user_id !== ownerUserId
  ) {
    throw new UploadPreparationError("The selected workspace belongs to another account.", 403);
  }

  const { data: existingProject, error: projectLookupError } = await supabase
    .from("workspace_projects")
    .select("owner_user_id, organization_id")
    .eq("id", project.id)
    .maybeSingle();
  if (projectLookupError) throw new Error(projectLookupError.message);
  if (
    existingProject?.owner_user_id &&
    (existingProject.owner_user_id !== ownerUserId ||
      existingProject.organization_id !== organization.id)
  ) {
    throw new UploadPreparationError("The selected project belongs to another account.", 403);
  }

  const updatedAt = new Date().toISOString();
  const { error: organizationUpsertError } = await supabase
    .from("workspace_organizations")
    .upsert(
      {
        id: organization.id,
        owner_user_id: ownerUserId,
        name: organization.name,
        type: organization.type,
        updated_at: organization.updated_at ?? updatedAt,
      },
      { onConflict: "id" }
    );
  if (organizationUpsertError) throw new Error(organizationUpsertError.message);

  const { error: projectUpsertError } = await supabase
    .from("workspace_projects")
    .upsert(
      {
        id: project.id,
        organization_id: organization.id,
        owner_user_id: ownerUserId,
        name: project.name,
        description: project.description ?? null,
        updated_at: project.updated_at ?? updatedAt,
      },
      { onConflict: "id" }
    );
  if (projectUpsertError) throw new Error(projectUpsertError.message);
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

  const response = await fetch(`${workerServiceUrl}/gcs/signed-upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${workerSecret}`,
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

    if (getDatabaseProvider() === "cloud-sql") {
      if (!user?.id) {
        throw new UploadPreparationError(
          "An authenticated owner account is required to upload in the Cloud SQL pilot.",
          401
        );
      }
      await ensureCloudSqlPilotWorkspaceMirror(supabase, user.id, projectId);
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
      uploadHeaders?: Record<string, string>;
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
        const { data: signedUpload, error: signedUploadError } = await supabase.storage
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
