import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";

/** The repository picker reads and sets the same workspace state as the workspace itself. */
export default function WorkspacesLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}
