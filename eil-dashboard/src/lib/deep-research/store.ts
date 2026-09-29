/*
 * Where a run lives: the existing deep_research_sessions and
 * deep_research_steps tables, owner-scoped, with no schema change.
 *
 * Two things differ from the old worker's use of them:
 *
 *  - A run never passes through 'queued' or 'waiting_on_analysis'. The Python
 *    research worker claims every 'queued' session, so a v2 run goes straight
 *    to 'processing' and is held by a lease: its updated_at, refreshed while
 *    it runs. A lease older than LEASE_SECONDS is free, so a run whose worker
 *    died is picked up again by a retry or by the next reader who opens it.
 *  - Planning a new question in a thread adds a session instead of replacing
 *    the last one, so earlier reports stay in the conversation.
 */
import { createHash } from "node:crypto";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import { ENGINE, isV2Session, type ResearchPlan } from "@/lib/deep-research/types";
import type { DeepResearchSessionRecord, DeepResearchStepRecord } from "@/types/research";

export const LEASE_SECONDS = 75;

export type StepTool = "dr2_gather" | "dr2_write" | "dr2_check";

export interface ResearchScope {
  kind: string;
  projectId: string | null;
  folderId: string | null;
  runIds: string[];
}

function stableUuid(value: string): string {
  const bytes = Buffer.from(createHash("sha256").update(value).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export { isV2Session };

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

function mapStep(row: Record<string, unknown>): DeepResearchStepRecord {
  return {
    ...(row as unknown as DeepResearchStepRecord),
    input_payload: row.input_payload && typeof row.input_payload === "object" ? (row.input_payload as DeepResearchStepRecord["input_payload"]) : {},
    output_payload: row.output_payload && typeof row.output_payload === "object" ? (row.output_payload as DeepResearchStepRecord["output_payload"]) : {},
    created_at: iso(row.created_at) ?? "",
    updated_at: iso(row.updated_at) ?? "",
  } as DeepResearchStepRecord;
}

function mapSession(row: Record<string, unknown>, steps: DeepResearchStepRecord[]): DeepResearchSessionRecord {
  return {
    ...(row as unknown as DeepResearchSessionRecord),
    created_at: iso(row.created_at) ?? "",
    updated_at: iso(row.updated_at) ?? "",
    completed_at: iso(row.completed_at),
    steps,
  } as DeepResearchSessionRecord;
}

type Client = Parameters<Parameters<typeof withCloudSqlOwnerTransaction>[1]>[0];

async function load(client: Client, ownerUserId: string, sessionId: string): Promise<DeepResearchSessionRecord | null> {
  const session = await client.query<Record<string, unknown>>(`SELECT * FROM public.deep_research_sessions WHERE id=$1 AND owner_user_id=$2 LIMIT 1`, [sessionId, ownerUserId]);
  if (!session.rows[0]) return null;
  const steps = await client.query<Record<string, unknown>>(
    `SELECT * FROM public.deep_research_steps WHERE session_id=$1 AND owner_user_id=$2 ORDER BY position ASC`,
    [sessionId, ownerUserId]
  );
  return mapSession(session.rows[0], steps.rows.map(mapStep));
}

export function loadSession(ownerUserId: string, sessionId: string): Promise<DeepResearchSessionRecord | null> {
  return withCloudSqlOwnerTransaction(ownerUserId, (client) => load(client, ownerUserId, sessionId));
}

/** The thread's newest session, if it is a v2 plan not yet started. */
export async function latestPlannedSession(ownerUserId: string, threadId: string): Promise<DeepResearchSessionRecord | null> {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const row = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM public.deep_research_sessions WHERE thread_id=$1 AND owner_user_id=$2 ORDER BY created_at DESC LIMIT 1`,
      [threadId, ownerUserId]
    );
    if (!row.rows[0] || row.rows[0].status !== "planned") return null;
    const session = await load(client, ownerUserId, row.rows[0].id);
    return isV2Session(session) ? session : null;
  });
}

/** Saves a plan: a new session, or the thread's unstarted one re-planned. */
export async function savePlan(input: {
  ownerUserId: string;
  threadId: string;
  replaceSessionId?: string | null;
  prompt: string;
  plan: ResearchPlan;
  summary: string;
  scope: ResearchScope;
  model: string | null;
}): Promise<DeepResearchSessionRecord> {
  return withCloudSqlOwnerTransaction(input.ownerUserId, async (client) => {
    let sessionId = input.replaceSessionId ?? null;
    if (sessionId) {
      const updated = await client.query(
        `UPDATE public.deep_research_sessions SET prompt=$3, plan_summary=$4, final_report=NULL, last_error=NULL,
           requires_analysis=false, pending_run_count=0, updated_at=now()
         WHERE id=$1 AND owner_user_id=$2 AND status='planned'`,
        [sessionId, input.ownerUserId, input.prompt, input.summary]
      );
      if (updated.rowCount === 0) sessionId = null;
      else await client.query(`DELETE FROM public.deep_research_steps WHERE session_id=$1 AND owner_user_id=$2`, [sessionId, input.ownerUserId]);
    }
    if (!sessionId) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO public.deep_research_sessions (thread_id, owner_user_id, folder_id, status, prompt, plan_summary)
         SELECT $1, $2, $3, 'planned', $4, $5
         WHERE EXISTS (SELECT 1 FROM public.workspace_threads WHERE id=$1 AND owner_user_id=$2)
         RETURNING id`,
        [input.threadId, input.ownerUserId, input.scope.folderId, input.prompt, input.summary]
      );
      if (!inserted.rows[0]) throw new Error("Chat thread not found.");
      sessionId = inserted.rows[0].id;
    }
    const steps: Array<{ title: string; description: string; tool: StepTool; input: Record<string, unknown> }> = [
      ...input.plan.questions.map((question) => ({
        title: question.question,
        description: question.purpose,
        tool: "dr2_gather" as const,
        input: { engine: ENGINE, question },
      })),
      {
        title: /thai|ไทย/i.test(input.plan.language) ? "เขียนรายงาน" : "Write the report",
        description: /thai|ไทย/i.test(input.plan.language) ? "เรียบเรียงข้อค้นพบพร้อมอ้างอิงแหล่งที่มาทุกข้อ" : "Bring the findings together, citing a source for every claim.",
        tool: "dr2_write",
        input: { engine: ENGINE, plan: input.plan, scope: input.scope, readerQuestion: input.prompt, model: input.model },
      },
      {
        title: /thai|ไทย/i.test(input.plan.language) ? "ตรวจทุกข้ออ้างกับแหล่งที่มา" : "Check every claim against its source",
        description: /thai|ไทย/i.test(input.plan.language) ? "ข้อความที่แหล่งที่มาไม่สนับสนุนจะถูกแก้หรือนำออก" : "A sentence its source does not support is corrected or removed.",
        tool: "dr2_check",
        input: { engine: ENGINE },
      },
    ];
    for (const [index, step] of steps.entries()) {
      await client.query(
        `INSERT INTO public.deep_research_steps (session_id, owner_user_id, position, title, description, tool_name, status, input_payload, output_payload)
         VALUES ($1,$2,$3,$4,$5,$6,'planned',$7::jsonb,'{}'::jsonb)`,
        [sessionId, input.ownerUserId, index + 1, step.title.slice(0, 500), step.description.slice(0, 1_000), step.tool, JSON.stringify(step.input)]
      );
    }
    await client.query(
      `UPDATE public.workspace_threads SET title=COALESCE(NULLIF(title,''), $3), summary=$4, updated_at=now() WHERE id=$1 AND owner_user_id=$2`,
      [input.threadId, input.ownerUserId, input.plan.title.slice(0, 200), `Research plan: ${input.plan.title}`.slice(0, 240)]
    );
    const session = await load(client, input.ownerUserId, sessionId);
    if (!session) throw new Error("Deep research session not found.");
    return session;
  });
}

