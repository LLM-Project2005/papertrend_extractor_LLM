import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { listWorkspaceThreads } from "@/lib/chat-store";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const folderId = url.searchParams.get("folderId");
    const supabase = getSupabaseAdmin();
    const threads = await listWorkspaceThreads(supabase, user.id, folderId);
    return NextResponse.json({ threads });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load chat threads.",
      },
      { status: 500 }
    );
  }
}
