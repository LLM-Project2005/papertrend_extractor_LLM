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
import type { ChatChartPayload } from "@/components/chat/ChatClient";

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
  const chartData = chart.data ?? [];
  const yKeys = chart.yKeys.length > 0 ? chart.yKeys : ["value"];
  const primaryKey = yKeys[0] ?? "value";
  const maxValue = Math.max(
    ...chartData.flatMap((row) =>
      yKeys.map((key) => Number(row[key]) || 0)
    ),
    0
  );

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
        <div className="h-[320px] px-3 py-4 text-slate-600 dark:text-[#a3a3a3]">
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
                layout={chartData.length > 6 ? "vertical" : "horizontal"}
                margin={{ left: chartData.length > 6 ? 30 : 6, right: 18, top: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" />
                <XAxis
                  type={chartData.length > 6 ? "number" : "category"}
                  dataKey={chartData.length > 6 ? undefined : "label"}
                  tick={{ fill: "currentColor", fontSize: 12 }}
                  domain={chartData.length > 6 ? [0, Math.ceil(maxValue)] : undefined}
                />
                <YAxis
                  type={chartData.length > 6 ? "category" : "number"}
                  dataKey={chartData.length > 6 ? "label" : undefined}
                  width={chartData.length > 6 ? 120 : undefined}
                  allowDecimals={false}
                  tick={{ fill: "currentColor", fontSize: 12 }}
                />
                <Tooltip {...chatChartTooltipTheme} />
                {yKeys.map((key, keyIndex) => (
                  <Bar isAnimationActive={chartAnimationActive()} key={key} dataKey={key} radius={[4, 4, 0, 0]}>
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
