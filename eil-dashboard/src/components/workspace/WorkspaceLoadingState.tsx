export default function WorkspaceLoadingState() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-4xl items-center justify-center">
      <div className="w-full max-w-xl border-y border-papertrend-line px-8 py-12 text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-[var(--pt-line-strong)] border-t-papertrend-action" />
        <p className="text-sm font-semibold text-papertrend-ink">Opening repository</p>
        <p className="mt-2 text-sm text-papertrend-muted">
          Loading your project context and latest analysis status.
        </p>
      </div>
    </div>
  );
}
