import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const includeTrashed = searchParams.get("includeTrashed") === "true";
    const logMode = searchParams.get("view") === "logs";

    const supabase = getSupabaseAdmin();
    let folderIds: string[] = [];
    if (projectId) {
      const { data: folders, error: foldersError } = await supabase
        .from("research_folders")
        .select("id")
        .eq("owner_user_id", user.id)
        .eq("project_id", projectId);

      if (foldersError) {
        throw new Error(foldersError.message);
      }

      folderIds = (folders ?? [])
        .map((row) => String((row as { id?: string | null }).id ?? ""))
        .filter(Boolean);
    }

    let query = supabase
      .from("ingestion_runs")
      .select("*")
      .eq("owner_user_id", user.id)
      .order("updated_at", { ascending: false });

    if (folderIds.length > 0) {
      query = query.in("folder_id", folderIds);
    } else if (projectId) {
      return NextResponse.json({ runs: [] });
    }

    if (!includeTrashed) {
      query = query.is("trashed_at", null);
    }

    if (logMode) {
      query = query.in("status", ["succeeded", "failed"]);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ runs: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load library files.",
      },
      { status: 500 }
    );
  }
}
