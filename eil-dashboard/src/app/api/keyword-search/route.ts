import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { runKeywordSearchFallback } from "@/lib/keyword-search-fallback";
import type { KeywordSearchRequest } from "@/types/keyword-search";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as KeywordSearchRequest;
    const user = await getAuthenticatedUserFromRequest(request);
    const ownerUserId = user?.id ?? null;
    const query = body.query?.trim();

    if (!query) {
      return NextResponse.json({ error: "Query is required." }, { status: 400 });
    }

    const fallback = await runKeywordSearchFallback(body, ownerUserId);
    return NextResponse.json(fallback);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Keyword search failed." },
      { status: 500 }
    );
  }
}
