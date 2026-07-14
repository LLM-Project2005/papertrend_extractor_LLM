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
    const projectId = searchParams.get("projectId");
    const folders = await getWorkspaceRepository().listFolders(user.id, projectId);
    return NextResponse.json({ folders });
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

    const folder = await getWorkspaceRepository().ensureFolder(
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

export async function PATCH(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { folderId?: string; name?: string };
    if (!body.folderId?.trim()) {
      return NextResponse.json({ error: "folderId is required." }, { status: 400 });
    }
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Folder name is required." }, { status: 400 });
    }

    const folder = await getWorkspaceRepository().updateFolder(
      user.id,
      body.folderId.trim(),
      body.name.trim()
    );
    if (!folder) {
      return NextResponse.json({ error: "Folder not found." }, { status: 404 });
    }

    return NextResponse.json({ folder });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to rename folder.",
      },
      { status: 500 }
    );
  }
}
