import type { SupabaseClient } from "@supabase/supabase-js";
import type { PoolClient } from "pg";
import {
  appendWorkspaceMessage,
  createWorkspaceThread,
  deleteWorkspaceThread,
  getWorkspaceThreadDetail,
  listWorkspaceThreads,
  replaceDeepResearchPlan,
} from "@/lib/chat-store";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import { getDatabaseProvider } from "@/lib/server-env";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type {
  ChatThreadDetail,
  DeepResearchSessionRecord,
  DeepResearchStepRecord,
  WorkspaceMessageRecord,
  WorkspaceThreadSummary,
} from "@/types/research";

interface CreateThreadInput {
  ownerUserId: string;
  mode: "normal" | "deep_research";
  title: string;
  summary?: string | null;
}

interface AppendMessageInput {
  threadId: string;
  ownerUserId: string;
  folderId?: string | null;
  role: "user" | "assistant" | "system";
  messageKind?: "chat" | "deep_research_plan" | "deep_research_report" | "status";
  content: string;
  citations?: unknown[];
  metadata?: Record<string, unknown>;
}

interface EditUserMessageInput {
  ownerUserId: string;
  threadId: string;
  messageId: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ReplaceDeepResearchPlanInput {
  threadId: string;
  ownerUserId: string;
  folderId?: string | null;
  sessionId?: string | null;
  prompt: string;
  title: string;
  summary: string;
  requiresAnalysis: boolean;
  pendingRunCount: number;
  sourcePolicy?: Record<string, unknown>;
  steps: Array<{
    position: number;
    title: string;
    description: string;
    tool_name: string;
    tool_input: Record<string, unknown>;
  }>;
}

export interface ChatRepository {
  listThreads(ownerUserId: string): Promise<WorkspaceThreadSummary[]>;
  createThread(input: CreateThreadInput): Promise<WorkspaceThreadSummary>;
  updateThread(
    ownerUserId: string,
    threadId: string,
    patch: Partial<WorkspaceThreadSummary>
  ): Promise<void>;
  deleteThread(ownerUserId: string, threadId: string): Promise<void>;
  appendMessage(input: AppendMessageInput): Promise<WorkspaceMessageRecord>;
  updateMessageMetadata(
    ownerUserId: string,
    threadId: string,
    messageId: string,
    metadata: Record<string, unknown>
  ): Promise<void>;
  editUserMessage(input: EditUserMessageInput): Promise<void>;
  replaceDeepResearchPlan(input: ReplaceDeepResearchPlanInput): Promise<DeepResearchSessionRecord>;
  updateDeepResearchSession(
    ownerUserId: string,
    sessionId: string,
    patch: Partial<DeepResearchSessionRecord>
  ): Promise<void>;
  getThreadDetail(ownerUserId: string, threadId: string): Promise<ChatThreadDetail>;
}

class SupabaseChatRepository implements ChatRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseAdmin()) {}

  listThreads(ownerUserId: string) {
    return listWorkspaceThreads(this.client, ownerUserId);
  }

  createThread(input: CreateThreadInput) {
    return createWorkspaceThread(this.client, input);
  }

  async updateThread(
    ownerUserId: string,
    threadId: string,
    patch: Partial<WorkspaceThreadSummary>
  ): Promise<void> {
    const { error } = await this.client
      .from("workspace_threads")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", threadId)
      .eq("owner_user_id", ownerUserId);
    if (error) throw new Error(error.message);
  }

  deleteThread(ownerUserId: string, threadId: string) {
    return deleteWorkspaceThread(this.client, ownerUserId, threadId);
  }

  appendMessage(input: AppendMessageInput) {
    return appendWorkspaceMessage(this.client, input);
  }

  async updateMessageMetadata(ownerUserId: string, threadId: string, messageId: string, metadata: Record<string, unknown>): Promise<void> {
    const { error } = await this.client
      .from("workspace_messages")
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq("id", messageId)
      .eq("thread_id", threadId)
      .eq("owner_user_id", ownerUserId);
    if (error) throw new Error(error.message);
  }

  async editUserMessage(input: EditUserMessageInput): Promise<void> {
    const { error: updateError } = await this.client
      .from("workspace_messages")
      .update({
        content: input.content,
        metadata: input.metadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.messageId)
      .eq("thread_id", input.threadId)
      .eq("owner_user_id", input.ownerUserId)
      .eq("role", "user");
    if (updateError) throw new Error(updateError.message);

    const { error: deleteError } = await this.client
      .from("workspace_messages")
      .delete()
      .eq("thread_id", input.threadId)
      .eq("owner_user_id", input.ownerUserId)
      .gt("created_at", input.createdAt);
    if (deleteError) throw new Error(deleteError.message);
  }

  replaceDeepResearchPlan(input: ReplaceDeepResearchPlanInput) {
    return replaceDeepResearchPlan(this.client, input);
  }

  async updateDeepResearchSession(
    ownerUserId: string,
    sessionId: string,
    patch: Partial<DeepResearchSessionRecord>
  ): Promise<void> {
    const { error } = await this.client
      .from("deep_research_sessions")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("owner_user_id", ownerUserId);
    if (error) throw new Error(error.message);
  }

  getThreadDetail(ownerUserId: string, threadId: string) {
    return getWorkspaceThreadDetail(this.client, ownerUserId, threadId);
  }
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date(0).toISOString();
}

