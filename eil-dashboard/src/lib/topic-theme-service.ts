/**
 * Stores, applies and refreshes a repository's topic themes (topic-themes.ts).
 *
 * Reads never call a model. The dashboard applies the stored grouping and is
 * told how many topics the store has not seen; the open dashboard then asks for
 * them to be grouped with a request of its own (POST /api/workspace/topic-themes),
 * which does the work inside that request.
 *
 * Not a task queue, although the app has one. Both of its queues dispatch one
 * task at a time and carry paper analysis, so a grouping would wait behind
 * uploads that take minutes each - and hold them up in turn. The production
 * queue also retries a failed task up to a hundred times with almost no backoff,
 * which for a model call is a way to spend money in a loop.
 *
 * Cost is bounded three ways. Only topics the store has not seen are sent, so an
 * unchanged repository costs nothing however often it is read. One grouping per
 * repository at a time: the request claims the store atomically, and a second
 * viewer finds the claim and waits for it. And a failure is not retried on every
 * read - it backs off, doubling from 15 minutes to a day.
 */
import type { PoolClient } from "pg";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import { DEFAULT_FAST_MODEL } from "@/lib/model-routing";
import { createChatCompletionResult, type ChatMessage } from "@/lib/openai";
import { getDatabaseProvider, getOpenAIConfig } from "@/lib/server-env";
import {
  CONSENSUS_RUNS,
  addLeftoverGroups,
  applyThemeStore,
  assignmentMessages,
  collectTopicItems,
  consensusAssignment,
  consensusGroups,
  extendGroups,
  groupingMessages,
  groupsFromStore,
  parseAssignment,
  parseGrouping,
  planThemeUpdate,
  readThemeStore,
  storeFromGroups,
  THEME_STORE_VERSION,
  type GroupingMessage,
  type ThemeGroup,
  type ThemeStore,
  type TopicItem,
} from "@/lib/topic-themes";
import type { DashboardData, TopicThemeStatus, TrendRow } from "@/types/database";

const TASK = "TOPIC_THEME_GROUPING";
const SCOPE_TYPE = "custom";
/** A claim older than this is abandoned - its request died - and can be taken over. */
const CLAIM_EXPIRES_MS = 5 * 60_000;
const FIRST_BACKOFF_MS = 15 * 60_000;
const MAX_BACKOFF_MS = 24 * 60 * 60_000;
const CALL_TIMEOUT_MS = 60_000;

function scopeKey(projectId: string): string {
  return `topic-themes:v${THEME_STORE_VERSION}:${projectId}`;
}

/** Grouping needs a model; without a key the dashboard shows each paper's own topics. */
export function themeGroupingAvailable(): boolean {
  return getDatabaseProvider() === "cloud-sql" && Boolean(getOpenAIConfig(TASK));
}

/**
 * The model the method was evaluated with, on OpenRouter; otherwise the
 * deployment's own model, because the evaluated name means nothing elsewhere.
 * TOPIC_THEMES_MODEL overrides both.
 */
function modelOverride(): string | undefined {
  const configured = process.env.TOPIC_THEMES_MODEL?.trim();
  if (configured) return configured;
  return getOpenAIConfig(TASK)?.baseUrl.includes("openrouter.ai") ? DEFAULT_FAST_MODEL : undefined;
}

export function failureBackoffMs(failures: number): number {
  return Math.min(MAX_BACKOFF_MS, FIRST_BACKOFF_MS * 2 ** Math.max(0, failures - 1));
}

/** Whether a read should ask for grouping now, given what is stored. */
export function themeStatusFor(store: ThemeStore | null, ungroupedTopics: number, now = Date.now()): TopicThemeStatus {
  const base = { ungroupedTopics, groupedAt: store?.groupedAt ?? null };
  if (ungroupedTopics === 0) return { ...base, status: "ready" };
  if (!themeGroupingAvailable()) return { ...base, status: "unavailable" };
  if (store?.failedAt && now - Date.parse(store.failedAt) < failureBackoffMs(store.failures ?? 1)) {
    return { ...base, status: "unavailable" };
  }
  return { ...base, status: "pending" };
}

/* ------------------------------------------------------------ the store */

async function readStore(client: PoolClient, ownerUserId: string, projectId: string): Promise<ThemeStore | null> {
  const result = await client.query<{ payload: unknown }>(
    `SELECT payload FROM public.workspace_analytics_cache
     WHERE owner_user_id=$1 AND scope_type=$2 AND scope_key=$3 LIMIT 1`,
    [ownerUserId, SCOPE_TYPE, scopeKey(projectId)]
  );
  return readThemeStore(result.rows[0]?.payload);
}

export async function loadThemeStore(ownerUserId: string, projectId: string): Promise<ThemeStore | null> {
  return withCloudSqlOwnerTransaction(ownerUserId, (client) => readStore(client, ownerUserId, projectId));
}

