"use client";

/**
 * The numbers behind a chart, as a list a keyboard and a screen reader can
 * use (docs/32, 3.4). A bar or a slice opened its papers only to a mouse, and
 * the values themselves were only in a hover tooltip. Collapsed by default, so
 * the chart stays the summary; each value opens the same papers its bar does.
 */
export interface ChartValue {
  key: string;
  label: string;
  /** What the value is, in words: "7 papers". */
  detail: string;
  /** Values of a stacked chart are listed under their group (a year). */
  group?: string;
  onSelect?: () => void;
}

export default function ChartValues({ title, values }: { title: string; values: ChartValue[] }) {
  if (values.length === 0) return null;
  const groups = new Map<string, ChartValue[]>();
  for (const value of values) {
    const group = value.group ?? "";
    groups.set(group, [...(groups.get(group) ?? []), value]);
  }
  return (
    <details className="group mt-3">
      <summary className="inline-flex min-h-9 cursor-pointer items-center rounded-lg px-1 text-xs font-medium text-slate-600 transition-colors hover:text-slate-900 dark:text-[#a3a3a3] dark:hover:text-white">
        <span className="group-open:hidden">Show the values</span>
        <span className="hidden group-open:inline">Hide the values</span>
        <span className="sr-only">: {title}</span>
      </summary>
      <div className="mt-2 space-y-3">
        {[...groups.entries()].map(([group, items]) => (
          <div key={group || "values"}>
            {group ? <p className="mb-1 text-xs font-semibold text-slate-700 dark:text-[#d4d4d4]">{group}</p> : null}
            <ul className="grid gap-1 sm:grid-cols-2">
              {items.map((item) => (
                <li key={item.key}>
                  {item.onSelect ? (
                    <button
                      type="button"
                      onClick={item.onSelect}
                      className="flex min-h-9 w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm text-slate-800 transition-colors hover:bg-slate-100 dark:text-[#ececec] dark:hover:bg-[#0a0a0a]"
                    >
                      <span className="min-w-0 truncate">{item.label}</span>
                      <span className="flex-none text-xs text-slate-600 dark:text-[#a3a3a3]">{item.detail}</span>
                    </button>
                  ) : (
                    <span className="flex min-h-9 items-center justify-between gap-3 px-2 py-1.5 text-sm text-slate-800 dark:text-[#ececec]">
                      <span className="min-w-0 truncate">{item.label}</span>
                      <span className="flex-none text-xs text-slate-600 dark:text-[#a3a3a3]">{item.detail}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}

/** "7 papers", "1 paper". */
export function paperCount(count: number): string {
  return `${count} paper${count === 1 ? "" : "s"}`;
}
