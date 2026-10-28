import { loadRepositoryContext, oneCopyEach, type RepositoryPaper } from "@/lib/repository-chat";
import { tableStudies, type TableRow } from "@/lib/paper-table";

/**
 * A table's rows: the repository's analysed papers, one copy of each study,
 * oldest first as a review lists them; past the limit, the newest. The papers
 * come from the same loader as the chat, so a table and an answer read the
 * same text.
 */
export async function tablePapers(ownerUserId: string, projectId: string): Promise<{ rows: TableRow[]; papers: RepositoryPaper[]; more: number }> {
  const context = await loadRepositoryContext({ ownerUserId, projectId, prompt: "" });
  const studies = oneCopyEach(context.papers);
  const papers = tableStudies(studies);
  return {
    rows: papers.map((paper) => ({ paperId: paper.paperId, runId: paper.runId, title: paper.title, year: paper.year })),
    papers,
    more: studies.length - papers.length,
  };
}
