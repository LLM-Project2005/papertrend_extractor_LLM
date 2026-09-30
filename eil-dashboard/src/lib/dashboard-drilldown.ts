import type { PaperId } from "@/types/database";

/**
 * A dashboard drilldown lists exactly the papers counted in what was clicked
 * (docs/32, 2.8).
 *
 * The list used to be rebuilt from the click's labels - a category, a year, a
 * theme - by rules of its own, which disagreed with the charts': a category
 * matched either assignment type, a year was one representative row's, a
 * keyword was matched by exact spelling. Now every chart hands over the paper
 * ids behind the mark, taken from the same set it counted, and those ids are
 * the list.
 */

/** Where a chart row keeps the ids behind one of its series. */
export function idsKey(dataKey: string): string {
  return `${dataKey}\u0001paperIds`;
}

/**
 * The ids behind a clicked mark. Recharts passes the row either spread into
 * the event or under `payload`; a row keeps its ids under `paperIds`, or under
 * idsKey(series) when it holds several series.
 */
export function markPaperIds(entry: unknown, dataKey?: string): string[] | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const record = entry as Record<string, unknown>;
  const key = dataKey ? idsKey(dataKey) : "paperIds";
  for (const row of [record, record.payload]) {
    if (row && typeof row === "object") {
      const ids = (row as Record<string, unknown>)[key];
      if (Array.isArray(ids)) return ids.map(String);
    }
  }
  return undefined;
}

/** A keyword as the keyword counts fold it: case and spacing do not make a new keyword. */
export function keywordKey(keyword: string): string {
  return keyword.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Papers per keyword, folded as keywordPaperCounts folds them. */
export function paperIdsByKeywordKey(rows: ReadonlyArray<{ keyword?: string | null; paper_id: PaperId }>): Map<string, Set<PaperId>> {
  const map = new Map<string, Set<PaperId>>();
  for (const row of rows) {
    const keyword = String(row.keyword ?? "").trim();
    if (!keyword) continue;
    const key = keywordKey(keyword);
    map.set(key, (map.get(key) ?? new Set<PaperId>()).add(row.paper_id));
  }
  return map;
}

/**
 * The papers a drilldown lists when the chart said which: exactly those, of
 * the ones in view. Null when the target carries no ids, and the list is
 * worked out from its labels instead.
 */
export function explicitDrilldownIds(target: { paperIds?: readonly string[] }, inView: ReadonlySet<string>): Set<string> | null {
  const ids = (target.paperIds ?? []).filter(Boolean);
  if (ids.length === 0) return null;
  return new Set(ids.filter((id) => inView.has(id)));
}
