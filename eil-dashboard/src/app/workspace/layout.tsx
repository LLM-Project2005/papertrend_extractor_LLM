import WorkspaceShell from "@/components/workspace/WorkspaceShell";
import { PaperViewerProvider } from "@/components/workspace/PaperViewerProvider";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The paper window opens over any workspace page, the shell's search included.
  return (
    <WorkspaceProvider>
      <PaperViewerProvider>
        <WorkspaceShell>{children}</WorkspaceShell>
      </PaperViewerProvider>
    </WorkspaceProvider>
  );
}
