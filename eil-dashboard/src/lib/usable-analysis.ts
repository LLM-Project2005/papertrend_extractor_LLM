/**
 * Whether a run's analysis can be used - read, charted, searched, cited
 * (docs/32, 2.4).
 *
 * A run being analysed again goes back to "queued" and then "processing", but
 * its earlier results stay saved until the new ones replace them in one
 * transaction, and the worker keeps them if the new attempt fails. Readers
 * used to require "succeeded", so re-analysing a paper took it out of chat,
 * the semantic map and the Library for as long as the queue took.
 *
 * This is the worker's own rule for "earlier results kept"
 * (worker/analysis_pipeline/reanalysis.py, `earlier_results_kept`): a
 * re-analysis request, a paper, and a finished earlier analysis.
 */

export function usableAnalysisSql(alias: string): string {
  const payload = `${alias}.input_payload`;
  return `(${alias}.status = 'succeeded' OR (${alias}.status IN ('queued', 'processing')
    AND ${payload} ? 'reanalysis_requested_at' AND ${payload} ? 'paper_id'
    AND (${payload}->'analysis_metrics' ? 'completed_at' OR COALESCE(${payload}->>'keyword_count', '') ~ '^[1-9][0-9]*$')))`;
}

export function hasUsableAnalysis(run: { status?: unknown; input_payload?: unknown } | null | undefined): boolean {
  if (!run) return false;
  if (run.status === "succeeded") return true;
  if (run.status !== "queued" && run.status !== "processing") return false;
  const payload = run.input_payload && typeof run.input_payload === "object" ? (run.input_payload as Record<string, unknown>) : {};
  if (!payload.reanalysis_requested_at || !payload.paper_id) return false;
  const metrics = payload.analysis_metrics && typeof payload.analysis_metrics === "object"
    ? (payload.analysis_metrics as Record<string, unknown>)
    : {};
  return Boolean(metrics.completed_at) || Number(payload.keyword_count ?? 0) > 0;
}
