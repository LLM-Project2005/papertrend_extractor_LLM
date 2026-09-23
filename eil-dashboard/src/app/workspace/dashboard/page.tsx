import { Suspense } from "react";
import DashboardClient from "@/components/DashboardClient";
import WorkspaceLoadingState from "@/components/workspace/WorkspaceLoadingState";

/*
 * This route used to carry its own loading card, and every value in it came
 * from somewhere else: a beige #dfd5c6 border and a blue-500 spinner that
 * appear nowhere in the brand, `gray` where the palette is `slate`, and no dark
 * variant at all - so opening the dashboard in dark mode flashed a white card
 * before the real page arrived.
 *
 * WorkspaceLoadingState is the treatment the rest of the workspace already
 * uses, and it is dark-correct.
 */
export default function WorkspaceDashboardPage() {
  return (
    <Suspense fallback={<WorkspaceLoadingState />}>
      <DashboardClient basePath="/workspace/dashboard" />
    </Suspense>
  );
}
