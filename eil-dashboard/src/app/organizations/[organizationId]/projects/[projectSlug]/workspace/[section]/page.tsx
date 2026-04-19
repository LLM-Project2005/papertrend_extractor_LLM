import { Suspense } from "react";
import { redirect, notFound } from "next/navigation";
import DashboardClient from "@/components/DashboardClient";
import WorkspaceChatClient from "@/components/workspace/WorkspaceChatClient";
import WorkspaceHomeClient from "@/components/workspace/WorkspaceHomeClient";
import WorkspaceLogsPage from "@/components/workspace/WorkspaceLogsPage";
import WorkspaceProfileClient from "@/components/workspace/WorkspaceProfileClient";
import WorkspaceSettingsClient from "@/components/workspace/WorkspaceSettingsClient";
import AdminImportClient from "@/components/admin/AdminImportClient";
import { WORKSPACE_SECTIONS, buildWorkspacePathFromSlug, type WorkspaceSection } from "@/lib/workspace-routes";

function DashboardFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center rounded-[32px] border border-[#dfd5c6] bg-white">
      <div className="text-center">
        <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        <p className="text-sm text-gray-500">Loading dashboard...</p>
      </div>
    </div>
  );
}

export default function ProjectWorkspaceSectionPage({
  params,
}: {
  params: { organizationId: string; projectSlug: string; section: string };
}) {
  const section = params.section.toLowerCase();
  if (!WORKSPACE_SECTIONS.includes(section as WorkspaceSection)) {
    notFound();
  }

  if (section === "imports" || section === "papers") {
    redirect(
      buildWorkspacePathFromSlug({
        organizationId: params.organizationId,
        projectSlug: params.projectSlug,
        section: "library",
      })
    );
  }

  switch (section as WorkspaceSection) {
    case "home":
      return <WorkspaceHomeClient />;
    case "dashboard":
      return (
        <Suspense fallback={<DashboardFallback />}>
          <DashboardClient
            basePath={buildWorkspacePathFromSlug({
              organizationId: params.organizationId,
              projectSlug: params.projectSlug,
              section: "dashboard",
            })}
          />
        </Suspense>
      );
    case "chat":
      return <WorkspaceChatClient />;
    case "library":
      return <AdminImportClient />;
    case "logs":
      return <WorkspaceLogsPage />;
    case "settings":
      return <WorkspaceSettingsClient />;
    case "profile":
      return <WorkspaceProfileClient />;
    default:
      return notFound();
  }
}
