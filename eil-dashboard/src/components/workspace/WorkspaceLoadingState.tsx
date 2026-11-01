import { panelClass } from "@/components/ui/controls";

/*
 * While a workspace page loads: the page's own shape blocked out (a heading,
 * its line of facts, a panel of rows), as Home's lists do, so nothing jumps
 * when it arrives (2026-10-31, UI audit C1). It was a mascot and "Loading…"
 * in the middle of an empty screen.
 */
export default function WorkspaceLoadingState() {
  return (
    <div role="status" className="mx-auto w-full max-w-[1500px] space-y-8 pt-2 sm:pt-4">
      <span className="sr-only">Loading…</span>
      <div className="space-y-3" aria-hidden="true">
        <span className="skeleton block h-9 w-64 max-w-full" />
        <span className="skeleton block h-4 w-[28rem] max-w-full" />
        <span className="skeleton block h-4 w-48 max-w-full" />
      </div>
      <div className={`${panelClass} space-y-5 p-5 sm:p-6`} aria-hidden="true">
        <span className="skeleton block h-5 w-40" />
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-3">
            <span className="skeleton h-4 w-4 flex-none rounded-full" />
            <span className="flex-1 space-y-1.5">
              <span className="skeleton block h-3.5 w-4/5" />
              <span className="skeleton block h-3 w-2/5" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
