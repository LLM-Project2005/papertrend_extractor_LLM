import { loadRepositoryContext, oneCopyEach, type RepositoryPaper } from "@/lib/repository-chat";
import { MAX_TABLE_PAPERS, type TableRow } from "@/lib/paper-table";

/**
 * A table's rows: the repository's analysed papers, one copy of each study,
 * oldest first as a review lists them. The papers come from the same loader
 * as the chat, so a table and an answer read the same text.
 */
export async function tablePapers(ownerUserId: string, projectId: string): Promise<{ rows: TableRow[]; papers: RepositoryPaper[]; more: number }> {
  const context = await loadRepositoryContext({ ownerUserId, projectId, prompt: "" });
  const studies = oneCopyEach(context.papers).sort(
    (a, b) => (Number(a.year) || 9999) - (Number(b.year) || 9999) || a.title.localeCompare(b.title)
  );
  const papers = studies.slice(0, MAX_TABLE_PAPERS);
  return {
    rows: papers.map((paper) => ({ paperId: paper.paperId, runId: paper.runId, title: paper.title, year: paper.year })),
    papers,
    more: studies.length - papers.length,
  };
}
