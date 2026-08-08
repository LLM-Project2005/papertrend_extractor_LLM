import type { Metadata } from "next";
import Link from "next/link";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import { MarketingShell } from "@/components/marketing/MarketingLayout";
import { AnimatedProductFrame, MotionReveal } from "@/components/marketing/MarketingMotion";
import { marketingFeatures, workflowSteps } from "@/components/marketing/marketing-content";
import { ArrowRightIcon, CheckCircleIcon } from "@/components/ui/Icons";

export const metadata: Metadata = {
  title: "Papertrend | Research libraries into living insight",
  description:
    "Papertrend turns research paper collections into structured analysis, dashboards, charts, and grounded research chat.",
};

export default function LandingPage() {
  return (
    <MarketingShell>
      <section className="relative overflow-hidden border-b border-papertrend-line px-4 pb-16 pt-28 sm:px-6 lg:pb-20 lg:pt-36">
        <div className="relative mx-auto max-w-7xl">
          <div className="grid min-w-0 gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-end">
            <MotionReveal className="min-w-0 pb-2">
              <p className="papertrend-kicker">Research intelligence workspace</p>
              <h1 className="mt-5 max-w-3xl font-serif text-5xl font-semibold leading-[0.98] text-papertrend-ink sm:text-6xl lg:text-7xl">
                Your research library, made legible.
              </h1>
            </MotionReveal>

            <MotionReveal delay={0.08} className="min-w-0 max-w-full overflow-hidden border-l-2 border-papertrend-cyan pl-5 sm:pl-7">
              <p className="w-full max-w-2xl text-base leading-8 text-papertrend-muted sm:text-lg">
                Papertrend turns PDFs into structured evidence, visible research
                patterns, and grounded answers. Follow every paper from upload to
                analysis without losing the source behind the insight.
              </p>
              <div className="mt-7 grid w-full gap-3 sm:flex sm:flex-wrap">
                <MarketingCTA className="w-full sm:w-auto" />
                <Link
                  href="/docs/getting-started"
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-papertrend-line bg-papertrend-surface px-5 py-2.5 text-sm font-semibold text-papertrend-ink transition-colors hover:border-[var(--pt-line-strong)] hover:bg-papertrend-raised sm:w-auto"
                >
                  Read the workflow
                  <ArrowRightIcon className="h-4 w-4" />
                </Link>
              </div>
            </MotionReveal>
          </div>

          <AnimatedProductFrame />
        </div>
      </section>

      <section className="border-b border-papertrend-line bg-papertrend-raised px-4 py-14 sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.65fr_1.35fr]">
          <MotionReveal>
            <p className="papertrend-kicker">One continuous record</p>
            <h2 className="mt-4 max-w-md font-serif text-3xl font-semibold leading-tight text-papertrend-ink sm:text-4xl">
              From collection to defensible finding.
            </h2>
          </MotionReveal>
          <div className="grid border-y border-papertrend-line sm:grid-cols-2 lg:grid-cols-4">
            {workflowSteps.map((step, index) => {
              const Icon = step.icon;
              return (
                <MotionReveal
                  key={step.title}
                  delay={index * 0.06}
                  className="relative min-w-0 border-b border-papertrend-line px-5 py-6 last:border-b-0 sm:[&:nth-child(odd)]:border-r lg:border-b-0 lg:border-r lg:last:border-r-0"
                >
                  <div className="flex items-center justify-between gap-3">
                    <Icon className="h-5 w-5 text-papertrend-action" />
                    <span className="font-mono text-xs text-papertrend-muted">0{index + 1}</span>
                  </div>
                  <h3 className="mt-7 text-base font-semibold text-papertrend-ink">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-papertrend-muted">{step.copy}</p>
                </MotionReveal>
              );
            })}
          </div>
        </div>
      </section>

      <section className="px-4 py-20 sm:px-6 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <MotionReveal className="grid gap-5 border-b border-papertrend-line pb-9 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <div>
              <p className="papertrend-kicker">Built around the corpus</p>
              <h2 className="mt-4 font-serif text-4xl font-semibold leading-tight text-papertrend-ink sm:text-5xl">
                Four capabilities. One evidence trail.
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-7 text-papertrend-muted lg:justify-self-end">
              Analysis, dashboards, chat, and background processing operate on the
              same repository context, so every overview can lead back to a paper.
            </p>
          </MotionReveal>

          <div className="divide-y divide-papertrend-line">
            {marketingFeatures.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <MotionReveal
                  key={feature.slug}
                  delay={0.04}
                  className="group grid gap-5 py-8 md:grid-cols-[72px_0.7fr_1.3fr_auto] md:items-center"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-md border border-papertrend-line bg-papertrend-raised text-papertrend-action">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-mono text-xs text-papertrend-muted">0{index + 1}</p>
                    <h3 className="mt-2 text-xl font-semibold text-papertrend-ink">{feature.navLabel}</h3>
                  </div>
                  <p className="max-w-2xl text-sm leading-7 text-papertrend-muted">{feature.homeSummary}</p>
                  <Link
                    href={`/features/${feature.slug}`}
                    className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-papertrend-action"
                  >
                    View capability
                    <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                </MotionReveal>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-y border-papertrend-line bg-papertrend-ink px-4 py-16 text-white sm:px-6 lg:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-center">
          <MotionReveal>
            <p className="font-mono text-xs uppercase text-[#9bdce2]">Research with provenance</p>
            <h2 className="mt-4 max-w-3xl font-serif text-4xl font-semibold leading-tight sm:text-5xl">
              Ask difficult questions without detaching the answer from its sources.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[#c7d0dc]">
              Inspect the paper, compare the corpus, build the chart, and keep the
              citation trail inside one working environment.
            </p>
          </MotionReveal>
          <MotionReveal delay={0.08} className="border-l border-[#526176] pl-6">
            <ul className="space-y-4">
              {["Owner-scoped repository context", "Paper-title citations", "Visible processing stages", "Complete-scope analysis"].map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm text-[#e5ebf2]">
                  <CheckCircleIcon className="h-4 w-4 flex-none text-[#55c8d2]" />
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <MarketingCTA />
            </div>
          </MotionReveal>
        </div>
      </section>
    </MarketingShell>
  );
}
