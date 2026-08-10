import type { Metadata } from "next";
import Link from "next/link";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import { MarketingShell } from "@/components/marketing/MarketingLayout";
import { AnimatedProductFrame, MotionReveal } from "@/components/marketing/MarketingMotion";
import {
  OrigamiCapabilityExplorer,
  OrigamiHeroArtwork,
  WordRise,
} from "@/components/marketing/OrigamiLanding";
import { ArrowRightIcon, CheckCircleIcon, LogoMarkIcon } from "@/components/ui/Icons";

export const metadata: Metadata = {
  title: "Papertrend | Research, folded into focus",
  description:
    "Papertrend turns research paper collections into structured evidence, living dashboards, and grounded research conversations.",
};

const evidencePrinciples = [
  "Every answer can return to its paper",
  "Every long process names its current stage",
  "Every repository stays inside its owner and project scope",
  "Every corpus view can move from overview to evidence",
];

export default function LandingPage() {
  return (
    <MarketingShell immersive>
      <section className="relative min-h-[88dvh] overflow-hidden bg-[#05080c] text-white">
        <OrigamiHeroArtwork />
        <div className="relative mx-auto flex min-h-[88dvh] max-w-7xl flex-col px-4 pb-8 pt-24 sm:px-6 sm:pb-10 lg:pt-28">
          <div className="grid gap-6 border-t border-white/20 pt-5 font-mono text-[11px] text-[#aeb9c7] sm:grid-cols-[0.45fr_1fr_0.45fr]">
            <p>Papertrend / Research intelligence</p>
            <p className="max-w-lg sm:justify-self-center">
              A working environment for turning scattered papers into structured,
              source-linked understanding.
            </p>
            <p className="hidden text-right sm:block">Academic beta / 2026</p>
          </div>

          <div className="mt-auto grid gap-9 lg:grid-cols-[1.3fr_0.7fr] lg:items-end">
            <div className="min-w-0">
              <h1 className="font-sans text-[2.65rem] font-semibold leading-[0.84] text-[#f5f6f1] min-[360px]:text-[3.25rem] sm:text-7xl md:text-8xl lg:text-[8.25rem]">
                <WordRise>Papertrend</WordRise>
              </h1>
              <p className="mt-4 font-mono text-xs uppercase text-[#5ce1e6]">
                Research, folded into focus.
              </p>
            </div>

            <MotionReveal className="min-w-0 border-l border-[#5ce1e6] pl-5 sm:pl-7">
              <p className="max-w-xl text-base leading-7 text-[#d4dbe4] sm:text-lg">
                Upload a paper. Watch the evidence take shape. Explore the corpus,
                ask grounded questions, and keep the source attached to every insight.
              </p>
              <div className="mt-7 grid gap-3 sm:flex sm:flex-wrap">
                <MarketingCTA className="w-full sm:w-auto" tone="onDark" />
                <Link
                  href="/docs/getting-started"
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 border border-white/35 bg-black/25 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:border-white hover:bg-white hover:text-black sm:w-auto"
                >
                  Follow the workflow
                  <ArrowRightIcon className="h-4 w-4" />
                </Link>
              </div>
            </MotionReveal>
          </div>

          <div className="mt-10 flex items-end justify-between border-t border-white/20 pt-5 font-mono text-[11px] text-[#aeb9c7]">
            <span>Scroll to unfold</span>
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#5ce1e6]" />
              Evidence system online
            </span>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden border-b border-papertrend-line bg-papertrend-canvas px-4 py-20 sm:px-6 lg:py-32">
        <LogoMarkIcon className="pointer-events-none absolute -right-16 top-8 h-72 w-72 rotate-12 text-papertrend-line opacity-60 sm:h-96 sm:w-96" />
        <div className="relative mx-auto max-w-7xl">
          <div className="grid gap-10 lg:grid-cols-[0.38fr_1fr]">
            <MotionReveal>
              <p className="font-mono text-xs text-papertrend-action">[ 01 ] The premise</p>
            </MotionReveal>
            <MotionReveal delay={0.06}>
              <h2 className="max-w-5xl text-4xl font-medium leading-[1.04] text-papertrend-ink sm:text-5xl lg:text-7xl">
                Papers should not disappear into folders. They should become a
                research system you can question, inspect, and trust.
              </h2>
              <div className="mt-12 grid gap-8 border-t border-papertrend-line pt-8 md:grid-cols-2">
                <p className="max-w-xl text-base leading-8 text-papertrend-muted">
                  Papertrend reads each document as evidence: sections, metadata,
                  methods, topics, findings, and citations stay connected instead of
                  becoming isolated summaries.
                </p>
                <p className="max-w-xl text-base leading-8 text-papertrend-muted">
                  The same structured record powers the library, dashboard, charts,
                  repository chat, and long-form research workflows.
                </p>
              </div>
            </MotionReveal>
          </div>
        </div>
      </section>

      <section className="bg-papertrend-surface px-4 py-20 sm:px-6 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="mb-12 grid gap-6 lg:grid-cols-[0.42fr_1fr] lg:items-end">
            <p className="font-mono text-xs text-papertrend-action">[ 02 ] Explore the system</p>
            <div>
              <h2 className="max-w-4xl text-4xl font-medium leading-tight text-papertrend-ink sm:text-5xl lg:text-6xl">
                Four folds. One evidence trail.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-7 text-papertrend-muted">
                Select a capability to see how it changes the same repository without
                detaching insight from source material.
              </p>
            </div>
          </div>
          <OrigamiCapabilityExplorer />
        </div>
      </section>

      <section className="border-y border-[#253140] bg-[#080b10] px-4 py-20 text-white sm:px-6 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-10 lg:grid-cols-[0.42fr_1fr] lg:items-end">
            <p className="font-mono text-xs text-[#5ce1e6]">[ 03 ] Inside the instrument</p>
            <div>
              <h2 className="max-w-4xl text-4xl font-medium leading-tight sm:text-5xl lg:text-6xl">
                See the corpus move from queue to question.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-7 text-[#aeb9c7]">
                A live research state, not a decorative dashboard mockup.
              </p>
            </div>
          </div>
          <AnimatedProductFrame />
        </div>
      </section>

      <section className="bg-papertrend-canvas px-4 py-20 sm:px-6 lg:py-28">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.78fr_1.22fr]">
          <MotionReveal>
            <p className="font-mono text-xs text-papertrend-action">[ 04 ] Research with provenance</p>
            <h2 className="mt-5 max-w-xl text-4xl font-medium leading-tight text-papertrend-ink sm:text-5xl">
              The answer is only useful when the evidence survives it.
            </h2>
            <div className="mt-8">
              <MarketingCTA />
            </div>
          </MotionReveal>

          <div className="border-t border-papertrend-line">
            {evidencePrinciples.map((item, index) => (
              <MotionReveal
                key={item}
                delay={index * 0.05}
                className="grid min-h-20 grid-cols-[40px_minmax(0,1fr)] items-center gap-4 border-b border-papertrend-line py-5"
              >
                <CheckCircleIcon className="h-5 w-5 text-papertrend-cyan" />
                <p className="text-lg font-medium text-papertrend-ink sm:text-xl">{item}</p>
              </MotionReveal>
            ))}
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
