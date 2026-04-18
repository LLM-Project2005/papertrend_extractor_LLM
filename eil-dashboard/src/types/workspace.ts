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

export interface WorkspaceProfile {
  name: string;
  organization: string;
  domain: string;
  goal: WorkspaceGoal;
  primarySource: WorkspaceSource;
  desiredOutputs: WorkspaceOutput[];
  analysisHistoryHiddenByProject: Record<string, string[]>;
  onboardingComplete: boolean;
  updatedAt: string | null;
}
