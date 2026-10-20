"use client";

/*
 * One value, as a number rather than a one-bar chart (docs/38): "All 6
 * papers: English Language Instruction", "1 paper states it: 49 participants".
 */
// React in scope: the test runner compiles JSX the classic way.
import React from "react";
import type { PaperId } from "@/types/database";

export default function StatTile({
  value,
  label,
  detail,
  paperIds,
  onOpen,
}: {
  value: string;
  label: string;
  detail?: string;
  paperIds?: PaperId[];
  onOpen?: (paperIds: PaperId[], label: string) => void;
}) {
  return (
    <div data-chart="stat" className="rounded-xl bg-subtle px-4 py-4">
      <p className="text-3xl font-semibold leading-9 tracking-tight text-ink">{value}</p>
      <p className="mt-1 text-sm leading-5 text-ink">{label}</p>
      {detail ? <p className="mt-0.5 text-xs leading-5 text-body">{detail}</p> : null}
      {onOpen && paperIds && paperIds.length > 0 ? (
        <button
          type="button"
          onClick={() => onOpen(paperIds, label)}
          className="mt-2 inline-flex min-h-8 items-center text-xs font-medium text-body underline-offset-2 hover:text-ink hover:underline"
        >
          Show the {paperIds.length === 1 ? "paper" : `${paperIds.length} papers`}
        </button>
      ) : null}
    </div>
  );
}
