import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import {
  deleteWorkspaceThread,
  getWorkspaceThreadDetail,
  updateWorkspaceThread,
} from "@/lib/chat-store";
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

export async function PATCH(
  request: Request,
  context: { params: { threadId: string } }
) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { threadId } = context.params;
    const body = (await request.json()) as { title?: string; summary?: string | null };
    const title = body.title?.trim();
    if (!title) {
      return NextResponse.json({ error: "Title is required." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    await updateWorkspaceThread(supabase, threadId, {
      title,
      summary: body.summary ?? null,
    });
    const detail = await getWorkspaceThreadDetail(supabase, user.id, threadId);
    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update chat thread.",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
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
    await deleteWorkspaceThread(supabase, user.id, threadId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete chat thread.",
      },
      { status: 500 }
    );
  }
}
