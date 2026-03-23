"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useDashboardData } from "@/hooks/useData";
import { WORKSPACE_GOALS, WORKSPACE_SOURCES } from "@/lib/workspace-profile";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import {
  ArrowRightIcon,
  ChartIcon,
  ChatIcon,
  CheckCircleIcon,
  CircleIcon,
  PaperIcon,
  UploadIcon,
} from "@/components/ui/Icons";

function MetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span className="text-slate-400">{icon}</span>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">
        {value}
      </p>
    </article>
  );
}

function QuickLink({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-4 transition-colors hover:border-slate-300"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-slate-400">{icon}</span>
        <div>
          <p className="text-sm font-medium text-slate-900">{title}</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        </div>
      </div>
      <ArrowRightIcon className="mt-1 h-4 w-4 flex-none text-slate-300" />
    </Link>
  );
}

export default function WorkspaceHomeClient() {
  const { profile } = useWorkspaceProfile();
  const { data, loading } = useDashboardData();

  const summary = useMemo(() => {
    if (!data) {
      return {
        paperCount: "0",
        topicCount: "0",
        keywordCount: "0",
        yearRange: "No data yet",
      };
    }

    const papers = new Set(data.trends.map((row) => row.paper_id)).size;
    const topics = new Set(data.trends.map((row) => row.topic)).size;
    const keywords = new Set(data.trends.map((row) => row.keyword)).size;
    const years = [...new Set(data.trends.map((row) => row.year))].sort();

    return {
      paperCount: papers.toLocaleString(),
      topicCount: topics.toLocaleString(),
      keywordCount: keywords.toLocaleString(),
      yearRange:
        years.length > 0 ? `${years[0]} to ${years[years.length - 1]}` : "No data yet",
    };
  }, [data]);

  const activeSource = WORKSPACE_SOURCES.find(
    (source) => source.id === profile.primarySource
  );
  const activeGoal = WORKSPACE_GOALS.find((goal) => goal.id === profile.goal);

  const checklist = [
    {
      title: "Confirm workspace profile",
      detail: "Name, domain, goal, and outputs can all be tuned from Settings.",
      done: profile.onboardingComplete,
    },
    {
      title: "Add the first source",
      detail: "PDF upload and notebook sync are ready for the current pipeline.",
      done:
        profile.primarySource === "pdf-upload" ||
        profile.primarySource === "csv-import",
    },
    {
      title: "Validate analytics data",
      detail: data?.useMock
        ? "The dashboard is still showing preview data until Supabase is populated."
        : "Analytics are reading from the current Supabase-backed dataset.",
      done: !loading,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white px-6 py-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">Workspace overview</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
              {profile.name}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
              A clean control center for bringing in papers, reviewing analytics,
              and switching into grounded chat without bouncing between separate tools.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/workspace/dashboard"
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              Open dashboard
            </Link>
            <Link
              href="/workspace/chat"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900"
            >
              Open chat
            </Link>
            <Link
              href="/workspace/imports"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900"
            >
              Add source
            </Link>
          </div>
        </div>
      </section>

      {data?.useMock && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          The workspace is currently showing preview data. Connect Supabase and run
          the import flow to replace this with real results.
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Papers"
          value={loading ? "..." : summary.paperCount}
          icon={<PaperIcon className="h-5 w-5" />}
        />
        <MetricCard
          label="Topics"
          value={loading ? "..." : summary.topicCount}
          icon={<ChartIcon className="h-5 w-5" />}
        />
        <MetricCard
          label="Keywords"
          value={loading ? "..." : summary.keywordCount}
          icon={<ChatIcon className="h-5 w-5" />}
        />
        <MetricCard
          label="Coverage"
          value={loading ? "..." : summary.yearRange}
          icon={<UploadIcon className="h-5 w-5" />}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <article className="rounded-3xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Continue setup</h2>
              <p className="mt-1 text-sm text-slate-500">
                Keep the workspace focused on the next meaningful actions.
              </p>
            </div>
            <Link
              href="/start"
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Edit setup
            </Link>
          </div>

          <div className="mt-5 divide-y divide-slate-200">
            {checklist.map((item) => (
              <div key={item.title} className="flex items-start gap-4 py-4 first:pt-0">
                <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center">
                  {item.done ? (
                    <CheckCircleIcon className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <CircleIcon className="h-5 w-5 text-slate-300" />
                  )}
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-900">{item.title}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </article>

        <div className="space-y-6">
          <article className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Quick access</h2>
            <div className="mt-4 space-y-3">
              <QuickLink
                href="/workspace/dashboard"
                title="Dashboard"
                description="Trends, tracks, keywords, and the current research picture."
                icon={<ChartIcon className="h-5 w-5" />}
              />
              <QuickLink
                href="/workspace/chat"
                title="Chat"
                description="Ask grounded questions and follow citations back to papers."
                icon={<ChatIcon className="h-5 w-5" />}
              />
              <QuickLink
                href="/workspace/papers"
                title="Paper library"
                description="Review titles, keywords, evidence, and track tags directly."
                icon={<PaperIcon className="h-5 w-5" />}
              />
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Workspace profile</h2>
            <dl className="mt-4 space-y-4 text-sm">
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500">Organization</dt>
                <dd className="text-right font-medium text-slate-900">
                  {profile.organization}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500">Domain</dt>
                <dd className="text-right font-medium text-slate-900">
                  {profile.domain}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500">Goal</dt>
                <dd className="text-right font-medium text-slate-900">
                  {activeGoal?.label}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500">Primary source</dt>
                <dd className="text-right font-medium text-slate-900">
                  {activeSource?.label}
                </dd>
              </div>
            </dl>
          </article>
        </div>
      </section>
    </div>
  );
}
