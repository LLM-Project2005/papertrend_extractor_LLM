import type { Metadata } from "next";
import Link from "next/link";
import { FeatureBand, FinalCTA, SellingPoint } from "@/components/marketing/FeatureBand";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import { MarketingShell } from "@/components/marketing/MarketingLayout";
import { AnimatedProductFrame, MotionReveal } from "@/components/marketing/MarketingMotion";
import {
  marketingFeatures,
  proofMetrics,
  valuePillars,
  workflowSteps,
} from "@/components/marketing/marketing-content";
import { ArrowRightIcon } from "@/components/ui/Icons";

export const metadata: Metadata = {
  title: "Papertrend | Research libraries into living insight",
  description:
    "Papertrend turns research paper collections into structured analysis, dashboards, charts, and AI research chat.",
};

export default function LandingPage() {
  return (
    <MarketingShell>
      <section className="relative overflow-hidden px-4 pb-20 pt-32 sm:px-6 lg:pb-28">
        <div className="marketing-grid pointer-events-none absolute inset-0 opacity-40" />
        <div className="absolute inset-x-0 top-16 h-px bg-gradient-to-r from-transparent via-[#2a2a2a] to-transparent" />
        <div className="relative mx-auto max-w-7xl text-center">
          <MotionReveal>
            <p className="mx-auto inline-flex rounded-md border border-[#1f1f1f] bg-[#050505] px-3 py-1.5 font-mono text-xs text-[#8f8f8f]">
              RESEARCH INTELLIGENCE PLATFORM
            </p>
            <h1 className="mx-auto mt-7 max-w-5xl text-5xl font-semibold leading-tight text-white sm:text-7xl lg:text-8xl">
              Turn research libraries into living insight.
            </h1>
            <p className="mx-auto mt-7 max-w-3xl text-base leading-8 text-[#a3a3a3] sm:text-lg">
              Papertrend analyzes paper collections, organizes evidence, visualizes
              research movement, and gives every workspace an AI layer that can
              reason across files, charts, and web citations.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <MarketingCTA />
              <Link
                href="/features/paper-analysis"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#2a2a2a] bg-[#050505] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:border-[#4d4d4d] hover:bg-[#0a0a0a]"
              >
                Explore features
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>
          </MotionReveal>

          <AnimatedProductFrame />
        </div>
      </section>

      <section className="border-y border-[#1f1f1f] bg-[#030303]">
        <div className="mx-auto grid max-w-7xl gap-px bg-[#1f1f1f] sm:grid-cols-3">
          {proofMetrics.map((item) => (
            <div key={item.label} className="bg-[#030303] px-6 py-8 text-center">
              <p className="text-3xl font-semibold text-white">{item.value}</p>
              <p className="mt-2 text-sm text-[#8f8f8f]">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <MotionReveal className="max-w-3xl">
          <p className="font-mono text-xs text-[#8f8f8f]">CAPABILITIES</p>
          <h2 className="mt-4 text-3xl font-semibold leading-tight text-white sm:text-5xl">
            One workspace for papers, charts, chat, and cloud analysis.
          </h2>
          <p className="mt-5 text-base leading-7 text-[#a3a3a3]">
            Start with a folder of PDFs and move toward a searchable research
            system with evidence, dashboard views, charts, and AI conversation.
          </p>
        </MotionReveal>

        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {marketingFeatures.map((feature, index) => (
            <FeatureBand key={feature.slug} feature={feature} delay={index * 0.08} />
          ))}
        </div>
      </section>

      <section className="border-y border-[#1f1f1f] bg-[#030303] px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <MotionReveal className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
            <div>
              <p className="font-mono text-xs text-[#8f8f8f]">WORKFLOW</p>
              <h2 className="mt-4 text-3xl font-semibold leading-tight text-white sm:text-5xl">
                A research workflow that keeps moving after upload.
              </h2>
              <p className="mt-5 text-base leading-7 text-[#a3a3a3]">
                Papertrend is built around the way research teams actually work:
                collect papers, analyze them reliably, inspect the corpus, and ask
                sharper questions from the same source of truth.
              </p>
            </div>
            <div className="grid gap-px overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#1f1f1f] sm:grid-cols-2">
              {workflowSteps.map((step) => {
                const Icon = step.icon;
                return (
                  <div key={step.title} className="bg-[#050505] p-6">
                    <Icon className="h-5 w-5 text-[#00dfd8]" />
                    <h3 className="mt-5 text-lg font-semibold text-white">{step.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-[#a3a3a3]">{step.copy}</p>
                  </div>
                );
              })}
            </div>
          </MotionReveal>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
        <MotionReveal>
          <p className="font-mono text-xs text-[#8f8f8f]">WHY PAPERTREND</p>
          <h2 className="mt-4 text-3xl font-semibold leading-tight text-white sm:text-5xl">
            Built for research operations, not another file drawer.
          </h2>
          <p className="mt-5 text-base leading-7 text-[#a3a3a3]">
            Papertrend connects the operational layer of upload queues and library
            status with the analytical layer of dashboard insight and AI chat.
          </p>
        </MotionReveal>
        <MotionReveal delay={0.12} className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-6">
          <ul className="grid gap-4 sm:grid-cols-2">
            {valuePillars.map((pillar) => (
              <SellingPoint key={pillar}>{pillar}</SellingPoint>
            ))}
          </ul>
        </MotionReveal>
      </section>

      <FinalCTA />
    </MarketingShell>
  );
}
