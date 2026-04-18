export type WorkspaceGoal =
  | "trend-mapping"
  | "corpus-chat"
  | "curriculum-design"
  | "literature-review";

export type WorkspaceSource =
  | "pdf-upload"
  | "csv-import"
  | "onedrive"
  | "sharepoint"
  | "cloud-storage";

export type WorkspaceOutput =
  | "dashboard"
  | "chat"
  | "paper-library"
  | "track-classification"
  | "curriculum-paths";

export interface WorkspaceCorpusTopicFamilyCache {
  id: string;
  canonicalTopic: string;
  aliases: string[];
  representativeKeywords: string[];
  relatedKeywords: string[];
  matchedTerms: string[];
  evidenceSnippets: string[];
  paperIds: string[];
  folderIds: string[];
  years: string[];
  totalKeywordFrequency: number;
}

export interface WorkspaceCorpusTopicTrendCacheRow {
  paper_id: string;
  folder_id?: string | null;
  year: string;
  title: string;
  topic: string;
  raw_topic?: string;
  keyword: string;
  keyword_frequency: number;
  evidence: string;
}

export interface WorkspaceProjectCorpusTopicCache {
  sourceSignature: string;
  generatedAt: string;
  familyCount: number;
  trendCount: number;
  families: WorkspaceCorpusTopicFamilyCache[];
  trends: WorkspaceCorpusTopicTrendCacheRow[];
}

export interface WorkspaceProfile {
  name: string;
  organization: string;
  domain: string;
  goal: WorkspaceGoal;
  primarySource: WorkspaceSource;
  desiredOutputs: WorkspaceOutput[];
  analysisHistoryHiddenByProject: Record<string, string[]>;
  projectCorpusTopicCacheByProject: Record<string, WorkspaceProjectCorpusTopicCache>;
  onboardingComplete: boolean;
  updatedAt: string | null;
}