/**
 * Starts (or resumes after a failure or a cancel) a run. The lease is left
 * just expired, so the first worker to arrive claims it.
 */
export async function startSession(ownerUserId: string, sessionId: string): Promise<{ started: boolean; firstStart: boolean }> {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const current = await client.query<{ status: string }>(
      `SELECT status FROM public.deep_research_sessions WHERE id=$1 AND owner_user_id=$2 FOR UPDATE`,
      [sessionId, ownerUserId]
    );
    const previous = current.rows[0]?.status;
    if (!previous || !["planned", "failed", "canceled"].includes(previous)) return { started: false, firstStart: false };
    await client.query(
      `UPDATE public.deep_research_sessions SET status='processing', last_error=NULL, completed_at=NULL,
         updated_at=now() - make_interval(secs => $3)
       WHERE id=$1 AND owner_user_id=$2`,
      [sessionId, ownerUserId, LEASE_SECONDS + 1]
    );
    // A failed or canceled step is tried again; finished ones are kept.
    await client.query(
      `UPDATE public.deep_research_steps SET status='planned', updated_at=now()
       WHERE session_id=$1 AND owner_user_id=$2 AND status IN ('processing','failed')`,
      [sessionId, ownerUserId]
    );
    return { started: true, firstStart: previous === "planned" };
  });
}

