"use client";

import Link from "next/link";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import { buildWorkspacePath } from "@/lib/workspace-routes";
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
  const { currentOrganization, currentProject } = useWorkspaceProfile();
  const analyzePath = buildWorkspacePath({
    organizationId: currentOrganization?.id ?? null,
    projectId: currentProject?.id ?? null,
    projectName: currentProject?.name ?? null,
    section: "home",
    query: { analyze: 1 },
  });
  const importsPath = buildWorkspacePath({
    organizationId: currentOrganization?.id ?? null,
    projectId: currentProject?.id ?? null,
    projectName: currentProject?.name ?? null,
    section: "imports",
  });

  return (
    <section className="app-surface mx-auto max-w-4xl px-6 py-8 text-center sm:px-8">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-[#232323] dark:text-[#c7c7c7]">
        <UploadIcon className="h-6 w-6" />
      </span>
      <p className="mt-4 text-sm font-medium text-slate-500 dark:text-[#8f8f8f]">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 dark:text-[#f2f2f2]">
        {title}
      </h1>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-slate-500 dark:text-[#a3a3a3]">
        {description}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link
          href={analyzePath}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-[#ececec] dark:text-[#171717] dark:hover:bg-white"
        >
          <span>Analyze documents</span>
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
        <Link
          href={importsPath}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#2f2f2f] dark:bg-[#171717] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
        >
          Open imports
        </Link>
      </div>
    </section>
  );
}
