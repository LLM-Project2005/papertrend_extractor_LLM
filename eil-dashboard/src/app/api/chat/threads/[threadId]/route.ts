import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { getWorkspaceThreadDetail } from "@/lib/chat-store";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: { threadId: string } }
) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { threadId } = context.params;
    const supabase = getSupabaseAdmin();
    const detail = await getWorkspaceThreadDetail(supabase, user.id, threadId);
    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load chat thread.",
      },
      { status: 500 }
    );
  }
}
