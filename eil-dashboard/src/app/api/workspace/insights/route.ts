import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { withAiTokenUsageTracking } from "@/lib/ai-token-usage";
import { summarizeSpend } from "@/lib/answer-cost";
import { createChatCompletionResult } from "@/lib/openai";
import { buildInsightsForRequest, readCachedPlan, writeCachedPlan } from "@/lib/insights/server";
import { buildInsightMessages, checkPlan, computedPlan, insightTool } from "@/lib/insights/plan";
import type { InsightPlan } from "@/lib/insights/types";
import {
  assertAiTokenBudget,
  assertAndRecordAiUsage,
  GuardError,
  persistAiTokenUsage,
} from "@/lib/security-guards";

export const runtime = "nodejs";

const RequestSchema = z.object({
  projectId: z.string().uuid(),
  selectedYears: z.array(z.string().max(12)).max(80).default([]),
  selectedTracks: z.array(z.string().max(80)).max(40).default([]),
  searchQuery: z.string().max(500).default(""),
  /** "auto": the cached written plan if there is one, else the computed one - never a model call. */
  mode: z.enum(["auto", "write"]).default("auto"),
  /** With "write": ignore a cached plan and write a new one. */
  refresh: z.boolean().default(false),
  fresh: z.boolean().default(false),
});

const TASK = "ADAPTIVE_INSIGHTS";

function parseToolArguments(raw: string | undefined | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

/*
 * The Adaptive tab's insights for the selected papers.
 *
 * Opening the tab is free: the insights are computed, and a plan a model
 * already wrote for exactly these papers is read from the cache. A model is
 * called only when the reader asks for the page to be written up ("write"),
 * once per selection until the papers change or they ask again.
 */
export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Sign in to see insights." }, { status: 401 });

  const parsed = RequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Malformed insights request." }, { status: 400 });
  const body = parsed.data;

  let built;
  try {
    built = await buildInsightsForRequest({
      ownerUserId: user.id,
      projectId: body.projectId,
      selectedYears: body.selectedYears,
      selectedTracks: body.selectedTracks,
      searchQuery: body.searchQuery,
      fresh: body.fresh,
    });
  } catch (error) {
    console.error("insights_build_failed", { message: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ error: "The insights could not be worked out just now. Try again in a moment." }, { status: 503 });
  }
  const { report } = built;
  const cached = body.refresh ? null : await readCachedPlan(user.id, built, body.projectId).catch(() => null);
  const respond = (plan: InsightPlan, extra: Record<string, unknown> = {}) =>
    NextResponse.json({ report, plan, cached: plan === cached && Boolean(cached), ...extra }, { headers: { "Cache-Control": "no-store" } });

  if (cached) return respond(cached);
  if (body.mode === "auto" || report.insights.length === 0) return respond(computedPlan(report));

  try {
    await assertAiTokenBudget(user.id);
    await assertAndRecordAiUsage(user.id, "chart", { route: "insights" });
  } catch (error) {
    if (error instanceof GuardError) {
      return respond(computedPlan(report), { notice: error.message });
    }
    throw error;
  }

  const { plan, usage } = await withAiTokenUsageTracking(async (usage) => {
    try {
      const result = await createChatCompletionResult(
        buildInsightMessages(report, built.context),
        0.2,
        undefined,
        TASK,
        {
          maxTokens: 1200,
          tools: [insightTool(report)],
          toolChoice: { type: "function", function: { name: "write_insights_page" } },
          parallelToolCalls: false,
          timeoutMs: 25_000,
        }
      );
      if (!result) return { plan: computedPlan(report), usage };
      const call = result.toolCalls.find((entry) => entry.function?.name === "write_insights_page");
      const raw = parseToolArguments(call?.function?.arguments ?? result.content);
      return { plan: checkPlan(raw, report, result.model ?? "unknown"), usage };
    } catch (error) {
      console.warn("insights_model_failed", { message: error instanceof Error ? error.message : "unknown_error" });
      return { plan: computedPlan(report), usage };
    }
  });

  const { checks, ...shownPlan } = plan;
  if (usage.totalTokens > 0) {
    const spend = summarizeSpend(usage.byModel);
    console.info("insights_spend", JSON.stringify({ usd: spend.usd, totalTokens: usage.totalTokens, calls: usage.calls, byModel: spend.byModel, corrected: plan.corrected ?? 0, checks: checks ?? [] }));
    await persistAiTokenUsage(user.id, usage, "insights").catch((error) => {
      console.error("insights_token_usage_persist_failed", { message: error instanceof Error ? error.message : "unknown_error" });
    });
  }
  if (shownPlan.source === "model") {
    await writeCachedPlan(user.id, built, body.projectId, shownPlan).catch((error) => {
      console.warn("insights_cache_write_failed", { message: error instanceof Error ? error.message : "unknown_error" });
    });
    return respond(shownPlan);
  }
  return respond(shownPlan, { notice: "The write-up could not be made just now, so the computed insights are shown." });
}
