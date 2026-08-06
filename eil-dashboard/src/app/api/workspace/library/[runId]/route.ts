import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { cloudSqlLibraryRepository } from "@/lib/cloudsql/library-repository";
import { getDatabaseProvider } from "@/lib/server-env";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { createGcsSignedReadUrl } from "@/lib/gcs-signed-urls";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { runId } = await params;
    const body = (await request.json()) as {
      action?: "rename" | "favorite" | "move" | "trash" | "restore";
      value?: string | boolean | null;
      folderId?: string | null;
    };
    const action = body.action;
    if (!action) {
      return NextResponse.json({ error: "Action is required." }, { status: 400 });
    }

    if (getDatabaseProvider() === "cloud-sql") {
      const now = new Date().toISOString();
      let patch: {
        displayName?: string;
        isFavorite?: boolean;
        folderId?: string | null;
        trashedAt?: string | null;
      } = {};

      if (action === "rename") {
        if (typeof body.value !== "string" || !body.value.trim()) {
          return NextResponse.json({ error: "New file name is required." }, { status: 400 });
        }
        patch = { displayName: body.value.trim() };
      } else if (action === "favorite") {
        patch = { isFavorite: Boolean(body.value) };
      } else if (action === "move") {
        if (!body.folderId) {
          return NextResponse.json({ error: "folderId is required." }, { status: 400 });
        }
        patch = { folderId: body.folderId };
      } else if (action === "trash") {
        patch = { trashedAt: now };
      } else if (action === "restore") {
        patch = { trashedAt: null };
      }

      const run = await cloudSqlLibraryRepository.updateRun(user.id, runId, patch);
      if (!run) {
        return NextResponse.json({ error: "Library file not found." }, { status: 404 });
      }
      return NextResponse.json({ run });
    }

    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();
    let patch: Record<string, unknown> = { updated_at: now };

    if (action === "rename") {
      if (typeof body.value !== "string" || !body.value.trim()) {
        return NextResponse.json({ error: "New file name is required." }, { status: 400 });
      }
      patch = { ...patch, display_name: body.value.trim() };
    } else if (action === "favorite") {
      patch = { ...patch, is_favorite: Boolean(body.value) };
    } else if (action === "move") {
      if (!body.folderId) {
        return NextResponse.json({ error: "folderId is required." }, { status: 400 });
      }

      const { data: targetFolder, error: folderError } = await supabase
        .from("research_folders")
        .select("id")
        .eq("id", body.folderId)
        .eq("owner_user_id", user.id)
        .maybeSingle();

      if (folderError) {
        throw new Error(folderError.message);
      }
      if (!targetFolder) {
        return NextResponse.json(
          { error: "That folder is no longer available. Refresh and try again." },
          { status: 404 }
        );
      }
      patch = { ...patch, folder_id: body.folderId };
    } else if (action === "trash") {
      patch = { ...patch, trashed_at: now };
    } else if (action === "restore") {
      patch = { ...patch, trashed_at: null };
    }

    const { data, error } = await supabase
      .from("ingestion_runs")
      .update(patch)
      .eq("id", runId)
      .eq("owner_user_id", user.id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to update library file.");
    }

    return NextResponse.json({ run: data });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update library file.";
    return NextResponse.json(
      { error: message },
      { status: message === "Folder not found." ? 404 : 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { runId } = await params;
    const body = (await request.json()) as { action?: "copy" | "open" };
    const action = body.action;
    if (!action) {
      return NextResponse.json({ error: "Action is required." }, { status: 400 });
    }

    if (getDatabaseProvider() === "cloud-sql") {
      if (action === "copy") {
        const run = await cloudSqlLibraryRepository.copyRun(user.id, runId);
        return NextResponse.json({ run }, { status: 201 });
      }

      const run = await cloudSqlLibraryRepository.getRun(user.id, runId);
      if (!run) {
        return NextResponse.json({ error: "File not found." }, { status: 404 });
      }
      const inputPayload =
        run.input_payload && typeof run.input_payload === "object" && !Array.isArray(run.input_payload)
          ? run.input_payload
          : {};
      const driveWebViewLink =
        typeof inputPayload.drive_web_view_link === "string"
          ? inputPayload.drive_web_view_link
          : null;
      if (driveWebViewLink) {
        return NextResponse.json({ url: driveWebViewLink });
      }

      const sourcePath = String(run.source_path ?? "").trim();
      if (!sourcePath) {
        throw new Error("File path is unavailable for this item.");
      }
      const objectName = sourcePath.startsWith("gs://")
        ? sourcePath.slice(5).split("/").slice(1).join("/")
        : sourcePath.replace(/^\/+/, "");
      if (!objectName) {
        throw new Error("The stored cloud object path is invalid.");
      }
      const signedUrl = await createGcsSignedReadUrl({ objectName, expiresMinutes: 60 });
      return NextResponse.json({ url: signedUrl });
    }

    const supabase = getSupabaseAdmin();
    const { data: original, error: originalError } = await supabase
      .from("ingestion_runs")
      .select("*")
      .eq("id", runId)
      .eq("owner_user_id", user.id)
      .single();

    if (originalError || !original) {
      throw new Error(originalError?.message ?? "File not found.");
    }

    if (action === "copy") {
      const displayName =
        String((original as { display_name?: string | null }).display_name ?? "") ||
        String((original as { source_filename?: string | null }).source_filename ?? "File");

      const { data: copy, error: copyError } = await supabase
        .from("ingestion_runs")
        .insert({
          owner_user_id: user.id,
          folder_id: (original as { folder_id?: string | null }).folder_id ?? null,
          source_type: (original as { source_type?: string }).source_type ?? "upload",
          status: (original as { status?: string }).status ?? "queued",
          source_filename:
            (original as { source_filename?: string | null }).source_filename ?? null,
          display_name: `${displayName} copy`,
          source_path: (original as { source_path?: string | null }).source_path ?? null,
          source_extension:
            (original as { source_extension?: string | null }).source_extension ?? null,
          mime_type: (original as { mime_type?: string | null }).mime_type ?? null,
          file_size_bytes:
            (original as { file_size_bytes?: number | null }).file_size_bytes ?? null,
          provider: (original as { provider?: string | null }).provider ?? null,
          model: (original as { model?: string | null }).model ?? null,
          is_favorite: false,
          copied_from_run_id: runId,
          input_payload:
            (original as { input_payload?: Record<string, unknown> | null }).input_payload ??
            {},
        })
        .select("*")
        .single();

      if (copyError || !copy) {
        throw new Error(copyError?.message ?? "Failed to copy file.");
      }

      return NextResponse.json({ run: copy }, { status: 201 });
    }

    const inputPayload =
      (original as { input_payload?: Record<string, unknown> | null }).input_payload ?? {};
    const driveWebViewLink =
      typeof inputPayload.drive_web_view_link === "string"
        ? inputPayload.drive_web_view_link
        : null;

    if (driveWebViewLink) {
      return NextResponse.json({ url: driveWebViewLink });
    }

    const sourcePath = (original as { source_path?: string | null }).source_path;
    if (!sourcePath) {
      throw new Error("File path is unavailable for this item.");
    }

    const { data: signed, error: signedError } = await supabase.storage
      .from("paper-uploads")
      .createSignedUrl(sourcePath, 60 * 60);

    if (signedError || !signed?.signedUrl) {
      throw new Error(signedError?.message ?? "Failed to open file.");
    }

    return NextResponse.json({ url: signed.signedUrl });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to open library file.",
      },
      { status: 500 }
    );
  }
}
