"use client";

/**
 * A chart in a chat answer: a bar, line or pie chart, or a table. Its own
 * file so the chat page loads Recharts only when an answer has a chart
 * (docs/32, 3.3).
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartAnimationActive } from "@/lib/chart-theme";
import { TOPIC_PALETTE } from "@/lib/constants";
import { labelColumn, useIsNarrow } from "@/lib/use-narrow";
import type { ChatChartPayload } from "@/components/chat/ChatClient";

/** Splits a label into at most two lines of `chars` characters; a cut label ends in an ellipsis. */
export function wrapLabel(label: string, chars: number): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  let used = 0;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= chars) {
      line = next;
      used += 1;
      continue;
    }
    if (line) lines.push(line);
    if (lines.length === 2) break;
    line = word.length > chars ? `${word.slice(0, chars - 1)}…` : word;
    used += 1;
  }
  if (line && lines.length < 2) lines.push(line);
  const cut = used < words.length || lines.some((text) => text.endsWith("…"));
  if (cut && lines.length > 0) {
    const last = lines[lines.length - 1].replace(/…$/, "");
    lines[lines.length - 1] = `${last.slice(0, Math.max(1, chars - 1))}…`;
  }
  return lines.slice(0, 2);
}

/** A category tick on the label axis: two lines at most, with the whole label on hover. */
function LabelTick({ x, y, payload, chars }: { x?: number; y?: number; payload?: { value: string }; chars: number }) {
  const label = String(payload?.value ?? "");
  const lines = wrapLabel(label, chars);
  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      <title>{label}</title>
      <text textAnchor="end" fill="currentColor" fontSize={12} dy={lines.length > 1 ? -3 : 4}>
        {lines.map((text, index) => (
          <tspan key={index} x={-6} dy={index === 0 ? 0 : 14}>
            {text}
          </tspan>
        ))}
      </text>
    </g>
  );
}

const chatChartTooltipTheme = {
  contentStyle: {
    backgroundColor: "#111827",
    border: "1px solid rgba(148, 163, 184, 0.35)",
    borderRadius: "12px",
    boxShadow: "0 18px 40px rgba(0, 0, 0, 0.32)",
    color: "#fafafa",
  },
  labelStyle: {
    color: "#fafafa",
    fontWeight: 600,
  },
  itemStyle: {
    color: "#e5e7eb",
  },
  cursor: {
    fill: "rgba(148, 163, 184, 0.14)",
    stroke: "rgba(148, 163, 184, 0.25)",
  },
};

