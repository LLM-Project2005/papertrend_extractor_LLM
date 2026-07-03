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

    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("workspace_projects")
      .select("*")
      .eq("owner_user_id", user.id)
      .order("name", { ascending: true });

    if (organizationId) {
      query = query.eq("organization_id", organizationId);
    }

    const { data, error } = await query;

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

export async function PATCH(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      projectId?: string;
      name?: string;
      description?: string | null;
    };

    if (!body.projectId?.trim()) {
      return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    }
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Project name is required." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const patch: { name: string; description?: string | null; updated_at: string } = {
      name: body.name.trim(),
      updated_at: new Date().toISOString(),
    };
    if (body.description !== undefined) {
      patch.description = body.description;
    }

    const { data, error } = await supabase
      .from("workspace_projects")
      .update(patch)
      .eq("id", body.projectId.trim())
      .eq("owner_user_id", user.id)
      .select("*")
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }
    if (!data) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    return NextResponse.json({ project: data });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to rename project.",
      },
      { status: 500 }
    );
  }
}
