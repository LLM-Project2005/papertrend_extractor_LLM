import type {
  DbPaper,
  DbPaperContent,
  DbPaperKeyword,
  DbPaperTrack,
} from "@/types/database";

export interface CanonicalPaperPayload {
  paper: DbPaper;
  content?: DbPaperContent;
  keywords: DbPaperKeyword[];
  tracksSingle?: DbPaperTrack;
  tracksMulti?: DbPaperTrack;
}

export interface CanonicalRunPayload {
  sourceType: "batch" | "upload";
  sourceFilename?: string;
  sourcePath?: string;
  provider?: string;
  model?: string;
  papers: CanonicalPaperPayload[];
  metadata?: Record<string, unknown>;
}

export interface SyncSummary {
  runId?: string;
  paperCount: number;
  keywordCount: number;
  singleTrackCount: number;
  multiTrackCount: number;
  contentCount: number;
}
