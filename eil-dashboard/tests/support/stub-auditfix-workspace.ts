/*
 * src/components/workspace/WorkspaceProvider.tsx for render tests: the
 * workspace state is whatever a test puts in globalThis.__auditfixWorkspace,
 * over a loaded workspace with no repository chosen.
 */
import type { ReactNode } from "react";

declare global {
  // eslint-disable-next-line no-var
  var __auditfixWorkspace: Record<string, unknown> | undefined;
}

const idle = async () => undefined;
const nothing = () => undefined;

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  return children;
}

export function useWorkspaceProfile() {
  return {
    allProjects: [],
    projects: [],
    organizations: [],
    folders: [],
    allFolders: [],
    currentProject: null,
    hasActiveProject: false,
    selectedOrganizationId: null,
    selectedProjectId: null,
    selectedFolderId: "all",
    workspaceLoading: false,
    workspaceLoadError: null,
    analysisSession: null,
    refreshFolders: idle,
    refreshOrganizations: idle,
    refreshAllProjects: idle,
    setSelectedProjectId: nothing,
    setSelectedFolderId: nothing,
    startAnalysisSession: nothing,
    setAnalysisMinimized: nothing,
    removeAnalysisRunIds: nothing,
    clearAnalysisSession: nothing,
    ...(globalThis.__auditfixWorkspace ?? {}),
  };
}
