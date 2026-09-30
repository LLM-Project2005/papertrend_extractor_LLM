import type { Metadata } from "next";
import WorkspaceSettingsClient from "@/components/workspace/WorkspaceSettingsClient";

// Each workspace page names itself in the tab and in history (docs/32, 2.11, SHELL-8).
export const metadata: Metadata = { title: "Settings" };

export default function WorkspaceSettingsPage() {
  return <WorkspaceSettingsClient />;
}
