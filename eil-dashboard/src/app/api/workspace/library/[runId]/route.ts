import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

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
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update library file.",
      },
      { status: 500 }
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
