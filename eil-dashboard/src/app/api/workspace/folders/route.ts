import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { ensureResearchFolder } from "@/lib/research-folders";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    let query = supabase
      .from("research_folders")
      .select("*")
      .eq("owner_user_id", user.id)
      .order("name", { ascending: true });

    if (projectId) {
      query = query.eq("project_id", projectId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ folders: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load workspace folders.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { name?: string; projectId?: string };
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Folder name is required." }, { status: 400 });
    }
    if (!body.projectId?.trim()) {
      return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const folder = await ensureResearchFolder(
      supabase,
      user.id,
      body.projectId.trim(),
      body.name
    );
    return NextResponse.json({ folder }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create workspace folder.",
      },
      { status: 500 }
    );
  }
}
