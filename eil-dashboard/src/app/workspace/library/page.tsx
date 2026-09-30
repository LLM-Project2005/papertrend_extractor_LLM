import type { Metadata } from "next";
import AdminImportClient from "@/components/admin/AdminImportClient";

// Each workspace page names itself in the tab and in history (docs/32, 2.11, SHELL-8).
export const metadata: Metadata = { title: "Library" };

export default function WorkspaceLibraryPage() {
  return <AdminImportClient />;
}
