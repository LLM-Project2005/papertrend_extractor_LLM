"use client";

import { useEffect } from "react";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";

export default function WorkspaceRouteSync({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const { setSelectedOrganizationId, setSelectedProjectId } = useWorkspaceProfile();

  useEffect(() => {
    if (!organizationId || !projectId) {
      return;
    }
    setSelectedOrganizationId(organizationId);
    setSelectedProjectId(projectId);
  }, [organizationId, projectId, setSelectedOrganizationId, setSelectedProjectId]);

  return null;
}
