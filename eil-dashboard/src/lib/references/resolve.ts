import type { PoolClient } from "pg";
import {
  citationFromCrossref,
  citationFromPaper,
  doiFromYearSource,
  normalizeDoi,
  normalizeTitle,
  primaryDoiFromText,
  strictTitleMatch,
  type CitationRecord,
  type CrossrefWork,
} from "@/lib/references/citation";
import { usableAnalysisSql } from "@/lib/usable-analysis";

/*
 * Each paper's reference details (docs/32, 4.4), looked up in Crossref once
 * and kept with its run (input_payload.citation), so a second export is
 * immediate. A paper Crossref does not know is remembered for 30 days, then
 * looked up again. The lookup is keyed by the title and DOI it used, so a
 * corrected title is looked up afresh.
 */

export const CITATION_CACHE_VERSION = 1;
const NOT_FOUND_RETRY_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_REFERENCE_RUNS = 200;

type Client = Pick<PoolClient, "query">;

interface CitationCache {
  v: number;
  basis: string;
  status: "found" | "none";
  work?: CrossrefWork;
  checkedAt: string;
}

interface PaperRow {
  run_id: string;
  input_payload: Record<string, unknown> | null;
  paper_title: string | null;
  paper_year: string | null;
  year_source: string | null;
  front: string | null;
}

export type FetchJson = (url: string) => Promise<unknown | null>;

export interface CitationCacheWrite {
  runId: string;
  cache: CitationCache;
}

export interface ResolvedReferences {
  records: CitationRecord[];
  /** What was learned, to keep with each run (saveCitationCacheIn). */
  cacheWrites: CitationCacheWrite[];
  /** Papers whose authors and venue came from Crossref, and those with title and year only. */
  fromCrossref: number;
  titleOnly: number;
  /** Papers not looked up before the time ran out; exported with title and year, looked up next time. */
  notLookedUp: number;
}

const SELECT_PAPERS = `
  SELECT r.id::text AS run_id, r.input_payload, p.title AS paper_title, p.year AS paper_year,
         p.year_source, left(pc.raw_text, 8000) AS front
  FROM public.ingestion_runs r
  LEFT JOIN public.paper_content pc ON pc.ingestion_run_id = r.id AND pc.owner_user_id = r.owner_user_id
  LEFT JOIN public.papers p ON p.id = pc.paper_id AND p.owner_user_id = r.owner_user_id
  WHERE r.owner_user_id = $1 AND r.trashed_at IS NULL AND ${usableAnalysisSql("r")}`;
const PAPERS_BY_RUN_SQL = `${SELECT_PAPERS} AND r.id = ANY($2::uuid[]) ORDER BY p.title NULLS LAST LIMIT 200`;
const PAPERS_BY_PROJECT_SQL = `${SELECT_PAPERS}
  AND r.folder_id IN (SELECT id FROM public.research_folders WHERE owner_user_id = $1 AND project_id = $2)
  ORDER BY p.title NULLS LAST LIMIT 200`;

/** The owner's papers named by run, or a repository's, in title order. */
export async function loadReferencePapers(
  client: Client,
  ownerUserId: string,
  selection: { runIds: string[] } | { projectId: string }
): Promise<PaperRow[]> {
  const result =
    "runIds" in selection
      ? await client.query<PaperRow>(PAPERS_BY_RUN_SQL, [ownerUserId, selection.runIds.slice(0, MAX_REFERENCE_RUNS)])
      : await client.query<PaperRow>(PAPERS_BY_PROJECT_SQL, [ownerUserId, selection.projectId]);
  return result.rows;
}

function overrides(payload: Record<string, unknown> | null): { title: string | null; year: string | null } {
  const value = payload?.user_overrides;
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : null,
    year: typeof record.year === "string" && /^\d{4}$/.test(record.year.trim()) ? record.year.trim() : null,
  };
}

function paperOf(row: PaperRow) {
  const corrected = overrides(row.input_payload);
  const payloadTitle = typeof row.input_payload?.paper_title === "string" ? row.input_payload.paper_title : null;
  return {
    title: corrected.title ?? row.paper_title ?? payloadTitle,
    year: corrected.year ?? (row.paper_year && /^\d{4}$/.test(row.paper_year) ? row.paper_year : null),
    correctedTitle: corrected.title,
    correctedYear: corrected.year,
  };
}

function cachedCitation(row: PaperRow, basis: string, now: number): CitationCache | null {
  const value = row.input_payload?.citation as CitationCache | undefined;
  if (!value || value.v !== CITATION_CACHE_VERSION || value.basis !== basis) return null;
  if (value.status === "none" && now - Date.parse(value.checkedAt) > NOT_FOUND_RETRY_MS) return null;
  return value;
}

/** What is kept of a Crossref record: only the fields a reference uses. */
function keptWork(work: CrossrefWork): CrossrefWork {
  return {
    DOI: work.DOI,
    type: work.type,
    title: work.title?.slice(0, 1),
    author: work.author?.slice(0, 50).map((author) => ({ family: author.family, given: author.given, name: author.name })),
    "container-title": work["container-title"]?.slice(0, 1),
    volume: work.volume,
    issue: work.issue,
    page: work.page,
    publisher: work.publisher,
    issued: work.issued,
    "published-print": work["published-print"],
    "published-online": work["published-online"],
  };
}

