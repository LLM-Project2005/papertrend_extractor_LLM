"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";

const NAV_ITEMS = [
  {
    href: "/workspace/home",
    label: "Home",
    description: "Workspace overview and next actions",
  },
  {
    href: "/workspace/dashboard",
    label: "Dashboard",
    description: "Analytics, trends, and track views",
  },
  {
    href: "/workspace/chat",
    label: "Chat",
    description: "Ask grounded questions across the corpus",
  },
  {
    href: "/workspace/papers",
    label: "Papers",
    description: "Explore titles, topics, keywords, and evidence",
  },
  {
    href: "/workspace/imports",
    label: "Imports",
    description: "Upload PDFs and manage source connections",
  },
  {
    href: "/workspace/settings",
    label: "Settings",
    description: "Adjust workspace identity and defaults",
  },
] as const;

export default function WorkspaceShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { profile } = useWorkspaceProfile();

  return (
    <div className="min-h-screen bg-[#f6f1e8] text-gray-900">
      <div className="grid min-h-screen lg:grid-cols-[290px_minmax(0,1fr)]">
        <aside className="border-b border-[#d9cfbf] bg-[#1d2b34] px-5 py-6 text-[#dce6ea] lg:border-b-0 lg:border-r lg:px-6">
          <div className="mb-8">
            <Link href="/" className="inline-flex items-center gap-3">
              <span className="rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white">
                PT
              </span>
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#9bb0bc]">
                  Papertrend
                </p>
                <p className="text-xl font-semibold text-white">Workspace</p>
              </div>
            </Link>
          </div>

          <section className="rounded-[28px] border border-white/10 bg-white/5 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#9bb0bc]">
              Active workspace
            </p>
            <h1 className="mt-3 text-2xl font-semibold text-white">
              {profile.name}
            </h1>
            <p className="mt-2 text-sm leading-6 text-[#c4d0d6]">
              {profile.organization}
            </p>
            <p className="mt-1 text-sm leading-6 text-[#9bb0bc]">
              {profile.domain}
            </p>
          </section>

          <nav className="mt-6 space-y-2">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded-[22px] border px-4 py-3 transition-colors ${
                    isActive
                      ? "border-[#e8c98f] bg-[#f3dfba] text-[#172029]"
                      : "border-white/10 bg-white/5 text-[#dce6ea] hover:border-white/20 hover:bg-white/10"
                  }`}
                >
                  <p className="text-sm font-semibold">{item.label}</p>
                  <p
                    className={`mt-1 text-xs leading-5 ${
                      isActive ? "text-[#43515a]" : "text-[#9bb0bc]"
                    }`}
                  >
                    {item.description}
                  </p>
                </Link>
              );
            })}
          </nav>

          <section className="mt-6 rounded-[28px] border border-white/10 bg-[#233742] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#9bb0bc]">
              Intake mode
            </p>
            <p className="mt-3 text-sm font-semibold text-white">
              {profile.primarySource === "pdf-upload"
                ? "PDF upload ready"
                : profile.primarySource === "csv-import"
                  ? "Batch sync ready"
                  : "Connector planning"}
            </p>
            <p className="mt-2 text-sm leading-6 text-[#c4d0d6]">
              PDF upload and notebook sync are ready now. Enterprise connectors can
              be layered in later without changing the dashboard and chat modules.
            </p>
          </section>

          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <Link
              href="/start"
              className="rounded-full border border-white/15 px-4 py-2 text-[#dce6ea] hover:border-white/30 hover:bg-white/10"
            >
              Update setup
            </Link>
            <Link
              href="/"
              className="rounded-full border border-transparent px-4 py-2 text-[#9bb0bc] hover:text-white"
            >
              View landing page
            </Link>
          </div>
        </aside>

        <div className="min-w-0">
          <div className="sticky top-0 z-10 border-b border-[#dfd5c6] bg-[#f6f1e8]/90 px-4 py-4 backdrop-blur sm:px-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b7357]">
                  Research intelligence workspace
                </p>
                <p className="mt-1 text-sm text-[#5a5248]">
                  Upload or sync documents, then move between analytics, chat, and
                  paper-level evidence without leaving the workspace.
                </p>
              </div>
              <Link
                href="/workspace/imports"
                className="rounded-full bg-[#172029] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#253644]"
              >
                Add documents
              </Link>
            </div>
          </div>

          <main className="min-w-0 px-4 py-6 sm:px-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
