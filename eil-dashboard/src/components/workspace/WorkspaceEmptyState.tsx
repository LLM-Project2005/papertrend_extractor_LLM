"use client";

import Link from "next/link";
import { ArrowRightIcon, UploadIcon } from "@/components/ui/Icons";

export default function WorkspaceEmptyState({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <section className="mx-auto max-w-3xl border-y border-papertrend-line px-6 py-12 text-center sm:px-8">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-papertrend-line bg-papertrend-raised text-papertrend-action">
        <UploadIcon className="h-6 w-6" />
      </span>
      <p className="papertrend-kicker mt-5">
        {eyebrow}
      </p>
      <h1 className="papertrend-page-title mt-3">
        {title}
      </h1>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-papertrend-muted">
        {description}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link
          href="/workspace/home?analyze=1"
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-papertrend-action px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--pt-action-hover)]"
        >
          <span>Analyze documents</span>
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
        <Link
          href="/workspace/imports"
          className="inline-flex min-h-11 items-center rounded-md border border-papertrend-line bg-papertrend-surface px-4 py-2.5 text-sm font-semibold text-papertrend-muted transition-colors hover:border-[var(--pt-line-strong)] hover:text-papertrend-ink"
        >
          Open imports
        </Link>
      </div>
    </section>
  );
}
