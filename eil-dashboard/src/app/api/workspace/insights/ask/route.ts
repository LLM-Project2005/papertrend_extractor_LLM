import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { withAiTokenUsageTracking } from "@/lib/ai-token-usage";
import { summarizeSpend } from "@/lib/answer-cost";
import { createChatCompletionResult } from "@/lib/openai";
import { askMessages, askTool, askVocabulary, parseAskQuery, runAskQuery } from "@/lib/insights/ask";
import { buildInsightsForRequest } from "@/lib/insights/server";
import { assertAiTokenBudget, assertAndRecordAiUsage, GuardError, persistAiTokenUsage } from "@/lib/security-guards";

export const runtime = "nodejs";

const RequestSchema = z.object({
  projectId: z.string().uuid(),
  selectedYears: z.array(z.string().max(12)).max(80).default([]),
  selectedTracks: z.array(z.string().max(80)).max(40).default([]),
  searchQuery: z.string().max(500).default(""),
  question: z.string().trim().min(3).max(300),
});

/*
 * "Ask about these papers": one small model call turns the question into a
 * query over a fixed menu; code runs it. The model's own words never reach the
 * page - the answer's title, numbers and sentence are all computed.
 */
export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Sign in to ask about your papers." }, { status: 401 });
  const parsed = RequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Ask a question of 3 to 300 characters." }, { status: 400 });
  const body = parsed.data;

  let built;
  try {
    built = await buildInsightsForRequest({
      ownerUserId: user.id,
      projectId: body.projectId,
      selectedYears: body.selectedYears,
      selectedTracks: body.selectedTracks,
      searchQuery: body.searchQuery,
    });
  } catch (error) {
    console.error("insights_ask_build_failed", { message: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ error: "The papers could not be read just now. Try again in a moment." }, { status: 503 });
  }
  if (built.corpus.papers.length < 3) {
    return NextResponse.json({ unanswerable: "Select at least 3 papers to ask about them." });
  }

  try {
    await assertAiTokenBudget(user.id);
    await assertAndRecordAiUsage(user.id, "chart", { route: "insights-ask" });
  } catch (error) {
    if (error instanceof GuardError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  const vocabulary = askVocabulary(built.corpus);
  const { query, usage } = await withAiTokenUsageTracking(async (usage) => {
    try {
      const result = await createChatCompletionResult(askMessages(body.question, vocabulary, built.context.selection ?? "the whole repository"), 0, undefined, "ADAPTIVE_INSIGHTS", {
        maxTokens: 400,
        tools: [askTool()],
        toolChoice: { type: "function", function: { name: "build_view" } },
        parallelToolCalls: false,
        timeoutMs: 20_000,
      });
      const call = result?.toolCalls.find((entry) => entry.function?.name === "build_view");
      let raw: unknown = null;
      try {
        raw = JSON.parse(call?.function?.arguments ?? result?.content ?? "null");
      } catch {
        raw = null;
      }
      return { query: parseAskQuery(raw), usage };
    } catch (error) {
      console.warn("insights_ask_model_failed", { message: error instanceof Error ? error.message : "unknown_error" });
      return { query: null, usage };
    }
  });

  if (usage.totalTokens > 0) {
    const spend = summarizeSpend(usage.byModel);
    console.info("insights_ask_spend", JSON.stringify({ usd: spend.usd, totalTokens: usage.totalTokens, byModel: spend.byModel, query }));
    await persistAiTokenUsage(user.id, usage).catch(() => undefined);
  }
  if (!query) {
    return NextResponse.json({ error: "The question could not be turned into a view just now. Try rephrasing it." }, { status: 502 });
  }
  const answer = runAskQuery(built.corpus, query);
  return NextResponse.json(answer, { headers: { "Cache-Control": "no-store" } });
}
