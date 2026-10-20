"use client";

/*
 * A table, for what a chart would only blur (docs/38): a few papers side by
 * side, values that are all the same, or more classes than colours. The first
 * column opens its paper when the row is one.
 */
// React in scope: the test runner compiles JSX the classic way.
import React, { useState } from "react";
import { ShowAll } from "@/components/charts/parts";
import type { PaperId } from "@/types/database";

export interface TableColumn {
  key: string;
  label: string;
  align?: "left" | "right";
}

export interface TableRow {
  key: string;
  cells: Record<string, string | number | string[] | null | undefined>;
  /** The paper the row is, so its first cell opens it. */
  paperId?: PaperId;
}

function cellText(value: TableRow["cells"][string]): string {
  if (value === null || value === undefined || value === "") return "–";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "–";
  return typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : value;
}

export default function DataTable({
  columns,
  rows,
  onOpen,
  initialRows = 12,
  caption,
}: {
  columns: TableColumn[];
  rows: TableRow[];
  onOpen?: (paperIds: PaperId[], label: string) => void;
  initialRows?: number;
  caption?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0 || columns.length === 0) return null;
  const shown = rows.slice(0, expanded ? rows.length : initialRows);
  return (
    <div data-chart="table">
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="border-b border-hairline-strong">
              {columns.map((column) => (
                <th key={column.key} scope="col" className={`px-2 pb-2 text-xs font-medium text-body first:pl-0 ${column.align === "right" ? "text-right" : ""}`}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.key} className="border-b border-hairline align-top last:border-b-0">
                {columns.map((column, index) => {
                  const text = cellText(row.cells[column.key]);
                  const many = Array.isArray(row.cells[column.key]) && (row.cells[column.key] as string[]).length > 0;
                  return index === 0 ? (
                    <th key={column.key} scope="row" className="max-w-[18rem] py-2 pr-2 text-left font-medium leading-5 text-ink">
                      {onOpen && row.paperId !== undefined ? (
                        <button type="button" onClick={() => onOpen([row.paperId!], text)} className="text-left underline-offset-2 hover:underline focus-visible:underline">
                          {text}
                        </button>
                      ) : (
                        text
                      )}
                    </th>
                  ) : (
                    <td key={column.key} className={`px-2 py-2 leading-5 text-body ${column.align === "right" ? "text-right tabular-nums" : ""}`}>
                      {many ? (
                        <span className="flex flex-wrap gap-1">
                          {(row.cells[column.key] as string[]).map((item) => (
                            <span key={item} className="rounded-full bg-subtle px-2 py-0.5 text-xs text-ink">
                              {item}
                            </span>
                          ))}
                        </span>
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ShowAll shown={shown.length} total={rows.length} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
    </div>
  );
}
