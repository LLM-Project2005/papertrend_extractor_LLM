import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { getWorkspaceRepository } from "@/lib/workspace-repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");

    const projects = await getWorkspaceRepository().listProjects(user.id, organizationId);
    return NextResponse.json({ projects });
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

    const project = await getWorkspaceRepository().createProject(
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

    const patch: { name: string; description?: string | null } = {
      name: body.name.trim(),
    };
    if (body.description !== undefined) {
      patch.description = body.description;
    }

    const project = await getWorkspaceRepository().updateProject(
      user.id,
      body.projectId.trim(),
      patch
    );
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    return NextResponse.json({ project });
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
