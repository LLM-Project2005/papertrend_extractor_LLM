import type { Metadata } from "next";
import WorkspaceHomeClient from "@/components/workspace/WorkspaceHomeClient";

// Each workspace page names itself in the tab and in history (docs/32, 2.11, SHELL-8).
export const metadata: Metadata = { title: "Home" };

export default function WorkspaceHomePage() {
  return <WorkspaceHomeClient />;
}
