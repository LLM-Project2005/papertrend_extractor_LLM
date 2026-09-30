import type { Metadata } from "next";
import WorkspaceChatClient from "@/components/workspace/WorkspaceChatClient";

// Each workspace page names itself in the tab and in history (docs/32, 2.11, SHELL-8).
export const metadata: Metadata = { title: "Chat" };

export default function WorkspaceChatPage() {
  return <WorkspaceChatClient />;
}
