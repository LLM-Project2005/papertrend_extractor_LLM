"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useDashboardData } from "@/hooks/useData";
import { WORKSPACE_GOALS, WORKSPACE_SOURCES } from "@/lib/workspace-profile";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";

function QuickAction({
  href,
  eyebrow,
  title,
  description,
}: {
  href: string;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-[28px] border border-[#dfd5c6] bg-white p-5 shadow-sm transition-transform hover:-translate-y-0.5"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b7357]">
        {eyebrow}
      </p>
      <h3 className="mt-3 text-xl font-semibold text-gray-900">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-gray-600">{description}</p>
    </Link>
  );
}

export default function WorkspaceHomeClient() {
  const { profile } = useWorkspaceProfile();
  const { data, loading } = useDashboardData();

  const summary = useMemo(() => {
    if (!data) {
      return {
        paperCount: 0,
        topicCount: 0,
        keywordCount: 0,
        yearRange: "No data yet",
      };
    }

    const papers = new Set(data.trends.map((row) => row.paper_id)).size;
    const topics = new Set(data.trends.map((row) => row.topic)).size;
    const keywords = new Set(data.trends.map((row) => row.keyword)).size;
    const years = [...new Set(data.trends.map((row) => row.year))].sort();

    return {
      paperCount: papers,
      topicCount: topics,
      keywordCount: keywords,
      yearRange:
        years.length > 0 ? `${years[0]} to ${years[years.length - 1]}` : "No data yet",
    };
  }, [data]);

  const activeSource = WORKSPACE_SOURCES.find(
    (source) => source.id === profile.primarySource
  );
  const activeGoal = WORKSPACE_GOALS.find((goal) => goal.id === profile.goal);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[34px] border border-[#d7c9b4] bg-[#172029] text-white shadow-sm">
        <div className="grid gap-8 px-6 py-8 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#9bb0bc]">
              Workspace home
            </p>
            <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight">
              {profile.name} is set up as a research workspace, not just a dashboard.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-[#d8e2e6]">
              Use this space to bring papers in, monitor ingestion, explore trends,
              and switch into a grounded assistant whenever you need synthesis.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/workspace/imports"
                className="rounded-full bg-[#f3dfba] px-5 py-3 text-sm font-semibold text-[#172029] transition-colors hover:bg-[#edd3a0]"
              >
                Upload or connect sources
              </Link>
              <Link
                href="/workspace/dashboard"
                className="rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                Open analytics
              </Link>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/5 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#9bb0bc]">
              Workspace profile
            </p>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-start justify-between gap-4">
                <dt className="text-[#9bb0bc]">Organization</dt>
                <dd className="text-right text-white">{profile.organization}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-[#9bb0bc]">Domain</dt>
                <dd className="text-right text-white">{profile.domain}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-[#9bb0bc]">Primary goal</dt>
                <dd className="text-right text-white">{activeGoal?.label}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-[#9bb0bc]">Primary source</dt>
                <dd className="text-right text-white">{activeSource?.label}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Papers in corpus",
            value: loading ? "..." : summary.paperCount.toLocaleString(),
          },
          {
            label: "Distinct topics",
            value: loading ? "..." : summary.topicCount.toLocaleString(),
          },
          {
            label: "Distinct keywords",
            value: loading ? "..." : summary.keywordCount.toLocaleString(),
          },
          {
            label: "Coverage window",
            value: loading ? "..." : summary.yearRange,
          },
        ].map((metric) => (
          <article
            key={metric.label}
            className="rounded-[28px] border border-[#dfd5c6] bg-white p-5 shadow-sm"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8b7357]">
              {metric.label}
            </p>
            <p className="mt-4 text-3xl font-semibold tracking-tight text-gray-900">
              {metric.value}
            </p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <QuickAction
          href="/workspace/dashboard"
          eyebrow="Module"
          title="Dashboard"
          description="Keep your charts and trend analysis available as a core workspace view."
        />
        <QuickAction
          href="/workspace/chat"
          eyebrow="Module"
          title="Chat"
          description="Ask grounded questions, compare themes, and jump back to paper evidence."
        />
        <QuickAction
          href="/workspace/papers"
          eyebrow="Module"
          title="Paper library"
          description="Inspect titles, keywords, evidence snippets, and track tags paper by paper."
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <article className="rounded-[32px] border border-[#dfd5c6] bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b7357]">
            First-session checklist
          </p>
          <div className="mt-4 space-y-4">
            {[
              {
                title: "Confirm workspace profile",
                done: profile.onboardingComplete,
                detail: "Tune name, domain, goal, and outputs in Settings when needed.",
              },
              {
                title: "Add your first data source",
                done: profile.primarySource === "pdf-upload" || profile.primarySource === "csv-import",
                detail: "PDF upload and notebook sync are active now. Connectors can follow.",
              },
              {
                title: "Validate the analytics view",
                done: !loading,
                detail: data?.useMock
                  ? "The workspace is still showing mock data until Supabase is populated."
                  : "Dashboard data is loading from Supabase-backed views.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-[24px] border border-gray-200 bg-[#faf8f4] p-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-base font-semibold text-gray-900">{item.title}</h3>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${
                      item.done
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {item.done ? "Ready" : "Pending"}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-gray-600">{item.detail}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[32px] border border-[#dfd5c6] bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b7357]">
            Source roadmap
          </p>
          <div className="mt-4 space-y-3">
            {WORKSPACE_SOURCES.map((source) => (
              <div
                key={source.id}
                className="rounded-[24px] border border-gray-200 bg-[#faf8f4] p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-gray-900">{source.label}</h3>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                      source.status === "ready"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-gray-200 text-gray-600"
                    }`}
                  >
                    {source.status}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  {source.description}
                </p>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
