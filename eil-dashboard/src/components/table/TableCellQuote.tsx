"use client";

/*
 * The table cell a question was asked from (docs/42, 2026-10-29), shown above
 * that question in Chat, as a reply quotes what it answers: the table and
 * column, what the cell says, its sentence and the paper.
 */
// React in scope: the test runner compiles JSX the classic way.
import React from "react";
import { TableIcon } from "@/components/ui/Icons";
import type { TableCellContext } from "@/lib/paper-table-chat";

export function cellStatusWords(cell: Pick<TableCellContext, "status" | "value" | "note">): string {
  if (cell.status === "found") return cell.note ? `${cell.value} (${cell.note})` : cell.value;
  if (cell.status === "unverified") return "Not confirmed";
  if (cell.status === "not_stated") return "Not stated";
  return "Not read yet";
}

export default function TableCellQuote({ cell }: { cell: TableCellContext }) {
  return (
    <div className="rounded-xl border border-hairline bg-subtle px-3.5 py-2.5 text-left text-[13px] leading-5" data-table-cell-quote="">
      <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-mute">
        <TableIcon aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          {cell.tableName} · {cell.columnName}
        </span>
      </p>
      <p className="mt-1 font-medium text-ink">{cellStatusWords(cell)}</p>
      {cell.quote && (cell.status === "found" || cell.status === "unverified") ? (
        <blockquote className="mt-1 line-clamp-3 border-l-2 border-hairline-strong pl-2.5 text-body">{cell.quote}</blockquote>
      ) : null}
      <p className="mt-1 truncate text-mute">
        {cell.paperTitle}
        {cell.year && cell.year !== "Unknown" ? ` · ${cell.year}` : ""}
      </p>
    </div>
  );
}
