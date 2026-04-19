"use client";

import { useEffect } from "react";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";

export default function WorkspaceRouteSync({
  organizationId,
  projectId,
  projectSlug,
}: {
  organizationId: string;
  projectId: string;
  projectSlug: string;
}) {
  const { setSelectedOrganizationId, setSelectedProjectId } = useWorkspaceProfile();

  useEffect(() => {
    if (!organizationId || !projectId) {
      return;
    }
    setSelectedOrganizationId(organizationId);
    setSelectedProjectId(projectId);

    if (typeof document !== "undefined") {
      document.cookie = `papertrend_workspace_org=${encodeURIComponent(organizationId)}; Path=/; SameSite=Lax`;
      document.cookie = `papertrend_workspace_project=${encodeURIComponent(projectId)}; Path=/; SameSite=Lax`;
      document.cookie = `papertrend_workspace_project_slug=${encodeURIComponent(projectSlug)}; Path=/; SameSite=Lax`;
    }
  }, [
    organizationId,
    projectId,
    projectSlug,
    setSelectedOrganizationId,
    setSelectedProjectId,
  ]);

  return null;
}
