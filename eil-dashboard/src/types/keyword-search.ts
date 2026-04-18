import type { TrackKey } from "@/lib/constants";
import type { PaperId } from "@/types/database";

export interface KeywordSearchRequest {
  query: string;
  folderIds?: string[];
  projectId?: string | "all";
  selectedYears?: string[];
  selectedTracks?: TrackKey[];
  queryLanguage?: string;
}

export interface KeywordSearchEvidence {
  paperId: PaperId;
  year: string;
  title: string;
  section: string;
  snippet: string;
}

export interface KeywordSearchPaperSummary {
  paperId: PaperId;
  title: string;
  year: string;
  tracksSingle: string[];
  tracksMulti: string[];
  matchedTerms: string[];
  evidence: string[];
}

export interface KeywordSearchResponse {
  canonicalConcept: string;
  matchedTerms: string[];
  firstAppearance: {
    paperId: PaperId;
    title: string;
    year: string;
    tracksSingle: string[];
    tracksMulti: string[];
    section: string;
    snippet: string;
  } | null;
  timeline: Array<{
    year: string;
    frequency: number;
    papers: number;
  }>;
  trackSpread: Array<{
    track: TrackKey;
    papers: number;
  }>;
  cooccurringConcepts: Array<{
    label: string;
    weight: number;
  }>;
  objectiveVerbs: Array<{
    label: string;
    count: number;
  }>;
  contributionTypes: Array<{
    label: string;
    count: number;
  }>;
  papers: KeywordSearchPaperSummary[];
  evidence: KeywordSearchEvidence[];
  summary: string;
  notFound: boolean;
  suggestedConcepts: string[];
  source?: string;
}
