import Link from "next/link";
import {
  ArrowRightIcon,
  ChartIcon,
  ChatIcon,
  LogoMarkIcon,
  PaperIcon,
  UploadIcon,
} from "@/components/ui/Icons";

const CORE_MODULES = [
  {
    title: "Dashboard",
    description: "Track trends, themes, and category changes across the corpus.",
    icon: ChartIcon,
  },
  {
    title: "Chat",
    description: "Ask grounded questions and move directly into cited papers.",
    icon: ChatIcon,
  },
  {
    title: "Papers",
    description: "Inspect titles, keywords, evidence, and track assignments.",
    icon: PaperIcon,
  },
  {
    title: "Imports",
    description: "Upload PDFs or sync structured outputs into the workspace.",
    icon: UploadIcon,
  },
] as const;

const JOURNEY = [
  {
    step: "01",
    title: "Set up the workspace",
    description:
      "Define the team, domain, goal, and preferred outputs before anyone starts exploring data.",
  },
  {
    step: "02",
    title: "Bring sources in",
    description:
      "Start with PDF upload or notebook sync, then add richer institutional connectors later.",
  },
  {
    step: "03",
    title: "Work inside one system",
    description:
      "Move between analytics, grounded chat, and paper-level review without switching products.",
  },
] as const;

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
              <LogoMarkIcon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">Papertrend</p>
              <p className="text-xs text-slate-500">Research workspace</p>
            </div>
          </Link>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/start"
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              Start here
            </Link>
            <Link
              href="/workspace/home"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900"
            >
              Open workspace
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <section className="rounded-3xl border border-slate-200 bg-white px-6 py-8 sm:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-slate-500">
              Research intelligence for departments, labs, and faculty teams
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
              Turn scattered research papers into a clean, guided workspace.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600">
              Start with a simple setup flow, bring documents into the system, and
              keep dashboard analytics, grounded chat, and paper review in one place.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/start"
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              <span>Start setup</span>
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
            <Link
              href="/workspace/dashboard"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900"
            >
              View dashboard module
            </Link>
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {CORE_MODULES.map((item) => {
            const Icon = item.icon;
            return (
              <article
                key={item.title}
                className="rounded-2xl border border-slate-200 bg-white px-5 py-5"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="mt-4 text-base font-semibold text-slate-900">
                  {item.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {item.description}
                </p>
              </article>
            );
          })}
        </section>

        <section className="mt-8 rounded-3xl border border-slate-200 bg-white px-6 py-6 sm:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-slate-500">How it works</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
              Keep the dashboard, but put it inside a broader workflow.
            </h2>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {JOURNEY.map((item) => (
              <article
                key={item.step}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {item.step}
                </p>
                <h3 className="mt-3 text-lg font-semibold text-slate-900">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {item.description}
                </p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
