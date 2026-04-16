import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { ensureWorkspaceOrganization } from "@/lib/workspace-organizations";
import type { WorkspaceOrganizationRow } from "@/types/database";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("workspace_organizations")
      .select("*")
      .eq("owner_user_id", user.id)
      .order("name", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ organizations: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load organizations.",
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
        { error: "Organization name is required." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const organization = await ensureWorkspaceOrganization(
      supabase,
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
            : "Failed to create organization.",
      },
      { status: 500 }
    );
  }
}