function threadRow(row: Record<string, unknown>): WorkspaceThreadSummary {
  return {
    ...(row as unknown as WorkspaceThreadSummary),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

function messageRow(row: Record<string, unknown>): WorkspaceMessageRecord {
  return {
    ...(row as unknown as WorkspaceMessageRecord),
    citations: Array.isArray(row.citations)
      ? (row.citations as WorkspaceMessageRecord["citations"])
      : [],
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as WorkspaceMessageRecord["metadata"])
        : {},
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

function deepResearchStepRow(row: Record<string, unknown>): DeepResearchStepRecord {
  return {
    ...(row as unknown as DeepResearchStepRecord),
    input_payload: row.input_payload && typeof row.input_payload === "object"
      ? row.input_payload as DeepResearchStepRecord["input_payload"] : {},
    output_payload: row.output_payload && typeof row.output_payload === "object"
      ? row.output_payload as DeepResearchStepRecord["output_payload"] : {},
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

function deepResearchSessionRow(
  row: Record<string, unknown>,
  steps: DeepResearchStepRecord[] = []
): DeepResearchSessionRecord {
  return {
    ...(row as unknown as DeepResearchSessionRecord),
    requires_analysis: Boolean(row.requires_analysis),
    pending_run_count: Number(row.pending_run_count ?? 0),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    completed_at: row.completed_at ? iso(row.completed_at) : null,
    steps,
  };
}

class CloudSqlChatRepository implements ChatRepository {
  private async loadDeepResearchSession(
    client: PoolClient,
    ownerUserId: string,
    sessionId: string
  ): Promise<DeepResearchSessionRecord> {
    const session = await client.query<Record<string, unknown>>(
      `SELECT * FROM public.deep_research_sessions WHERE id=$1 AND owner_user_id=$2 LIMIT 1`,
      [sessionId, ownerUserId]
    );
    if (!session.rows[0]) throw new Error("Deep research session not found.");
    const steps = await client.query<Record<string, unknown>>(
      `SELECT * FROM public.deep_research_steps
       WHERE session_id=$1 AND owner_user_id=$2 ORDER BY position ASC`,
      [sessionId, ownerUserId]
    );
    return deepResearchSessionRow(session.rows[0], steps.rows.map(deepResearchStepRow));
  }

  listThreads(ownerUserId: string): Promise<WorkspaceThreadSummary[]> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `
          SELECT t.*
          FROM public.workspace_threads t
          WHERE t.owner_user_id = $1
          ORDER BY t.updated_at DESC
          LIMIT 100
        `,
        [ownerUserId]
      );
      return result.rows.map(threadRow);
    });
  }

  createThread(input: CreateThreadInput): Promise<WorkspaceThreadSummary> {
    return withCloudSqlOwnerTransaction(input.ownerUserId, async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `
          INSERT INTO public.workspace_threads (
            owner_user_id, folder_id, mode, title, summary, updated_at
          ) VALUES ($1, NULL, $2, $3, $4, now())
          RETURNING *
        `,
        [input.ownerUserId, input.mode, input.title, input.summary ?? null]
      );
      if (!result.rows[0]) throw new Error("Failed to create workspace thread.");
      return threadRow(result.rows[0]);
    });
  }

  updateThread(
    ownerUserId: string,
    threadId: string,
    patch: Partial<WorkspaceThreadSummary>
  ): Promise<void> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const result = await client.query(
        `
          UPDATE public.workspace_threads
          SET
            title = COALESCE($3, title),
            summary = CASE WHEN $4 THEN $5 ELSE summary END,
            updated_at = now()
          WHERE id = $1 AND owner_user_id = $2
        `,
        [
          threadId,
          ownerUserId,
          patch.title ?? null,
          Object.prototype.hasOwnProperty.call(patch, "summary"),
          patch.summary ?? null,
        ]
      );
      if (result.rowCount === 0) throw new Error("Chat thread not found.");
    });
  }

  deleteThread(ownerUserId: string, threadId: string): Promise<void> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      await client.query(
        `DELETE FROM public.workspace_threads WHERE id = $1 AND owner_user_id = $2`,
        [threadId, ownerUserId]
      );
    });
  }

  appendMessage(input: AppendMessageInput): Promise<WorkspaceMessageRecord> {
    return withCloudSqlOwnerTransaction(input.ownerUserId, async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `
          INSERT INTO public.workspace_messages (
            thread_id, owner_user_id, folder_id, role, message_kind,
            content, citations, metadata, updated_at
          )
          SELECT $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, now()
          WHERE EXISTS (
            SELECT 1 FROM public.workspace_threads
            WHERE id = $1 AND owner_user_id = $2
          )
            AND (
              $3::uuid IS NULL OR EXISTS (
                SELECT 1 FROM public.research_folders
                WHERE id = $3::uuid AND owner_user_id = $2
              )
            )
          RETURNING *
        `,
        [
          input.threadId,
          input.ownerUserId,
          !input.folderId || input.folderId === "all" ? null : input.folderId,
          input.role,
          input.messageKind ?? "chat",
          input.content,
          JSON.stringify(input.citations ?? []),
          JSON.stringify(input.metadata ?? {}),
        ]
      );
      if (!result.rows[0]) throw new Error("Failed to append workspace message.");
      return messageRow(result.rows[0]);
    });
  }

  updateMessageMetadata(ownerUserId: string, threadId: string, messageId: string, metadata: Record<string, unknown>): Promise<void> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const result = await client.query(
        `UPDATE public.workspace_messages SET metadata=$4::jsonb, updated_at=now()
         WHERE id=$1 AND thread_id=$2 AND owner_user_id=$3`,
        [messageId, threadId, ownerUserId, JSON.stringify(metadata)]
      );
      if (result.rowCount === 0) throw new Error("Chat message not found.");
    });
  }

  editUserMessage(input: EditUserMessageInput): Promise<void> {
    return withCloudSqlOwnerTransaction(input.ownerUserId, async (client) => {
      const updated = await client.query(
        `
          UPDATE public.workspace_messages
          SET content = $4, metadata = $5::jsonb, updated_at = now()
          WHERE id = $1 AND thread_id = $2 AND owner_user_id = $3 AND role = 'user'
        `,
        [
          input.messageId,
          input.threadId,
          input.ownerUserId,
          input.content,
          JSON.stringify(input.metadata),
        ]
      );
      if (updated.rowCount === 0) throw new Error("Chat message not found.");
      await client.query(
        `
          DELETE FROM public.workspace_messages
          WHERE thread_id = $1 AND owner_user_id = $2 AND created_at > $3::timestamptz
        `,
        [input.threadId, input.ownerUserId, input.createdAt]
      );
    });
  }

  replaceDeepResearchPlan(input: ReplaceDeepResearchPlanInput): Promise<DeepResearchSessionRecord> {
    return withCloudSqlOwnerTransaction(input.ownerUserId, async (client) => {
      let sessionId = input.sessionId ?? null;
      if (sessionId) {
        const updated = await client.query(
          `UPDATE public.deep_research_sessions SET
             prompt=$3, plan_summary=$4, requires_analysis=$5, pending_run_count=$6,
             status='planned', final_report=NULL, last_error=NULL, updated_at=now(), completed_at=NULL
           WHERE id=$1 AND owner_user_id=$2`,
          [sessionId, input.ownerUserId, input.prompt, input.summary, input.requiresAnalysis, input.pendingRunCount]
        );
        if (updated.rowCount === 0) throw new Error("Deep research session not found.");
        await client.query(
          `DELETE FROM public.deep_research_steps WHERE session_id=$1 AND owner_user_id=$2`,
          [sessionId, input.ownerUserId]
        );
      } else {
        const created = await client.query<{ id: string }>(
          `INSERT INTO public.deep_research_sessions
             (thread_id,owner_user_id,folder_id,prompt,plan_summary,requires_analysis,pending_run_count,status,updated_at)
           SELECT $1,$2,$3,$4,$5,$6,$7,'planned',now()
           WHERE EXISTS (SELECT 1 FROM public.workspace_threads WHERE id=$1 AND owner_user_id=$2)
           RETURNING id`,
          [input.threadId, input.ownerUserId, input.folderId || null, input.prompt, input.summary,
            input.requiresAnalysis, input.pendingRunCount]
        );
        if (!created.rows[0]) throw new Error("Failed to create deep research session.");
        sessionId = created.rows[0].id;
      }

      for (const step of input.steps) {
        await client.query(
          `INSERT INTO public.deep_research_steps
             (session_id,owner_user_id,position,title,description,tool_name,status,input_payload,output_payload,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,'planned',$7::jsonb,'{}'::jsonb,now())`,
          [sessionId, input.ownerUserId, step.position, step.title, step.description,
            step.tool_name, JSON.stringify(step.tool_input)]
        );
      }

      await client.query(
        `DELETE FROM public.workspace_messages
         WHERE thread_id=$1 AND owner_user_id=$2
           AND message_kind IN ('deep_research_plan','deep_research_report')`,
        [input.threadId, input.ownerUserId]
      );
      await client.query(
        `INSERT INTO public.workspace_messages
           (thread_id,owner_user_id,folder_id,role,message_kind,content,citations,metadata,updated_at)
         VALUES ($1,$2,$3,'assistant','deep_research_plan',$4,'[]'::jsonb,$5::jsonb,now())`,
        [input.threadId, input.ownerUserId, input.folderId || null, input.summary,
          JSON.stringify({ sessionId, requiresAnalysis: input.requiresAnalysis,
            pendingRunCount: input.pendingRunCount, sourcePolicy: input.sourcePolicy ?? null })]
      );
      await client.query(
        `UPDATE public.workspace_threads SET title=$3,summary=$4,updated_at=now()
         WHERE id=$1 AND owner_user_id=$2`,
        [input.threadId, input.ownerUserId, input.title, input.summary]
      );
      return this.loadDeepResearchSession(client, input.ownerUserId, sessionId);
    });
  }

  updateDeepResearchSession(
    ownerUserId: string,
    sessionId: string,
    patch: Partial<DeepResearchSessionRecord>
  ): Promise<void> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const result = await client.query(
        `UPDATE public.deep_research_sessions SET
           status=COALESCE($3,status),
           pending_run_count=COALESCE($4,pending_run_count),
           requires_analysis=COALESCE($5,requires_analysis),
           last_error=CASE WHEN $6 THEN $7 ELSE last_error END,
           completed_at=CASE WHEN $8 THEN $9::timestamptz ELSE completed_at END,
           updated_at=now()
         WHERE id=$1 AND owner_user_id=$2`,
        [sessionId, ownerUserId, patch.status ?? null, patch.pending_run_count ?? null,
          patch.requires_analysis ?? null, Object.prototype.hasOwnProperty.call(patch, "last_error"),
          patch.last_error ?? null, Object.prototype.hasOwnProperty.call(patch, "completed_at"),
          patch.completed_at ?? null]
      );
      if (result.rowCount === 0) throw new Error("Deep research session not found.");
    });
  }

  getThreadDetail(ownerUserId: string, threadId: string): Promise<ChatThreadDetail> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const thread = await client.query<Record<string, unknown>>(
        `SELECT * FROM public.workspace_threads WHERE id = $1 AND owner_user_id = $2 LIMIT 1`,
        [threadId, ownerUserId]
      );
      if (!thread.rows[0]) throw new Error("Chat thread not found.");
      const messages = await client.query<Record<string, unknown>>(
        `
          SELECT * FROM public.workspace_messages
          WHERE thread_id = $1 AND owner_user_id = $2
          ORDER BY created_at ASC
          LIMIT 200
        `,
        [threadId, ownerUserId]
      );
      const sessions = await client.query<Record<string, unknown>>(
        `SELECT * FROM public.deep_research_sessions
         WHERE thread_id=$1 AND owner_user_id=$2 ORDER BY created_at DESC LIMIT 1`,
        [threadId, ownerUserId]
      );
      const deepResearchSession = sessions.rows[0]
        ? await this.loadDeepResearchSession(client, ownerUserId, String(sessions.rows[0].id))
        : null;
      return {
        thread: threadRow(thread.rows[0]),
        messages: messages.rows.map(messageRow),
        deepResearchSession,
      };
    });
  }
}

export function getChatRepository(): ChatRepository {
  return getDatabaseProvider() === "cloud-sql"
    ? new CloudSqlChatRepository()
    : new SupabaseChatRepository();
}
