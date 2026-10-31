"use client";

/*
 * Cancel, Cancel all, Retry processing and Start now, for the analysis the
 * workspace follows: one set of handlers for the tray in the shell and the
 * card on Home (2026-10-31, UI audit #7). A failure used to reach only the
 * console (cancel) or the browser's alert() (retry, start); it now shows as a
 * Notice beside the card, saying what did not work, with Try again.
 */
// React in scope: the test runner compiles JSX the classic way.
import React, { useState, type ReactNode } from "react";
import Notice from "@/components/ui/Notice";
import type { AnalysisRunsValue } from "@/components/workspace/AnalysisRunsContext";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";

type RunActionsSource = Pick<
  AnalysisRunsValue,
  "cancelRuns" | "cancelAllActiveRuns" | "retryActiveProcessing" | "startQueuedProcessing" | "refresh"
>;

interface Failure {
  /** What did not work, in plain words. */
  title: string;
  /** The server's reason, when it gave one. */
  detail: string;
  retry: () => void;
}

export interface AnalysisRunActions {
  onCancelRun: (runId: string) => Promise<void>;
  onCancelAll: () => Promise<void>;
  onRetryQueue: () => Promise<void>;
  onStartProcessing: () => Promise<void>;
  /** The failure, if the last action failed; render it beside the card. */
  notice: ReactNode;
}

export function useAnalysisRunActions(source: RunActionsSource, scope: string): AnalysisRunActions {
  const { analysisSession, removeAnalysisRunIds } = useWorkspaceProfile();
  const [failure, setFailure] = useState<Failure | null>(null);
  const folderJobId = analysisSession?.folderJobId ?? undefined;

  function fail(title: string, action: string, error: unknown, retry: () => void, context: Record<string, unknown>) {
    const detail = error instanceof Error ? error.message : "";
    console.error(`[${scope}] failed to ${action}`, { ...context, error: detail || "unknown_error" });
    setFailure({ title, detail, retry });
  }

  async function onCancelRun(runId: string) {
    setFailure(null);
    try {
      const canceledRuns = await source.cancelRuns([runId]);
      if (canceledRuns.length > 0) {
        removeAnalysisRunIds(canceledRuns.map((run) => run.id));
      }
    } catch (error) {
      fail("The analysis could not be canceled.", "cancel run", error, () => void onCancelRun(runId), { runId });
    }
  }

  async function onCancelAll() {
    setFailure(null);
    try {
      const canceledRuns = await source.cancelAllActiveRuns({
        folderJobId,
        runIds: analysisSession?.runIds,
      });
      if (canceledRuns.length > 0) {
        removeAnalysisRunIds(canceledRuns.map((run) => run.id));
      }
    } catch (error) {
      fail("The analyses could not be canceled.", "cancel all runs", error, () => void onCancelAll(), {
        folderJobId: folderJobId ?? null,
      });
    }
  }

  async function onRetryQueue() {
    setFailure(null);
    try {
      await source.retryActiveProcessing(folderJobId);
      await source.refresh();
    } catch (error) {
      fail("The analysis could not be started again.", "retry processing", error, () => void onRetryQueue(), {
        folderJobId: folderJobId ?? null,
      });
    }
  }

  async function onStartProcessing() {
    setFailure(null);
    try {
      await source.startQueuedProcessing(folderJobId);
      await source.refresh();
    } catch (error) {
      fail("The waiting papers could not be started.", "start queued processing", error, () => void onStartProcessing(), {
        folderJobId: folderJobId ?? null,
      });
    }
  }

  const notice = failure ? (
    <Notice
      tone="error"
      actionLabel="Try again"
      onAction={failure.retry}
      onDismiss={() => setFailure(null)}
    >
      <p className="font-medium">{failure.title}</p>
      {failure.detail && failure.detail !== failure.title ? <p>{failure.detail}</p> : null}
    </Notice>
  ) : null;

  return { onCancelRun, onCancelAll, onRetryQueue, onStartProcessing, notice };
}
