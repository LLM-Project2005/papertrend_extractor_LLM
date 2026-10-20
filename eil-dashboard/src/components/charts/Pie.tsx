"use client";

/*
 * Parts of one whole at a glance, for six parts or fewer (docs/38). Asked for
 * a pie with more parts, or parts that are not a whole, the caller draws bars.
 */
// React in scope: the test runner compiles JSX the classic way.
import React from "react";
import { categoricalColor } from "@/lib/chart-palette";
import { formatNumber, formatPercent, sharePercent } from "@/lib/charts/scale";

export const PIE_MAX_PARTS = 6;

export interface PieSlice {
  key: string;
  label: string;
  value: number;
}

function arc(start: number, end: number, outer: number, inner: number): string {
  const point = (angle: number, radius: number) => [50 + radius * Math.sin(angle), 50 - radius * Math.cos(angle)];
  const large = end - start > Math.PI ? 1 : 0;
  const [x1, y1] = point(start, outer);
  const [x2, y2] = point(end, outer);
  const [x3, y3] = point(end, inner);
  const [x4, y4] = point(start, inner);
  return `M ${x1} ${y1} A ${outer} ${outer} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`;
}

export default function Pie({ slices, unit = "papers" }: { slices: PieSlice[]; unit?: string }) {
  const parts = slices.filter((slice) => slice.value > 0);
  const total = parts.reduce((sum, slice) => sum + slice.value, 0);
  if (parts.length === 0 || total <= 0) return null;
  let angle = 0;
  const gap = parts.length > 1 ? 0.025 : 0;
  return (
    <div data-chart="pie" className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-8">
      <svg viewBox="0 0 100 100" className="h-44 w-44 flex-none" role="img" aria-label={parts.map((slice) => `${slice.label}: ${formatNumber(slice.value)} ${unit}`).join("; ")}>
        {parts.map((slice, index) => {
          const sweep = (slice.value / total) * Math.PI * 2;
          const start = angle + (parts.length > 1 ? gap / 2 : 0);
          const end = angle + sweep - (parts.length > 1 ? gap / 2 : 0.0001);
          angle += sweep;
          return <path key={slice.key} d={arc(start, end, 48, 28)} fill={categoricalColor(index)} />;
        })}
        <text x="50" y="49" textAnchor="middle" className="fill-current text-ink" fontSize="12" fontWeight="600">
          {formatNumber(total)}
        </text>
        <text x="50" y="60" textAnchor="middle" className="fill-current text-mute" fontSize="6">
          {unit}
        </text>
      </svg>
      <ul className="w-full max-w-sm space-y-1.5 text-sm">
        {parts.map((slice, index) => (
          <li key={slice.key} className="flex items-center justify-between gap-3">
            <span className="inline-flex min-w-0 items-center gap-2 text-ink">
              <span className="inline-block h-2.5 w-2.5 flex-none rounded-[3px]" style={{ backgroundColor: categoricalColor(index) }} aria-hidden />
              <span className="truncate" title={slice.label}>{slice.label}</span>
            </span>
            <span className="flex-none text-xs tabular-nums text-body">
              {formatNumber(slice.value)} · {formatPercent(sharePercent(slice.value, total))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
