import { NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function sanitizeFolderName(folderName: string): string {
  const sanitized = folderName.replace(/[^a-zA-Z0-9._/-]+/g, "-").replace(/^\/+|\/+$/g, "");
  return sanitized || "Inbox";
}

export async function GET(request: Request) {
  if (!(await isAuthorizedAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("ingestion_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(25);

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
    const formData = await request.formData();
    const provider = String(formData.get("provider") ?? "") || null;
    const model = String(formData.get("model") ?? "") || null;
    const folder = sanitizeFolderName(String(formData.get("folder") ?? "Inbox"));
    const sourceKind = String(formData.get("source_kind") ?? "pdf-upload") || "pdf-upload";
    const files = formData
      .getAll("files")
      .filter((item): item is File => item instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "Upload at least one PDF file." }, { status: 400 });
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
          source_type: "upload",
          status: "queued",
          source_filename: file.name,
          provider,
          model,
          input_payload: {
            uploaded_from: "/workspace/imports",
            folder_name: folder,
            source_kind: sourceKind,
            original_size: file.size,
            mime_type: file.type || "application/pdf",
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
      provider,
      hasModel: Boolean(model),
    });
    return NextResponse.json({ runs: createdRuns }, { status: 201 });
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
