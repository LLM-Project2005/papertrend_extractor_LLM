import WorkspaceLoadingState from "@/components/workspace/WorkspaceLoadingState";

export default function WorkspaceRouteLoading() {
  return (
    <WorkspaceLoadingState
      title="Loading page"
      description="Preparing the workspace page and keeping your current project context in place."
    />
  );
}
