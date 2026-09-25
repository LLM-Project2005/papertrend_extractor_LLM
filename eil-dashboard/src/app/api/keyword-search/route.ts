import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { runKeywordSearchFallback } from "@/lib/keyword-search-fallback";
import { GuardError, countInMemory, hashSubject } from "@/lib/security-guards";
import type { KeywordSearchRequest } from "@/types/keyword-search";

export const runtime = "nodejs";
const SEARCHES_PER_MINUTE = 120;

const KeywordSearchSchema = z
  .object({
    query: z.string().max(1_000).optional(),
    folderId: z.string().max(80).optional(),
    projectId: z.string().max(80).optional(),
    selectedYears: z.array(z.string().max(20)).max(80).optional(),
    selectedTracks: z.array(z.string().max(80)).max(20).optional(),
  })
  .passthrough();

export async function POST(request: Request) {
  try {
    const parsed = KeywordSearchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Malformed keyword search request." }, { status: 400 });
    }
    const body = parsed.data as KeywordSearchRequest;
    const user = await getAuthenticatedUserFromRequest(request);
    const ownerUserId = user?.id ?? null;
    if (!ownerUserId) {
      return NextResponse.json({ error: "Sign in to search workspace keywords." }, { status: 401 });
    }
    const query = body.query?.trim();
    if (!query) {
      return NextResponse.json({ error: "Query is required." }, { status: 400 });
    }
    // Concept search runs in the database with no model call, so it no longer
    // spends the chat allowance (it used to, on every pause in typing). A plain
    // rate limit keeps it from being hammered.
    if (countInMemory(hashSubject(`keyword-search:${ownerUserId}`), 60_000, Date.now()) > SEARCHES_PER_MINUTE) {
      return NextResponse.json({ error: "Too many searches at once. Wait a moment and try again." }, { status: 429 });
    }

    const fallback = await runKeywordSearchFallback(body, ownerUserId);
    return NextResponse.json(fallback);
  } catch (error) {
    if (error instanceof GuardError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Keyword search failed." },
      { status: 500 }
    );
  }
}
