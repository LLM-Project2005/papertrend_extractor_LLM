/*
 * How a paper is named in an address. Pure, so the paper window, its links
 * and the tests share one reading of it.
 */
export type PaperExplorerTab = "overview" | "keywords" | "evidence" | "topics" | "preview";

export const PAPER_EXPLORER_TABS: PaperExplorerTab[] = ["overview", "keywords", "evidence", "topics", "preview"];

export interface PaperTarget {
  runId?: string | null;
  paperId?: string | null;
  tab?: PaperExplorerTab;
  /** Words to find and mark in the paper's PDF: the passage an answer quoted from it. */
  quote?: string | null;
}

/**
 * The open paper outside the Library: ?paper=<run>&paperTab=<tab>&paperQuote=<passage>
 * ("tab" is the dashboard's). The Library's own address names the passage "quote".
 */
export const PAPER_PARAM = "paper";
export const PAPER_TAB_PARAM = "paperTab";
export const PAPER_QUOTE_PARAM = "paperQuote";

/** Longer than any quote a citation carries (QUOTE_MAX_CHARS is 400), so a real one is never cut. */
export const PAPER_QUOTE_MAX = 600;

export function readPaperTab(value: string | null | undefined): PaperExplorerTab {
  return PAPER_EXPLORER_TABS.includes(value as PaperExplorerTab) ? (value as PaperExplorerTab) : "overview";
}

/** A passage named in an address, tidied and bounded: it is only shown and searched for. */
export function readPaperQuote(value: string | null | undefined): string | null {
  const quote = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, PAPER_QUOTE_MAX).trim();
  return quote || null;
}

/** The Library address for a paper: for a new tab, and for pages outside the workspace. */
export function libraryPaperHref(target: PaperTarget): string {
  const params = new URLSearchParams();
  if (target.runId) params.set("paper", target.runId);
  else if (target.paperId) params.set("paperId", target.paperId);
  if (target.tab && target.tab !== "overview") params.set("tab", target.tab);
  const quote = readPaperQuote(target.quote);
  if (quote) params.set("quote", quote);
  return `/workspace/library?${params.toString()}`;
}

/** Reads a Library paper address ("/workspace/library?paperId=…&tab=evidence") back into a paper. */
export function parsePaperHref(href: string | null | undefined): PaperTarget | null {
  if (!href || !/^\/workspace\/library(\?|$)/.test(href)) return null;
  const params = new URLSearchParams(href.split("?")[1] ?? "");
  const runId = params.get("paper") ?? params.get("runId");
  const paperId = params.get("paperId");
  if (!runId && !paperId) return null;
  const tab = params.get("tab");
  const quote = readPaperQuote(params.get("quote"));
  return {
    runId: runId ?? null,
    paperId: runId ? null : paperId,
    tab: tab ? readPaperTab(tab) : undefined,
    ...(quote ? { quote } : {}),
  };
}

/** One paper, however it was named: by its run, or by the paper behind it. */
export function paperKey(target: PaperTarget): string | null {
  return target.runId ? `run:${target.runId}` : target.paperId ? `paper:${target.paperId}` : null;
}

/**
 * The list a paper was opened from, without repeats (a paper cited twice is
 * one stop), and the paper's place in it. Null when there is nothing to step
 * to: no list, one paper, or a paper that is not in it.
 */
export function paperSequence(target: PaperTarget, items: PaperTarget[] | null | undefined): { items: PaperTarget[]; index: number } | null {
  if (!items || items.length < 2) return null;
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    const key = paperKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const key = paperKey(target);
  const index = key ? unique.findIndex((item) => paperKey(item) === key) : -1;
  return unique.length > 1 && index >= 0 ? { items: unique, index } : null;
}
