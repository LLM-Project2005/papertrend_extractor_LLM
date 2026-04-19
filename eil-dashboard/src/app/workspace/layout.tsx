import WorkspaceShell from "@/components/workspace/WorkspaceShell";
import LegacyWorkspaceRedirect from "@/components/workspace/LegacyWorkspaceRedirect";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceShell>
      <LegacyWorkspaceRedirect>{children}</LegacyWorkspaceRedirect>
    </WorkspaceShell>
  );
}
