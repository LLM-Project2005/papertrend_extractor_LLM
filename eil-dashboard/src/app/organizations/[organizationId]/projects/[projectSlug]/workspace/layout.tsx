import WorkspaceShell from "@/components/workspace/WorkspaceShell";
import WorkspaceRouteSync from "@/components/workspace/WorkspaceRouteSync";
import { parseEntityIdFromSlug } from "@/lib/workspace-routes";

export default function ProjectWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { organizationId: string; projectSlug: string };
}) {
  const projectId = parseEntityIdFromSlug(params.projectSlug);

  return (
    <>
      <WorkspaceRouteSync organizationId={params.organizationId} projectId={projectId} />
      <WorkspaceShell>{children}</WorkspaceShell>
    </>
  );
}
