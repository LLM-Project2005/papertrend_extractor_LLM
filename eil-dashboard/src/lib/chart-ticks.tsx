// React in scope: the test runner compiles JSX the classic way.
import React from "react";
import type { ChartTheme } from "@/lib/chart-theme";

/*
 * Axis names on two lines instead of cut short (2026-10-24 review: "English
 * as an international lan…", "Formative and Classroom Assessment Prac…").
 * Recharts draws a category tick as one line of SVG text, which cannot wrap,
 * so a horizontal bar chart's names are split here at spaces. The full name
 * stays in the tooltip and in the chart's values list.
 */

/** A name in at most `lines` lines of about `chars` characters, split at spaces; the last line ends in "…" if cut. */
export function wrapLabel(text: string, chars: number, lines = 2): string[] {
  const words = String(text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const result: string[] = [];
  let current = "";
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const next = current ? `${current} ${word}` : word;
    if (next.length <= chars || !current) {
      current = next;
      continue;
    }
    result.push(current);
    current = word;
    if (result.length === lines - 1) {
      const rest = words.slice(index).join(" ");
      result.push(rest.length > chars ? `${rest.slice(0, Math.max(1, chars - 1)).trimEnd()}…` : rest);
      return result;
    }
  }
  if (current) result.push(current.length > chars ? `${current.slice(0, Math.max(1, chars - 1))}…` : current);
  return result;
}

/**
 * A category-axis tick for a horizontal bar chart, in up to two lines centred
 * on the bar: `tick={wrappedTick(ct, 32)}`.
 */
export function wrappedTick(theme: ChartTheme, chars: number, fontSize = 11, lines = 2) {
  return function WrappedTick(props: { x?: number | string; y?: number | string; payload?: { value?: unknown } }) {
    const x = Number(props.x ?? 0);
    const y = Number(props.y ?? 0);
    const parts = wrapLabel(String(props.payload?.value ?? ""), chars, lines);
    const lineHeight = fontSize + 2;
    const top = -((parts.length - 1) * lineHeight) / 2;
    return (
      <g transform={`translate(${x},${y})`}>
        <title>{String(props.payload?.value ?? "")}</title>
        <text x={-6} y={top} textAnchor="end" fontSize={fontSize} fill={theme.label} className="recharts-cartesian-axis-tick-value">
          {parts.map((part, index) => (
            <tspan key={index} x={-6} dy={index === 0 ? "0.35em" : lineHeight}>
              {part}
            </tspan>
          ))}
        </text>
      </g>
    );
  };
}
