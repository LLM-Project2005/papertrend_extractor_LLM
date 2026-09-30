import { spendUsd } from "@/lib/answer-cost";
import type { AiTokenUsageTotals } from "@/lib/ai-token-usage";
import { withCloudSqlOwnerTransaction, withCloudSqlServiceTransaction } from "@/lib/cloudsql/client";
import { isQuotaExemptRole } from "@/lib/quota-policy";

/**
 * Daily dollar limits on model spend (docs/32, 1.5).
 *
 * Every request that calls a model leaves one `ai_usage_events` row whose
 * `metadata.cost_usd` is what it cost: the provider's own figure when every call
 * reported one, otherwise an estimate from tokens. The worker leaves one for each
 * paper it analyses, with `source: "analysis"`. Two limits read those rows:
 *
 * - **Per person**: what one account's requests cost today. Admins are exempt,
 *   and a person's paper analysis does not count against it.
 * - **Site-wide**: what everything cost today, analysis included. Nobody is
 *   exempt. The worker checks it too, and leaves papers queued while it holds.
 *
 * Both are checked before a request starts, so a request that begins under a
 * limit can end over it by its own cost; nothing is cut off mid-answer.
 *
 * The defaults are sized to a budget of about $10 of model credit a quarter:
 * the site-wide limit means a runaway day costs at most $1.50, which leaves time
 * to notice before the credit is gone.
 */
export const DEFAULT_PERSON_DAILY_USD = 0.5;
export const DEFAULT_SITE_DAILY_USD = 1.5;

/** Where a spend row came from; the worker writes "analysis". */
export type SpendSource =
  | "chat"
  | "chat-job"
  | "deep-research"
  | "insights"
  | "insights-ask"
  | "topic-themes"
  | "topic-cache"
  | "reclassification"
  | "semantic-map"
  | "search-index";

function parseUsd(raw: string | undefined, fallback: number): number {
  const value = Number(String(raw ?? "").trim());
  return raw?.trim() && Number.isFinite(value) && value > 0 ? Math.min(value, 1_000) : fallback;
}

export function dailySpendLimits(env: Record<string, string | undefined> = process.env): { personUsd: number; siteUsd: number } {
  return {
    personUsd: parseUsd(env.AI_DAILY_USD_LIMIT_PER_PERSON, DEFAULT_PERSON_DAILY_USD),
    siteUsd: parseUsd(env.AI_DAILY_USD_LIMIT_SITE, DEFAULT_SITE_DAILY_USD),
  };
}

/** Limits reset at midnight UTC, like the other daily limits. */
export function utcDayStart(now = new Date()): string {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  return day.toISOString();
}

export function personLimitMessage(limitUsd: number): string {
  return `You have used today's AI allowance of $${limitUsd.toFixed(2)}. It resets at midnight UTC (7:00 in Thailand).`;
}

export const SITE_LIMIT_MESSAGE =
  "Papertrend has reached today's AI spending limit for the whole site, so new AI work waits until midnight UTC (7:00 in Thailand). Papers you upload stay queued and are analysed after that.";

export interface SpendState {
  personUsd: number;
  siteUsd: number;
  exempt: boolean;
}

/** The refusal for a state, or null when the request may start. */
export function spendRefusal(
  state: SpendState,
  limits = dailySpendLimits()
): { scope: "site" | "person"; message: string } | null {
  if (state.siteUsd >= limits.siteUsd) return { scope: "site", message: SITE_LIMIT_MESSAGE };
  if (!state.exempt && state.personUsd >= limits.personUsd) {
    return { scope: "person", message: personLimitMessage(limits.personUsd) };
  }
  return null;
}

/** A cost that is not a JSON number counts as nothing rather than failing the sum. */
const COST = `CASE WHEN jsonb_typeof(metadata->'cost_usd') = 'number' THEN (metadata->>'cost_usd')::numeric ELSE 0 END`;

export const PERSON_SPEND_SQL = `SELECT
  COALESCE((SELECT sum(${COST}) FROM public.ai_usage_events
    WHERE owner_user_id = $1 AND created_at >= $2 AND metadata ? 'cost_usd'
      AND metadata->>'source' IS DISTINCT FROM 'analysis'), 0)::float8 AS person_usd,
  (SELECT role FROM public.user_profiles WHERE id = $1 LIMIT 1) AS role`;

export const SITE_SPEND_SQL = `SELECT COALESCE(sum(${COST}), 0)::float8 AS site_usd
  FROM public.ai_usage_events WHERE created_at >= $1 AND metadata ? 'cost_usd'`;

/*
 * The site-wide total is read in a service transaction, so it counts every
 * account's rows, and cached for a few seconds per instance: it is the same
 * number for every request, and a burst of requests needs it only once.
 */
const SITE_CACHE_MS = 10_000;
let siteCache: { day: string; usd: number; at: number } | null = null;

async function siteSpendToday(day: string): Promise<number> {
  if (siteCache && siteCache.day === day && Date.now() - siteCache.at < SITE_CACHE_MS) return siteCache.usd;
  const usd = await withCloudSqlServiceTransaction(async (client) => {
    const result = await client.query<{ site_usd: number }>(SITE_SPEND_SQL, [day]);
    return Number(result.rows[0]?.site_usd ?? 0);
  });
  siteCache = { day, usd, at: Date.now() };
  return usd;
}

/** Test seam: forget the cached site-wide total. */
export function resetSpendCache(): void {
  siteCache = null;
}

export async function readSpendToday(ownerUserId: string): Promise<SpendState> {
  const day = utcDayStart();
  const [person, siteUsd] = await Promise.all([
    withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const result = await client.query<{ person_usd: number; role: string | null }>(PERSON_SPEND_SQL, [ownerUserId, day]);
      return { usd: Number(result.rows[0]?.person_usd ?? 0), role: result.rows[0]?.role ?? null };
    }),
    siteSpendToday(day),
  ]);
  return { personUsd: person.usd, siteUsd, exempt: isQuotaExemptRole(person.role) };
}

/** The metadata of one spend row: tokens, calls, and what they cost. */
export function spendMetadata(
  usage: Pick<AiTokenUsageTotals, "promptTokens" | "completionTokens" | "calls"> &
    Partial<Pick<AiTokenUsageTotals, "byModel" | "reportedUsd" | "reportedCalls">>,
  source: SpendSource,
  webSearches = 0
): Record<string, unknown> {
  const spend = spendUsd(
    { calls: usage.calls, byModel: usage.byModel ?? [], reportedUsd: usage.reportedUsd, reportedCalls: usage.reportedCalls },
    webSearches
  );
  return {
    metric: "tokens",
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    model_calls: usage.calls,
    cost_usd: spend.usd,
    cost_source: spend.source,
    source,
  };
}
