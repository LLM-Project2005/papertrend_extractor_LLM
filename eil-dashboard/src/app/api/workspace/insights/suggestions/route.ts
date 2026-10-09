import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { withAiTokenUsageTracking } from "@/lib/ai-token-usage";
import { summarizeSpend } from "@/lib/answer-cost";
import { createChatCompletionResult } from "@/lib/openai";
import { buildInsightsForRequest } from "@/lib/insights/server";
import { answerableQueries, applyWordings, wordingMessages, type SuggestedQuestion } from "@/lib/insights/suggestions";
import { assertAiTokenBudget, persistAiTokenUsage } from "@/lib/security-guards";

export const runtime = "nodejs";

const RequestSchema = z.object({
  projectId: z.string().uuid(),
  selectedYears: z.array(z.string().max(12)).max(80).default([]),
  selectedTracks: z.array(z.string().max(80)).max(40).default([]),
  searchQuery: z.string().max(500).default(""),
});

/** Worded examples by owner, selection and views, so reopening the tab costs nothing. */
const CACHE = new Map<string, { at: number; suggestions: SuggestedQuestion[] }>();
const CACHE_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 200;

/*
 * Example questions these papers can answer, for the Adaptive tab's ask box
 * (src/lib/insights/suggestions.ts). Every example's view is computed and
 * checked before it is offered; one short model call words them, and when
 * that call is not possible or not trusted, plain wording stands in.
 */
export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = RequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const body = parsed.data;

  let built;
  try {
    built = await buildInsightsForRequest({ ownerUserId: user.id, ...body });
  } catch (error) {
    console.error("insights_suggestions_build_failed", { message: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ error: "The papers could not be read just now." }, { status: 503 });
  }
  if (built.corpus.papers.length < 3) return NextResponse.json({ suggestions: [] });

  const queries = answerableQueries(built.corpus);
  if (queries.length === 0) return NextResponse.json({ suggestions: [] });
  const key = createHash("sha256").update(JSON.stringify([user.id, body, queries, built.corpus.papers.length])).digest("hex");
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json({ suggestions: cached.suggestions }, { headers: { "Cache-Control": "no-store" } });
  }

  let raw: unknown = null;
  try {
    await assertAiTokenBudget(user.id);
    const { usage } = await withAiTokenUsageTracking(async (usage) => {
      try {
        const result = await createChatCompletionResult(
          wordingMessages(queries, built.context.selection ?? "the whole repository"),
          0,
          undefined,
          "ADAPTIVE_INSIGHTS",
          { maxTokens: 500, jsonObject: true, timeoutMs: 15_000 }
        );
        raw = JSON.parse(result?.content ?? "null");
      } catch (error) {
        console.warn("insights_suggestions_wording_failed", { message: error instanceof Error ? error.message : "unknown_error" });
      }
      return { usage };
    });
    if (usage.totalTokens > 0) {
      const spend = summarizeSpend(usage.byModel);
      console.info("insights_suggestions_spend", JSON.stringify({ usd: spend.usd, totalTokens: usage.totalTokens }));
      await persistAiTokenUsage(user.id, usage, "insights").catch(() => undefined);
    }
  } catch {
    // Over a limit, or the limit could not be read: the plain wording still works.
  }

  const suggestions = applyWordings(queries, raw);
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string);
  CACHE.set(key, { at: Date.now(), suggestions });
  return NextResponse.json({ suggestions }, { headers: { "Cache-Control": "no-store" } });
}