async function saveStore(ownerUserId: string, projectId: string, store: ThemeStore): Promise<void> {
  await withCloudSqlOwnerTransaction(ownerUserId, (client) =>
    client.query(
      `INSERT INTO public.workspace_analytics_cache (owner_user_id, scope_type, scope_key, version_hash, payload, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, now())
       ON CONFLICT (owner_user_id, scope_type, scope_key) DO UPDATE SET
         version_hash = EXCLUDED.version_hash, payload = EXCLUDED.payload, updated_at = now()`,
      [ownerUserId, SCOPE_TYPE, scopeKey(projectId), `themes-v${store.version}:${store.groupedAt ?? "none"}`, JSON.stringify(store)]
    )
  );
}

/**
 * Takes the repository's grouping for this request, or reports that another
 * request has it. One statement, so two viewers cannot both win: the update
 * only happens when no fresh claim is there.
 */
async function claim(ownerUserId: string, projectId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const placeholder: ThemeStore = {
    version: THEME_STORE_VERSION,
    themes: [],
    assignments: {},
    groupedAt: null,
    fullGroupingTopics: 0,
    pendingSince: now,
    failedAt: null,
    failures: 0,
  };
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const result = await client.query(
      `INSERT INTO public.workspace_analytics_cache (owner_user_id, scope_type, scope_key, version_hash, payload, updated_at)
       VALUES ($1, $2, $3, 'themes-pending', $4::jsonb, now())
       ON CONFLICT (owner_user_id, scope_type, scope_key) DO UPDATE SET
         payload = workspace_analytics_cache.payload || jsonb_build_object('pendingSince', $5::text),
         updated_at = now()
       WHERE workspace_analytics_cache.payload->>'pendingSince' IS NULL
          OR (workspace_analytics_cache.payload->>'pendingSince')::timestamptz < now() - ($6::text || ' milliseconds')::interval
       RETURNING 1`,
      [ownerUserId, SCOPE_TYPE, scopeKey(projectId), JSON.stringify(placeholder), now, String(CLAIM_EXPIRES_MS)]
    );
    return (result.rowCount ?? 0) > 0;
  });
}

async function recordFailure(ownerUserId: string, projectId: string): Promise<void> {
  await withCloudSqlOwnerTransaction(ownerUserId, (client) =>
    client.query(
      `UPDATE public.workspace_analytics_cache
       SET payload = payload || jsonb_build_object(
             'pendingSince', NULL,
             'failedAt', $4::text,
             'failures', COALESCE((payload->>'failures')::int, 0) + 1),
           updated_at = now()
       WHERE owner_user_id=$1 AND scope_type=$2 AND scope_key=$3`,
      [ownerUserId, SCOPE_TYPE, scopeKey(projectId), new Date().toISOString()]
    )
  );
}

export async function projectBelongsTo(ownerUserId: string, projectId: string): Promise<boolean> {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const result = await client.query(
      `SELECT 1 FROM public.workspace_projects WHERE id=$1 AND owner_user_id=$2 LIMIT 1`,
      [projectId, ownerUserId]
    );
    return Boolean(result.rows[0]);
  });
}

/* ------------------------------------------------------------ the read */

/**
 * Applies the stored grouping to a dashboard read. Never calls a model, and
 * never fails the read: without a store every paper's own topic is shown.
 */
export async function applyStoredThemes(ownerUserId: string, projectId: string, data: DashboardData): Promise<DashboardData> {
  if (getDatabaseProvider() !== "cloud-sql" || data.trends.length === 0) return data;
  let store: ThemeStore | null = null;
  try {
    store = await loadThemeStore(ownerUserId, projectId);
  } catch (error) {
    console.warn("topic_themes_read_skipped", error instanceof Error ? error.message : String(error));
  }
  const applied = applyThemeStore(data.trends, store);
  return {
    ...data,
    trends: applied.trends,
    topicFamilies: applied.families,
    topicThemes: themeStatusFor(store, applied.unknownTopics),
  };
}

/* ------------------------------------------------------------ grouping */

async function ask(messages: GroupingMessage[], count: number): Promise<string[]> {
  const model = modelOverride();
  const settled = await Promise.allSettled(
    Array.from({ length: count }, () =>
      createChatCompletionResult(messages as ChatMessage[], 0, model, TASK, {
        reasoningEffort: "low",
        jsonObject: true,
        timeoutMs: CALL_TIMEOUT_MS,
      })
    )
  );
  return settled.flatMap((entry) => (entry.status === "fulfilled" && entry.value?.content ? [entry.value.content] : []));
}

/** Consensus of independent groupings; null when too few came back usable. */
async function groupWhole(items: TopicItem[], totalPapers: number): Promise<ThemeGroup[] | null> {
  const replies = await ask(groupingMessages(items), CONSENSUS_RUNS);
  const runs = replies.map((text) => parseGrouping(text, items)).filter((run): run is ThemeGroup[] => Boolean(run));
  // One usable grouping is not a consensus; three of six single calls broke a
  // pair that is not a matter of taste.
  if (runs.length < 2) return null;
  return consensusGroups(runs, items, { totalPapers });
}

