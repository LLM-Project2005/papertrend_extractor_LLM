"use client";

import ChatClient from "@/components/chat/ChatClient";
import { useDashboardData } from "@/hooks/useData";
import { TRACK_COLS } from "@/lib/constants";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";

export default function WorkspaceChatClient() {
  const { selectedFolderId, folders } = useWorkspaceProfile();
  const { data, loading, allYears } = useDashboardData(selectedFolderId);
  const selectedFolderLabel =
    selectedFolderId === "all"
      ? "All folders"
      : folders.find((folder) => folder.id === selectedFolderId)?.name ?? "Selected folder";

  if (loading || !data) {
    return (
      <div className="app-surface flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-slate-500 border-t-transparent dark:border-[#8e8e8e]" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Loading workspace chat...
          </p>
        </div>
      </div>
    );
  }

  return (
    <ChatClient
      previewMode={data.useMock}
      folderId={selectedFolderId}
      folderLabel={selectedFolderLabel}
      selectedYears={allYears}
      selectedTracks={[...TRACK_COLS]}
    />
  );
}
