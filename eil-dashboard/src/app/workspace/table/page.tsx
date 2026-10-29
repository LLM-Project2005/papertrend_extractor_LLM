import type { Metadata } from "next";
import PaperTableClient from "@/components/table/PaperTableClient";

// Each workspace page names itself in the tab and in history (docs/32, 2.11, SHELL-8).
export const metadata: Metadata = { title: "Table" };

export default function WorkspaceTablePage() {
  return <PaperTableClient />;
}