/** Takes the lease if it is free. */
export async function claimSession(ownerUserId: string, sessionId: string): Promise<DeepResearchSessionRecord | null> {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const claimed = await client.query(
      `UPDATE public.deep_research_sessions SET updated_at=now()
       WHERE id=$1 AND owner_user_id=$2 AND status='processing' AND updated_at < now() - make_interval(secs => $3)
       RETURNING id`,
      [sessionId, ownerUserId, LEASE_SECONDS]
    );
    return claimed.rows[0] ? load(client, ownerUserId, sessionId) : null;
  });
}

/** Keeps the lease; false once the run was canceled or finished elsewhere. */
export async function heartbeat(ownerUserId: string, sessionId: string): Promise<boolean> {
  const result = await withCloudSqlOwnerTransaction(ownerUserId, (client) =>
    client.query(`UPDATE public.deep_research_sessions SET updated_at=now() WHERE id=$1 AND owner_user_id=$2 AND status='processing'`, [sessionId, ownerUserId])
  );
  return (result.rowCount ?? 0) > 0;
}

/** Hands the lease back at once, so a retry need not wait for it to expire. */
export async function releaseLease(ownerUserId: string, sessionId: string): Promise<void> {
  await withCloudSqlOwnerTransaction(ownerUserId, (client) =>
    client.query(`UPDATE public.deep_research_sessions SET updated_at=now() - make_interval(secs => $3) WHERE id=$1 AND owner_user_id=$2 AND status='processing'`, [sessionId, ownerUserId, LEASE_SECONDS + 1])
  );
}

export async function sessionStatus(ownerUserId: string, sessionId: string): Promise<string | null> {
  const result = await withCloudSqlOwnerTransaction(ownerUserId, (client) =>
    client.query<{ status: string }>(`SELECT status FROM public.deep_research_sessions WHERE id=$1 AND owner_user_id=$2`, [sessionId, ownerUserId])
  );
  return result.rows[0]?.status ?? null;
}

export async function saveStep(
  ownerUserId: string,
  stepId: string,
  status: "processing" | "completed" | "failed",
  output: Record<string, unknown>
): Promise<void> {
  await withCloudSqlOwnerTransaction(ownerUserId, (client) =>
    client.query(`UPDATE public.deep_research_steps SET status=$3, output_payload=$4::jsonb, updated_at=now() WHERE id=$1 AND owner_user_id=$2`, [
      stepId,
      ownerUserId,
      status,
      JSON.stringify({ engine: ENGINE, ...output }),
    ])
  );
}

