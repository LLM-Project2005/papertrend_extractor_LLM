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
    const threads = await getChatRepository().listThreads(user.id);
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
