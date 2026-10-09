import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import { isQuotaExemptRole } from "@/lib/quota-policy";
import { AI_USAGE_COUNT_SQL } from "@/lib/security-guards";
import {
  getAiDailyDeepResearchLimit,
  getAiDailyMessageLimit,
  getAiDailyTokenLimit,
  getAiDailyWebSearchLimit,
} from "@/lib/server-env";

/*
 * Where an account stands against its daily limits, for the usage meter beside
 * the chat composer (2026-10-09 review). It reads the same rows and the same
 * limits the guards in security-guards.ts enforce, and never writes. The day is
 * the UTC day the token limit already uses.
 */

export interface UsageAgainstLimit {
  used: number;
  limit: number;
}

export interface AiUsageToday {
  /** Admins have no daily limits; their use is still shown. */
  exempt: boolean;
  tokens: UsageAgainstLimit;
  messages: UsageAgainstLimit;
  deepResearch: UsageAgainstLimit;
  webSearches: UsageAgainstLimit;
  /** When the counts start again: the next UTC midnight. */
  resetsAt: string;
}

export function utcDayBounds(now = new Date()): { since: string; resetsAt: string } {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const next = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { since: start.toISOString(), resetsAt: next.toISOString() };
}

export async function readAiUsageToday(ownerUserId: string, now = new Date()): Promise<AiUsageToday> {
  const { since, resetsAt } = utcDayBounds(now);
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const profile = await client.query<{ role: string | null }>(`SELECT role FROM public.user_profiles WHERE id=$1 LIMIT 1`, [ownerUserId]);
    // The token rows the chat token budget counts (assertAiTokenBudget).
    const tokens = await client.query<{ units: string }>(
      `SELECT COALESCE(sum(units), 0)::text AS units
       FROM public.ai_usage_events
       WHERE owner_user_id=$1 AND usage_kind='chat_message'
         AND metadata->>'metric'='tokens' AND created_at >= $2`,
      [ownerUserId, since]
    );
    const count = async (kind: string) =>
      Number((await client.query<{ count: string }>(AI_USAGE_COUNT_SQL, [ownerUserId, kind, since])).rows[0]?.count ?? 0);
    return {
      exempt: isQuotaExemptRole(profile.rows[0]?.role),
      tokens: { used: Number(tokens.rows[0]?.units ?? 0), limit: getAiDailyTokenLimit() },
      messages: { used: await count("chat_message"), limit: getAiDailyMessageLimit() },
      deepResearch: { used: await count("deep_research"), limit: getAiDailyDeepResearchLimit() },
      webSearches: { used: await count("web_search"), limit: getAiDailyWebSearchLimit() },
      resetsAt,
    };
  });
}
