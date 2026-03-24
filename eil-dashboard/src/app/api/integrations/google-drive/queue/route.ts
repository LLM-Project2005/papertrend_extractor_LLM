import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import {
  ensureGoogleDriveAccessToken,
  getGoogleDriveConnection,
  getGoogleDriveFileMetadata,
} from "@/lib/google-drive";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

function sanitizeFolderName(folderName: string): string {
  const sanitized = folderName
    .replace(/[^a-zA-Z0-9._/-]+/g, "-")
    .replace(/^\/+|\/+$/g, "");
  return sanitized || "Inbox";
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      fileIds?: string[];
      folder?: string;
      provider?: string;
      model?: string;
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

    const connection = await getGoogleDriveConnection(user.id);
    if (!connection) {
      return NextResponse.json(
        { error: "Connect Google Drive before queueing files." },
        { status: 400 }
      );
    }

    const accessToken = await ensureGoogleDriveAccessToken(connection);
    const folder = sanitizeFolderName(body.folder ?? "Inbox");
    const provider = body.provider?.trim() || "Google Drive";
    const model = body.model?.trim() || null;
    const supabase = getSupabaseAdmin();
    const createdRuns: Array<Record<string, unknown>> = [];

    for (const fileId of fileIds) {
      const file = await getGoogleDriveFileMetadata(accessToken, fileId);
      if (file.mimeType && file.mimeType !== "application/pdf") {
        continue;
      }

      const { data: runData, error: insertError } = await supabase
        .from("ingestion_runs")
        .insert({
          source_type: "upload",
          status: "queued",
          source_filename: file.name,
          source_path: file.id,
          provider,
          model,
          input_payload: {
            source_kind: "google-drive",
            folder_name: folder,
            connector_user_id: user.id,
            drive_file_id: file.id,
            drive_web_view_link: file.webViewLink ?? null,
            mime_type: file.mimeType ?? "application/pdf",
            original_size: file.size ? Number(file.size) : null,
            uploaded_from: "/workspace/home",
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
      provider,
      hasModel: Boolean(model),
    });
    return NextResponse.json({ runs: createdRuns }, { status: 201 });
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
