import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { getChatRepository } from "@/lib/chat-repository";
import { projectIdFromScopeMetadata } from "@/lib/knowledge-scope";

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
    const detail = await getChatRepository().getThreadDetail(user.id, threadId);
    const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
    if (projectId) {
      const belongsToProject = detail.messages.some((message) =>
        projectIdFromScopeMetadata(message.metadata) === projectId
      );
      if (!belongsToProject) {
        return NextResponse.json(
          { error: "This chat belongs to a different repository." },
          { status: 404 }
        );
      }
    }
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
  context: { params: { threadId: string } }
) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { threadId } = context.params;
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
