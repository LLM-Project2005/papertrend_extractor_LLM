import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { getChatRepository } from "@/lib/chat-repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    // ?q= searches every conversation, messages included.
    if (query) {
      const results = await getChatRepository().searchThreads(user.id, query.slice(0, 200), 40);
      return NextResponse.json({ results });
    }
    // Otherwise a page of conversations, newest first; ?before= continues it.
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
    const before = url.searchParams.get("before");
    const validBefore = before && !Number.isNaN(Date.parse(before)) ? before : null;
    const page = await getChatRepository().listThreads(user.id, { before: validBefore, limit: limit + 1 });
    return NextResponse.json({ threads: page.slice(0, limit), hasMore: page.length > limit });
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
