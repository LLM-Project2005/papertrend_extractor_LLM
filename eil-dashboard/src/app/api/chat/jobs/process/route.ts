import { NextResponse } from "next/server";
import { z } from "zod";
import { runRepositoryChat } from "@/lib/repository-chat";
import {
  claimRepositoryChatJob,
  completeRepositoryChatJob,
  failRepositoryChatJob,
  isRepositoryJobSecretValid,
} from "@/lib/repository-chat-jobs";

const BodySchema = z.object({ jobId: z.string().uuid(), ownerUserId: z.string().uuid() });

export async function POST(request: Request) {
  if (!isRepositoryJobSecretValid(request.headers.get("x-worker-secret") ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid job request" }, { status: 400 });
  const job = await claimRepositoryChatJob(parsed.data.ownerUserId, parsed.data.jobId);
  if (!job) return NextResponse.json({ ok: true, skipped: true });
  try {
    const plan = job.executionPlan;
    const result = await runRepositoryChat({
      ownerUserId: job.ownerUserId,
      threadId: typeof plan.threadId === "string" ? plan.threadId : null,
      projectId: String(plan.projectId ?? ""),
      folderId: typeof plan.folderId === "string" ? plan.folderId : null,
      selectedRunIds: Array.isArray(plan.selectedRunIds) ? plan.selectedRunIds.map(String) : [],
      prompt: String(plan.prompt ?? ""),
      model: typeof plan.model === "string" ? plan.model : undefined,
      bypassAsyncJob: true,
    });
    await completeRepositoryChatJob(job.ownerUserId, job.id, result);
    return NextResponse.json({ ok: true });
  } catch (error) {
    await failRepositoryChatJob(job.ownerUserId, job.id, error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
