import { NextResponse } from "next/server";
import { z } from "zod";
import { runRepositoryChat } from "@/lib/repository-chat";
import {
  claimRepositoryChatJob,
  completeRepositoryChatJob,
  failRepositoryChatJob,
  heartbeatRepositoryChatJob,
  isRepositoryJobSecretValid,
} from "@/lib/repository-chat-jobs";
import { augmentRepositoryAnswerWithWeb } from "@/lib/repository-chat-web";
import type { RepositoryExecutionPlan } from "@/lib/repository-chat";

export const maxDuration = 1800;

const BodySchema = z.object({ jobId: z.string().uuid(), ownerUserId: z.string().uuid() });

export async function POST(request: Request) {
  if (!isRepositoryJobSecretValid(request.headers.get("x-worker-secret") ?? "")) {
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
      history: Array.isArray(plan.history)
        ? plan.history.filter((item): item is { role: "user" | "assistant"; content: string } =>
            Boolean(item && typeof item === "object" &&
              ((item as { role?: unknown }).role === "user" || (item as { role?: unknown }).role === "assistant") &&
              typeof (item as { content?: unknown }).content === "string"))
        : [],
      executionPlan: plan as unknown as RepositoryExecutionPlan,
      bypassAsyncJob: true,
    });
    if (Boolean(plan.allowWeb)) {
      const augmented = await augmentRepositoryAnswerWithWeb({
        question: String(plan.prompt ?? ""),
        answer: result.answer,
        model: typeof plan.model === "string" ? plan.model : undefined,
      });
      result = {
        ...result,
        answer: augmented.answer,
        citations: [...result.citations, ...augmented.citations],
        diagnostics: { ...result.diagnostics, webAugmentation: augmented.status },
      };
    }
    await completeRepositoryChatJob(job.ownerUserId, job.id, result);
    return NextResponse.json({ ok: true });
  } catch (error) {
    await failRepositoryChatJob(job.ownerUserId, job.id, error);
    return NextResponse.json({ ok: false }, { status: 500 });
  } finally {
    clearInterval(heartbeat);
  }
}
