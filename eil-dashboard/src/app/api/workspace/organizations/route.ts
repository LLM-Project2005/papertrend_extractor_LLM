import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { getWorkspaceRepository } from "@/lib/workspace-repository";
import type { WorkspaceOrganizationRow } from "@/types/database";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const organizations = await getWorkspaceRepository().listOrganizations(user.id);
    return NextResponse.json({ organizations });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load workspaces.",
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
      name?: string;
      type?: WorkspaceOrganizationRow["type"];
    };

    if (!body.name?.trim()) {
      return NextResponse.json(
        { error: "Workspace name is required." },
        { status: 400 }
      );
    }

    const organization = await getWorkspaceRepository().ensureOrganization(
      user.id,
      body.name,
      body.type ?? "personal"
    );

    return NextResponse.json({ organization }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create workspace.",
      },
      { status: 500 }
    );
  }
}
