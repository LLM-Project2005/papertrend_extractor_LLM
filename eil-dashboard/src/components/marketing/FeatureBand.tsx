import Link from "next/link";
import type { ReactNode } from "react";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import { MotionReveal } from "@/components/marketing/MarketingMotion";
import type { MarketingFeature } from "@/components/marketing/marketing-content";
import { ArrowRightIcon, CheckCircleIcon } from "@/components/ui/Icons";

export function FeatureBand({ feature, delay = 0 }: { feature: MarketingFeature; delay?: number }) {
  const Icon = feature.icon;

  return (
    <MotionReveal
      delay={delay}
      className="group rounded-lg border border-[#1f1f1f] bg-[#050505] p-5 transition-colors hover:border-[#3a3a3a]"
    >
      <div className="flex h-full flex-col">
        <span className={`flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br ${feature.gradient} text-white`}>
          <Icon className="h-5 w-5" />
        </span>
        <p className="mt-6 font-mono text-xs text-[#8f8f8f]">{feature.eyebrow}</p>
        <h3 className="mt-3 text-xl font-semibold leading-7 text-white">{feature.navLabel}</h3>
        <p className="mt-3 flex-1 text-sm leading-6 text-[#a3a3a3]">{feature.homeSummary}</p>
        <Link
          href={`/features/${feature.slug}`}
          className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-white"
        >
          Explore feature
          <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
    </MotionReveal>
  );
}

export function FinalCTA() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
      <div className="relative overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#050505] px-6 py-14 text-center">
        <div className="marketing-grid pointer-events-none absolute inset-0 opacity-35" />
        <div className="relative z-10 mx-auto max-w-3xl">
          <p className="font-mono text-xs text-[#8f8f8f]">READY WHEN YOUR LIBRARY IS</p>
          <h2 className="mt-5 text-4xl font-semibold leading-tight text-white">
            Start with papers. Leave with a research system.
          </h2>
          <p className="mt-5 text-base leading-7 text-[#a3a3a3]">
            Bring your corpus into Papertrend and move from isolated files to
            dashboards, charts, grounded chat, and repeatable analysis workflows.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <MarketingCTA loggedInLabel="Open workspace" />
            <Link
              href="/features/paper-analysis"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#2a2a2a] bg-[#050505] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:border-[#4d4d4d] hover:bg-[#0a0a0a]"
            >
              View features
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export function SellingPoint({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3 text-sm leading-6 text-[#d0d0d0]">
      <CheckCircleIcon className="mt-0.5 h-4 w-4 flex-none text-[#00dfd8]" />
      <span>{children}</span>
    </li>
  );
}
