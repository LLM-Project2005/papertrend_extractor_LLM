"use client";

import { createContext, useContext } from "react";
import type { useIngestionRuns } from "@/hooks/useIngestionRuns";

/**
 * The followed runs' progress, polled once by the workspace shell and read by
 * any page inside it (docs/32, 2.6). The shell and Home used to run a poller
 * each, both every three seconds.
 */
export type AnalysisRunsValue = ReturnType<typeof useIngestionRuns>;

export const AnalysisRunsContext = createContext<AnalysisRunsValue | null>(null);

export function useAnalysisRuns(): AnalysisRunsValue {
  const value = useContext(AnalysisRunsContext);
  if (!value) throw new Error("useAnalysisRuns is available only inside the workspace shell.");
  return value;
}
