import { NextResponse } from "next/server";
import { z } from "zod";
import { runRepositoryChat } from "@/lib/repository-chat";
import { normalizeEffort } from "@/lib/chat-effort";
import {
  claimRepositoryChatJob,
  completeRepositoryChatJob,
  failRepositoryChatJob,
  heartbeatRepositoryChatJob,
  MAX_CHAT_JOB_ATTEMPTS,
  releaseRepositoryChatJob,
} from "@/lib/repository-chat-jobs";
import { addWebContext, webStepApplies } from "@/lib/repository-chat-web";
import type { RepositoryExecutionPlan } from "@/lib/repository-chat";
import { isVerifiedTaskCaller } from "@/lib/cloud-tasks-oidc";
import { withAiTokenUsageTracking } from "@/lib/ai-token-usage";
import { spendUsd, summarizeSpend } from "@/lib/answer-cost";
import { GuardError, persistAiTokenUsage } from "@/lib/security-guards";

export const maxDuration = 1800;

const BodySchema = z.object({ jobId: z.string().uuid(), ownerUserId: z.string().uuid() });

export async function POST(request: Request) {
  // Only this service's own Cloud Tasks, by Google-signed identity token.
  if (!(await isVerifiedTaskCaller(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid job request" }, { status: 400 });
  const job = await claimRepositoryChatJob(parsed.data.ownerUserId, parsed.data.jobId);
  if (!job) {
    return NextResponse.json({ ok: true, skipped: true });
  }
  const heartbeat = setInterval(() => {
    void heartbeatRepositoryChatJob(job.ownerUserId, job.id).catch(() => undefined);
  }, 20_000);
  // A background answer spends the same credit as one written while the reader
  // waits, so it is metered the same way; it used to be recorded nowhere.
  return withAiTokenUsageTracking(async (usage) => {
    let searched = false;
    try {
      const plan = job.executionPlan;
      let result = await runRepositoryChat({
        ownerUserId: job.ownerUserId,
        threadId: typeof plan.threadId === "string" ? plan.threadId : null,
        projectId: typeof plan.projectId === "string" ? plan.projectId : null,
        folderId: typeof plan.folderId === "string" ? plan.folderId : null,
        selectedRunIds: Array.isArray(plan.selectedRunIds) ? plan.selectedRunIds.map(String) : [],
        knowledgeScope:
          plan.knowledgeScope && typeof plan.knowledgeScope === "object"
            ? plan.knowledgeScope as Parameters<typeof runRepositoryChat>[0]["knowledgeScope"]
            : undefined,
        prompt: String(plan.prompt ?? ""),
        model: typeof plan.model === "string" ? plan.model : undefined,
        allowWeb: Boolean(plan.allowWeb),
        forceChart: Boolean(plan.forceChart),
        effort: normalizeEffort(plan.effort),
        history: Array.isArray(plan.history)
          ? plan.history.filter((item): item is { role: "user" | "assistant"; content: string } =>
              Boolean(item && typeof item === "object" &&
                ((item as { role?: unknown }).role === "user" || (item as { role?: unknown }).role === "assistant") &&
                typeof (item as { content?: unknown }).content === "string"))
          : [],
        executionPlan: plan as unknown as RepositoryExecutionPlan,
        bypassAsyncJob: true,
      });
      if (Boolean(plan.allowWeb) && webStepApplies(result.execution?.operation)) {
        // Never throws: a failed web step keeps the finished repository answer.
        const web = await addWebContext({
          ownerUserId: job.ownerUserId,
          question: String(plan.prompt ?? ""),
          searchQuery: result.execution?.refinedQuestion,
          answer: result.answer,
          answerLanguage: result.execution?.answerLanguage,
          model: typeof plan.model === "string" ? plan.model : undefined,
        });
        searched = web.searched;
        result = {
          ...result,
          answer: web.answer,
          citations: [...result.citations, ...web.citations],
          limitations: [...(result.limitations ?? []), ...(web.note ? [web.note] : [])],
          diagnostics: { ...result.diagnostics, webAugmentation: web.status },
        };
      }
      await completeRepositoryChatJob(job.ownerUserId, job.id, result);
      return NextResponse.json({ ok: true });
    } catch (error) {
      // A refusal (a spending limit, say) says why and ends there. Anything
      // else - a provider timeout, a dropped connection - goes back to the
      // queue for Cloud Tasks to run again; it used to fail for good on the
      // first attempt, with the raw error shown to the reader.
      const refusal = error instanceof GuardError;
      const attempt = Number(request.headers.get("x-cloudtasks-taskretrycount") ?? "0") + 1;
      if (!refusal && attempt < MAX_CHAT_JOB_ATTEMPTS) {
        await releaseRepositoryChatJob(job.ownerUserId, job.id).catch(() => undefined);
        console.warn("repository_chat_job_retry", {
          jobId: job.id,
          attempt,
          message: error instanceof Error ? error.message.slice(0, 300) : "unknown_error",
        });
        return NextResponse.json({ ok: false, retry: true }, { status: 503 });
      }
      await failRepositoryChatJob(job.ownerUserId, job.id, error, refusal ? (error as GuardError).message : undefined);
      // Final: a success status, so Cloud Tasks does not run it again.
      return NextResponse.json({ ok: false });
    } finally {
      clearInterval(heartbeat);
      if (usage.totalTokens > 0) {
        const spend = spendUsd(usage, searched ? 1 : 0);
        console.info("chat_answer_spend", JSON.stringify({
          usd: spend.usd,
          usdSource: spend.source,
          background: true,
          totalTokens: usage.totalTokens,
          calls: usage.calls,
          byModel: summarizeSpend(usage.byModel).byModel,
        }));
        await persistAiTokenUsage(job.ownerUserId, usage, "chat-job").catch(() => undefined);
      }
    }
  });
}
