"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import { buildWorkspacePath, getWorkspaceSectionFromPathname } from "@/lib/workspace-routes";

export default function LegacyWorkspaceRedirect({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    selectedOrganizationId,
    selectedProjectId,
    currentProject,
    hydrated,
  } = useWorkspaceProfile();

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    if (!pathname?.startsWith("/workspace")) {
      return;
    }

    if (!selectedOrganizationId || !selectedProjectId) {
      return;
    }

    const section = getWorkspaceSectionFromPathname(pathname);
    const targetPath = buildWorkspacePath({
      organizationId: selectedOrganizationId,
      projectId: selectedProjectId,
      projectName: currentProject?.name ?? null,
      section,
    });

    if (targetPath !== pathname) {
      router.replace(targetPath, { scroll: false });
    }
  }, [
    currentProject?.name,
    hydrated,
    pathname,
    router,
    selectedOrganizationId,
    selectedProjectId,
  ]);

  return <>{children}</>;
}