async function lookUp(row: PaperRow, title: string | null, year: string | null, fetchJson: FetchJson): Promise<CrossrefWork | null> {
  const doi = doiFromYearSource(row.year_source) ?? primaryDoiFromText(row.front);
  if (doi) {
    const payload = (await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)) as { message?: CrossrefWork } | null;
    if (payload?.message && normalizeDoi(payload.message.DOI) === doi) return payload.message;
  }
  if (!title || normalizeTitle(title).length < 20) return null;
  const search = (await fetchJson(
    `https://api.crossref.org/works?rows=5&query.bibliographic=${encodeURIComponent(title.slice(0, 300))}`
  )) as { message?: { items?: CrossrefWork[] } } | null;
  return strictTitleMatch(title, year, search?.message?.items ?? []);
}

/**
 * References for the papers, looking up any not yet known, four at a time,
 * until the deadline. No database connection is held while Crossref answers:
 * what was learned comes back as cacheWrites, saved afterwards.
 */
export async function resolveReferences(
  rows: PaperRow[],
  options: { fetchJson: FetchJson; now?: () => number; deadlineMs?: number; concurrency?: number }
): Promise<ResolvedReferences> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.deadlineMs ?? 25_000);
  const records: CitationRecord[] = new Array(rows.length);
  let fromCrossref = 0;
  let titleOnly = 0;
  let notLookedUp = 0;
  const cacheWrites: CitationCacheWrite[] = [];
  const pending: Array<{ index: number; row: PaperRow; paper: ReturnType<typeof paperOf>; basis: string }> = [];

  rows.forEach((row, index) => {
    const paper = paperOf(row);
    const doi = doiFromYearSource(row.year_source) ?? primaryDoiFromText(row.front) ?? "";
    const basis = `${normalizeTitle(paper.title ?? "")}|${doi}`;
    const cached = cachedCitation(row, basis, now());
    if (cached?.status === "found" && cached.work) {
      records[index] = citationFromCrossref(cached.work, paper);
      fromCrossref += 1;
    } else if (cached?.status === "none") {
      records[index] = citationFromPaper(paper);
      titleOnly += 1;
    } else {
      pending.push({ index, row, paper, basis });
    }
  });

  const worker = async () => {
    for (let next = pending.shift(); next; next = pending.shift()) {
      if (now() > deadline) {
        records[next.index] = citationFromPaper(next.paper);
        notLookedUp += 1;
        continue;
      }
      const work = await lookUp(next.row, next.paper.title, next.paper.year, options.fetchJson).catch(() => undefined);
      if (work === undefined) {
        // The lookup itself failed (Crossref down, a timeout): nothing is remembered.
        records[next.index] = citationFromPaper(next.paper);
        notLookedUp += 1;
        continue;
      }
      const cache: CitationCache = work
        ? { v: CITATION_CACHE_VERSION, basis: next.basis, status: "found", work: keptWork(work), checkedAt: new Date(now()).toISOString() }
        : { v: CITATION_CACHE_VERSION, basis: next.basis, status: "none", checkedAt: new Date(now()).toISOString() };
      cacheWrites.push({ runId: next.row.run_id, cache });
      if (work) {
        records[next.index] = citationFromCrossref(work, next.paper);
        fromCrossref += 1;
      } else {
        records[next.index] = citationFromPaper(next.paper);
        titleOnly += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 4) }, worker));
  return { records, cacheWrites, fromCrossref, titleOnly, notLookedUp };
}

/** Keeps each lookup with its run, without touching updated_at (the Library sorts by it). */
export async function saveCitationCacheIn(client: Client, ownerUserId: string, writes: CitationCacheWrite[]): Promise<void> {
  for (const write of writes) {
    await client.query(
      `UPDATE public.ingestion_runs
       SET input_payload = jsonb_set(COALESCE(input_payload, '{}'::jsonb), '{citation}', $3::jsonb)
       WHERE id = $1 AND owner_user_id = $2`,
      [write.runId, ownerUserId, JSON.stringify(write.cache)]
    );
  }
}

/**
 * How many lookups run at once. Crossref's public pool allows one request at a
 * time; with a contact address (CROSSREF_MAILTO) its polite pool allows three.
 * Measured on the 41-paper test repository, four at once without an address
 * had 35 of 41 refused with 429.
 */
export function crossrefConcurrency(): number {
  return process.env.CROSSREF_MAILTO?.trim() ? 3 : 1;
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Crossref's JSON, or null for a work it does not have. A refusal for going
 * too fast (429) is waited out once, as Retry-After asks (at most 3 s); any
 * other failure throws, so it is not remembered as "not found".
 */
export async function fetchCrossrefJson(url: string, options: { fetchImpl?: typeof fetch; wait?: (ms: number) => Promise<unknown> } = {}): Promise<unknown | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const wait = options.wait ?? sleep;
  const mailto = process.env.CROSSREF_MAILTO?.trim();
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": `papertrend-references/1.0${mailto ? ` (mailto:${mailto})` : ""}` },
      signal: AbortSignal.timeout(6_000),
    });
    if (response.status === 404) return null;
    if (response.status === 429 && attempt === 1) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 3_000) : 1_500);
      continue;
    }
    if (!response.ok) throw new Error(`Crossref answered ${response.status}`);
    return response.json();
  }
}
