import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { createWorkspaceProject } from "@/lib/workspace-organizations";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) {
      return NextResponse.json({ projects: [] });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("workspace_projects")
      .select("*")
      .eq("owner_user_id", user.id)
      .eq("organization_id", organizationId)
      .order("name", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ projects: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load projects.",
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
    const body = (await request.json()) as {
      organizationId?: string;
      name?: string;
      description?: string | null;
    };

    if (!body.organizationId?.trim()) {
      return NextResponse.json(
        { error: "organizationId is required." },
        { status: 400 }
      );
    }
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Project name is required." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const project = await createWorkspaceProject(
      supabase,
      user.id,
      body.organizationId.trim(),
      body.name,
      body.description ?? null
    );

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create project.",
      },
      { status: 500 }
    );
  }
}
