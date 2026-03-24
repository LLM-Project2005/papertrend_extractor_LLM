"use client";

import ChatClient from "@/components/chat/ChatClient";
import { useDashboardData } from "@/hooks/useData";

export default function WorkspaceChatClient() {
  const { data, loading } = useDashboardData();

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

  return <ChatClient previewMode={data.useMock} />;
}