export default function ChatChartCard({ chart }: { chart: ChatChartPayload }) {
  const narrow = useIsNarrow();
  const chartData = chart.data ?? [];
  const yKeys = chart.yKeys.length > 0 ? chart.yKeys : ["value"];
  const primaryKey = yKeys[0] ?? "value";
  const maxValue = Math.max(
    ...chartData.flatMap((row) =>
      yKeys.map((key) => Number(row[key]) || 0)
    ),
    0
  );

  // Bars run sideways, names on the left, whenever a name is long or there are
  // many: upright bars gave each name a few pixels, and long paper titles were
  // drawn over one another (the test account's chat, 2026-10-09). The chart
  // grows with its rows instead of squeezing them into a fixed height.
  const longestLabel = Math.max(0, ...chartData.map((row) => String(row.label ?? "").length));
  const sideways = chartData.length > 6 || longestLabel > 14;
  const column = labelColumn(narrow, {
    width: Math.min(240, Math.max(96, Math.min(longestLabel, 34) * 6.6)),
    chars: Math.min(34, Math.max(14, longestLabel)),
  });
  const series = yKeys.length;
  const rowHeight = series > 1 ? 14 * series + 18 : 38;
  const barHeight = sideways ? Math.max(200, Math.min(760, chartData.length * rowHeight + (series > 1 ? 90 : 50))) : 320;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-[#1f1f1f] dark:bg-[#050505]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-[#1f1f1f]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-slate-600 dark:text-[#8e8e8e]">
            Chart
          </p>
          <h3 className="mt-1 text-base font-semibold text-slate-900 dark:text-white">
            {chart.title}
          </h3>
          <p className="mt-1 text-xs text-slate-600 dark:text-[#a3a3a3]">
            {chart.scopeLabel}
          </p>
        </div>
        <span className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 dark:border-[#1f1f1f] dark:text-[#d8d8d8]">
          {chart.chartType}
        </span>
      </div>

      {chart.chartType === "table" ? (
        <div className="max-h-[360px] overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-100 text-slate-600 dark:bg-[#050505] dark:text-[#b4b4b4]">
              <tr>
                <th className="px-4 py-3 font-semibold">Label</th>
                {yKeys.map((key) => (
                  <th key={key} className="px-4 py-3 text-right font-semibold">
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chartData.map((row) => (
                <tr key={String(row.label)} className="border-t border-slate-200 dark:border-[#1f1f1f]">
                  <td className="px-4 py-3 text-slate-700 dark:text-[#ececec]">{row.label}</td>
                  {yKeys.map((key) => (
                    <td
                      key={key}
                      className="px-4 py-3 text-right font-medium text-slate-900 dark:text-white"
                    >
                      {Number(row[key]) || 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-3 py-4 text-slate-600 dark:text-[#a3a3a3]" style={{ height: chart.chartType === "bar" ? barHeight : 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            {chart.chartType === "line" ? (
              <LineChart data={chartData} margin={{ left: 6, right: 18, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" />
                <XAxis dataKey="label" tick={{ fill: "currentColor", fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fill: "currentColor", fontSize: 12 }} />
                <Tooltip {...chatChartTooltipTheme} />
                {yKeys.map((key, index) => (
                  <Line isAnimationActive={chartAnimationActive()}
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={TOPIC_PALETTE[index % TOPIC_PALETTE.length]}
                    strokeWidth={2.4}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                ))}
              </LineChart>
            ) : chart.chartType === "pie" ? (
              <PieChart>
                <Tooltip {...chatChartTooltipTheme} />
                <Pie isAnimationActive={chartAnimationActive()}
                  data={chartData}
                  dataKey={primaryKey}
                  nameKey="label"
                  outerRadius={105}
                  label={(entry) => entry.label}
                >
                  {chartData.map((row, index) => (
                    <Cell
                      key={`${row.label}-${index}`}
                      fill={TOPIC_PALETTE[index % TOPIC_PALETTE.length]}
                    />
                  ))}
                </Pie>
              </PieChart>
            ) : (
              <BarChart
                data={chartData}
                layout={sideways ? "vertical" : "horizontal"}
                margin={{ left: 6, right: 18, top: 8, bottom: 8 }}
                barCategoryGap={series > 1 ? "18%" : "24%"}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" horizontal={!sideways} vertical={sideways} />
                <XAxis
                  type={sideways ? "number" : "category"}
                  dataKey={sideways ? undefined : "label"}
                  tick={{ fill: "currentColor", fontSize: 12 }}
                  domain={sideways ? [0, Math.ceil(maxValue)] : undefined}
                  allowDecimals={false}
                  interval={0}
                />
                <YAxis
                  type={sideways ? "category" : "number"}
                  dataKey={sideways ? "label" : undefined}
                  width={sideways ? column.width : undefined}
                  allowDecimals={false}
                  interval={0}
                  tick={sideways ? <LabelTick chars={column.chars} /> : { fill: "currentColor", fontSize: 12 }}
                />
                <Tooltip {...chatChartTooltipTheme} />
                {series > 1 ? <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} /> : null}
                {yKeys.map((key, keyIndex) => (
                  <Bar
                    isAnimationActive={chartAnimationActive()}
                    key={key}
                    dataKey={key}
                    fill={TOPIC_PALETTE[keyIndex % TOPIC_PALETTE.length]}
                    radius={sideways ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                    maxBarSize={sideways ? 28 : 64}
                  >
                    {chartData.map((row, index) => (
                      <Cell
                        key={`${String(row.label)}-${key}-${index}`}
                        fill={
                          yKeys.length > 1
                            ? TOPIC_PALETTE[keyIndex % TOPIC_PALETTE.length]
                            : TOPIC_PALETTE[index % TOPIC_PALETTE.length]
                        }
                      />
                    ))}
                  </Bar>
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