export async function cancelSession(ownerUserId: string, sessionId: string): Promise<boolean> {
  const result = await withCloudSqlOwnerTransaction(ownerUserId, (client) =>
    client.query(
      `UPDATE public.deep_research_sessions SET status='canceled', completed_at=now(), updated_at=now()
       WHERE id=$1 AND owner_user_id=$2 AND status IN ('planned','processing')`,
      [sessionId, ownerUserId]
    )
  );
  return (result.rowCount ?? 0) > 0;
}

export async function failSession(ownerUserId: string, sessionId: string, message: string): Promise<void> {
  await withCloudSqlOwnerTransaction(ownerUserId, (client) =>
    client.query(
      `UPDATE public.deep_research_sessions SET status='failed', last_error=$3, completed_at=now(), updated_at=now()
       WHERE id=$1 AND owner_user_id=$2 AND status='processing'`,
      [sessionId, ownerUserId, message.slice(0, 1_000)]
    )
  );
}

/** Saves the report as the session's result and as a message in the thread, unless the run was canceled. */
export async function completeSession(input: {
  ownerUserId: string;
  sessionId: string;
  report: string;
  citations: unknown[];
  metadata: Record<string, unknown>;
}): Promise<boolean> {
  return withCloudSqlOwnerTransaction(input.ownerUserId, async (client) => {
    const updated = await client.query<{ thread_id: string; folder_id: string | null }>(
      `UPDATE public.deep_research_sessions SET status='completed', final_report=$3, last_error=NULL, completed_at=now(), updated_at=now()
       WHERE id=$1 AND owner_user_id=$2 AND status='processing'
       RETURNING thread_id, folder_id`,
      [input.sessionId, input.ownerUserId, input.report]
    );
    const row = updated.rows[0];
    if (!row) return false;
    await client.query(
      `INSERT INTO public.workspace_messages (id, thread_id, owner_user_id, folder_id, role, message_kind, content, citations, metadata, updated_at)
       VALUES ($1,$2,$3,$4,'assistant','deep_research_report',$5,$6::jsonb,$7::jsonb,now())
       ON CONFLICT (id) DO UPDATE SET content=EXCLUDED.content, citations=EXCLUDED.citations, metadata=EXCLUDED.metadata, updated_at=now()`,
      [
        stableUuid(`papertrend:deep-research-v2:report:${input.sessionId}`),
        row.thread_id,
        input.ownerUserId,
        row.folder_id,
        input.report,
        JSON.stringify(input.citations),
        JSON.stringify({ ...input.metadata, sessionId: input.sessionId, engine: ENGINE }),
      ]
    );
    await client.query(`UPDATE public.workspace_threads SET summary=$3, updated_at=now() WHERE id=$1 AND owner_user_id=$2`, [
      row.thread_id,
      input.ownerUserId,
      input.report.replace(/^#+\s.*$/gm, "").replace(/\s+/g, " ").trim().slice(0, 240),
    ]);
    return true;
  });
}

/**
 * Claims the right to re-queue a stalled run: the lease is left just expired
 * (so the new task can take it) and the run stops looking stale for a minute,
 * so a page polling every few seconds queues it once, not every time.
 */
export async function markRequeued(ownerUserId: string, sessionId: string): Promise<boolean> {
  const result = await withCloudSqlOwnerTransaction(ownerUserId, (client) =>
    client.query(
      `UPDATE public.deep_research_sessions SET updated_at=now() - make_interval(secs => $3)
       WHERE id=$1 AND owner_user_id=$2 AND status='processing' AND updated_at < now() - make_interval(secs => $4)`,
      [sessionId, ownerUserId, LEASE_SECONDS + 1, LEASE_SECONDS + 60]
    )
  );
  return (result.rowCount ?? 0) > 0;
}

/** A run whose worker has gone quiet: processing, and the lease long expired. */
export function isStale(session: Pick<DeepResearchSessionRecord, "status" | "updated_at">, now = Date.now()): boolean {
  if (session.status !== "processing") return false;
  const updated = Date.parse(String(session.updated_at ?? ""));
  // Started runs begin just past the lease, so this is about a minute with no worker.
  return Number.isFinite(updated) && now - updated > (LEASE_SECONDS + 60) * 1_000;
}
