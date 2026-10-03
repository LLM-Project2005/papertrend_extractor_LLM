/*
 * src/components/workspace/WorkspaceProvider.tsx for render tests: the
 * workspace state is whatever a test puts in globalThis.__profiledashWorkspace,
 * so a page can be drawn as it is after a load that worked or failed.
 */
import type { ReactNode } from "react";

declare global {
  // eslint-disable-next-line no-var
  var __profiledashWorkspace: Record<string, unknown> | undefined;
}

const idle = async () => undefined;

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
    selectedOrganizationId: null,
    selectedProjectId: null,
    workspaceLoading: false,
    workspaceLoadError: null,
    refreshOrganizations: idle,
    refreshAllProjects: idle,
    createOrganization: idle,
    createProject: idle,
    renameProject: idle,
    setSelectedProjectId: () => undefined,
    ...(globalThis.__profiledashWorkspace ?? {}),
  };
}
