export type SemanticMapStatus = "queued" | "processing" | "succeeded" | "failed" | "canceled";

export interface SemanticMapPoint {
  paperId: string;
  runId: string | null;
  folderId: string | null;
  x: number;
  y: number;
  clusterId: number | null;
  title: string;
  year: string;
  folderName: string | null;
  categories: string[];
  topics: string[];
  keywords: string[];
  track: string | null;
}

export interface SemanticMapEdge {
  sourcePaperId: string;
  targetPaperId: string;
  similarity: number;
  rank: number;
  sharedSignals: {
    categories: string[];
    topics: string[];
    keywords: string[];
    methods: string[];
  };
}

export interface SemanticMapCluster {
  id: number;
  label: string;
  paperCount: number;
  terms: string[];
  source: "llm" | "deterministic";
}

export interface RepositorySemanticMap {
  mapId: string;
  projectId: string;
  status: SemanticMapStatus;
  stale: boolean;
  sourceHash: string;
  progress: { stage: string; current: number; total: number };
  projection: {
    algorithm: "single" | "pca" | "umap" | null;
    version: string | null;
    parameters: Record<string, number>;
  };
  quality: Record<string, number>;
  points: SemanticMapPoint[];
  edges: SemanticMapEdge[];
  clusters: SemanticMapCluster[];
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface SemanticPaperDocument {
  paperId: string;
  runId: string | null;
  projectId: string;
  folderId: string | null;
  folderName: string | null;
  title: string;
  year: string;
  abstract: string;
  objectives: string[];
  methods: string;
  results: string;
  conclusion: string;
  categories: string[];
  topics: string[];
  keywords: string[];
  track: string | null;
  documentText: string;
  contentHash: string;
}
