import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { getChatRepository } from "@/lib/chat-repository";
import { resumeIfStale } from "@/lib/deep-research/actions";
import { getPublicRequestOrigin } from "@/lib/public-request-origin";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ threadId: string }> }
) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { threadId } = await context.params;
    // ?before= loads the messages older than the ones already shown.
    const before = new URL(request.url).searchParams.get("before");
    const detail = await getChatRepository().getThreadDetail(user.id, threadId, {
      before: before && !Number.isNaN(Date.parse(before)) ? before : null,
    });
    // A research run whose worker went quiet is queued again by whoever opens
    // it; the run's lease keeps it to one worker.
    await resumeIfStale(user.id, detail.deepResearchSession ?? null, getPublicRequestOrigin(request)).catch(() => false);
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
  context: { params: Promise<{ threadId: string }> }
) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { threadId } = await context.params;
    const body = (await request.json()) as { title?: string; summary?: string | null };
    const title = body.title?.trim();
    if (!title) {
      return NextResponse.json({ error: "Title is required." }, { status: 400 });
    }

    const repository = getChatRepository();
    await repository.updateThread(user.id, threadId, {
      title,
      summary: body.summary ?? null,
    });
    const detail = await repository.getThreadDetail(user.id, threadId);
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
  context: { params: Promise<{ threadId: string }> }
) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { threadId } = await context.params;
    await getChatRepository().deleteThread(user.id, threadId);
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
