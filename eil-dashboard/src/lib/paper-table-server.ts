import { loadRepositoryContext, oneCopyEach, type RepositoryPaper } from "@/lib/repository-chat";
import { tableStudies, type LeftOut, type LeftOutRow, type TableRow } from "@/lib/paper-table";

function rowOf(paper: RepositoryPaper): TableRow {
  return { paperId: paper.paperId, runId: paper.runId, title: paper.title, year: paper.year };
}

/**
 * A table's rows: the repository's analysed papers, one copy of each study,
 * oldest first as a review lists them; past the limit, the newest. The papers
 * come from the same loader as the chat, so a table and an answer read the
 * same text. A paper the table leaves out is listed apart, with its reason,
 * and does not count towards the limit.
 */
export async function tablePapers(
  ownerUserId: string,
  projectId: string,
  leftOut: LeftOut = {}
): Promise<{ rows: TableRow[]; papers: RepositoryPaper[]; more: number; leftOutRows: LeftOutRow[] }> {
  const context = await loadRepositoryContext({ ownerUserId, projectId, prompt: "" });
  const studies = oneCopyEach(context.papers);
  const kept = studies.filter((paper) => !leftOut[paper.paperId]);
  const papers = tableStudies(kept);
  const leftOutRows = tableStudies(studies.filter((paper) => leftOut[paper.paperId]), Number.MAX_SAFE_INTEGER).map((paper) => ({
    ...rowOf(paper),
    ...leftOut[paper.paperId],
  }));
  return { rows: papers.map(rowOf), papers, more: kept.length - papers.length, leftOutRows };
}
