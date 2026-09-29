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
}

/** The open paper outside the Library: ?paper=<run>&paperTab=<tab> ("tab" is the dashboard's). */
export const PAPER_PARAM = "paper";
export const PAPER_TAB_PARAM = "paperTab";

export function readPaperTab(value: string | null | undefined): PaperExplorerTab {
  return PAPER_EXPLORER_TABS.includes(value as PaperExplorerTab) ? (value as PaperExplorerTab) : "overview";
}

/** The Library address for a paper: for a new tab, and for pages outside the workspace. */
export function libraryPaperHref(target: PaperTarget): string {
  const params = new URLSearchParams();
  if (target.runId) params.set("paper", target.runId);
  else if (target.paperId) params.set("paperId", target.paperId);
  if (target.tab && target.tab !== "overview") params.set("tab", target.tab);
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
  return { runId: runId ?? null, paperId: runId ? null : paperId, tab: tab ? readPaperTab(tab) : undefined };
}
