import { NextResponse } from "next/server";
import { z } from "zod";
import { isVerifiedTaskCaller } from "@/lib/cloud-tasks-oidc";
import { withAiTokenUsageTracking } from "@/lib/ai-token-usage";
import { spendUsd, summarizeSpend } from "@/lib/answer-cost";
import { persistAiTokenUsage } from "@/lib/security-guards";
import { runResearchSession } from "@/lib/deep-research/run";

export const runtime = "nodejs";
export const maxDuration = 1200;

const BodySchema = z.object({ sessionId: z.string().uuid(), ownerUserId: z.string().uuid() });

/*
 * Runs one deep research session (docs/31). Called only by this service's own
 * Cloud Tasks, with a Google-signed identity token. A failure worth retrying
 * answers 500, and Cloud Tasks tries again; the run resumes from its last
 * finished step.
 */
export async function POST(request: Request) {
  if (!(await isVerifiedTaskCaller(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid research request" }, { status: 400 });
  const retryCount = Number(request.headers.get("x-cloudtasks-taskretrycount") ?? 0) || 0;
  const { ownerUserId, sessionId } = parsed.data;
  return withAiTokenUsageTracking(async (usage) => {
    const outcome = await runResearchSession({ ownerUserId, sessionId, usage, retryCount });
    if (usage.totalTokens > 0) {
      const spend = spendUsd(usage);
      console.info("deep_research_spend", JSON.stringify({
        sessionId,
        outcome,
        usd: spend.usd,
        usdSource: spend.source,
        totalTokens: usage.totalTokens,
        calls: usage.calls,
        byModel: summarizeSpend(usage.byModel).byModel,
      }));
      // Deep research counts toward the daily token budget like every other answer.
      await persistAiTokenUsage(ownerUserId, usage).catch(() => undefined);
    }
    return NextResponse.json({ ok: outcome !== "retry", outcome }, { status: outcome === "retry" ? 500 : 200 });
  });
}