/** Files new topics under the existing themes, then groups what fits none. */
async function fileNew(items: TopicItem[], store: ThemeStore, totalPapers: number): Promise<ThemeGroup[] | null> {
  const { groups, unknown } = groupsFromStore(items, store);
  const themes = groups.map((group) => ({
    name: group.name,
    kind: group.kind,
    examples: group.members.slice(0, 3).map((index) => items[index].label),
  }));
  const replies = await ask(assignmentMessages(themes, unknown.map((index) => items[index])), CONSENSUS_RUNS);
  const votes = replies
    .map((text) => parseAssignment(text, themes.length, unknown.length))
    .filter((vote): vote is Array<number | null> => Boolean(vote));
  if (votes.length < 2) return null;
  const choices = consensusAssignment(votes, unknown.length);
  const assigned = unknown.filter((_, n) => choices[n] !== null);
  const filed = extendGroups(items, groups, assigned, choices.filter((choice) => choice !== null));
  const leftovers = unknown.filter((_, n) => choices[n] === null);
  if (leftovers.length < 2) return extendGroups(items, filed, leftovers, leftovers.map(() => null));
  // Topics that fit no theme may still belong together - several papers on a
  // subject the repository did not have. Best effort: if this fails they stand
  // alone, which is where they were anyway.
  const leftoverItems = leftovers.map((index) => items[index]);
  const leftoverGroups = await groupWhole(leftoverItems, totalPapers).catch(() => null);
  return leftoverGroups
    ? addLeftoverGroups(filed, leftovers, leftoverGroups)
    : extendGroups(items, filed, leftovers, leftovers.map(() => null));
}

export interface ThemeGroupingOutcome {
  status: "grouped" | "busy" | "failed" | "unavailable";
  plan?: "none" | "incremental" | "full";
  topics?: number;
  themes?: number;
}

/**
 * Brings a repository's stored grouping up to date with its topics.
 *
 * `loadTrends` loads every topic in the repository, not the folders in view, so
 * a topic gets the same theme whatever the dashboard is filtered to.
 */
export async function groupProjectThemes(
  ownerUserId: string,
  projectId: string,
  loadTrends: () => Promise<TrendRow[]>
): Promise<ThemeGroupingOutcome> {
  if (!themeGroupingAvailable()) return { status: "unavailable" };
  const stored = await loadThemeStore(ownerUserId, projectId);
  if (stored?.failedAt && Date.now() - Date.parse(stored.failedAt) < failureBackoffMs(stored.failures ?? 1)) {
    return { status: "unavailable" };
  }
  if (!(await claim(ownerUserId, projectId))) return { status: "busy" };

  const started = Date.now();
  try {
    const trends = await loadTrends();
    const items = collectTopicItems(trends);
    const totalPapers = new Set(trends.map((row) => row.paper_id)).size;
    const store = await loadThemeStore(ownerUserId, projectId);
    const usable = store && store.themes.length > 0 ? store : null;
    const plan = planThemeUpdate(items, usable);
    const now = new Date().toISOString();
    const model = modelOverride() ?? getOpenAIConfig(TASK)?.model ?? null;

    let next: ThemeStore;
    if (plan === "full") {
      const groups = await groupWhole(items, totalPapers);
      if (!groups) throw new Error("Too few usable groupings came back.");
      next = storeFromGroups(items, groups, { now, model, fullGroupingTopics: items.length });
    } else if (plan === "incremental") {
      const groups = await fileNew(items, usable!, totalPapers);
      if (!groups) throw new Error("Too few usable filings came back.");
      next = storeFromGroups(items, groups, { now, model, fullGroupingTopics: usable!.fullGroupingTopics });
    } else {
      // Nothing new. Rewriting still drops topics whose papers were removed, and
      // releases the claim.
      const { groups } = groupsFromStore(items, usable);
      next = storeFromGroups(items, groups, {
        now: usable?.groupedAt ?? now,
        model: usable?.model ?? model,
        fullGroupingTopics: usable?.fullGroupingTopics ?? items.length,
      });
    }
    await saveStore(ownerUserId, projectId, next);
    console.info(
      "topic_themes_grouped",
      JSON.stringify({ projectId, plan, topics: items.length, themes: next.themes.length, ms: Date.now() - started })
    );
    return { status: "grouped", plan, topics: items.length, themes: next.themes.length };
  } catch (error) {
    console.error(
      "topic_themes_failed",
      JSON.stringify({ projectId, message: error instanceof Error ? error.message : String(error), ms: Date.now() - started })
    );
    await recordFailure(ownerUserId, projectId).catch(() => undefined);
    return { status: "failed" };
  }
}
