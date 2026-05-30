import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FinalCTA, SellingPoint } from "@/components/marketing/FeatureBand";
import {
  AIResearchChatShowcase,
  CloudQueueShowcase,
  PaperAnalysisShowcase,
  ResearchDashboardShowcase,
} from "@/components/marketing/FeatureShowcases";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import { MarketingShell } from "@/components/marketing/MarketingLayout";
import { MotionReveal } from "@/components/marketing/MarketingMotion";
import { marketingFeatures, type MarketingFeature } from "@/components/marketing/marketing-content";
import { ArrowRightIcon } from "@/components/ui/Icons";

interface FeaturePageProps {
  params: {
    slug: string;
  };
}

export const dynamic = "force-static";
export const dynamicParams = false;

function findFeature(slug: string) {
  return marketingFeatures.find((feature) => feature.slug === slug);
}

export function generateStaticParams() {
  return marketingFeatures.map((feature) => ({
    slug: feature.slug,
  }));
}

export function generateMetadata({ params }: FeaturePageProps): Metadata {
  const feature = findFeature(params.slug);

  if (!feature) {
    return {
      title: "Papertrend feature",
    };
  }

  return {
    title: `${feature.navLabel} | Papertrend`,
    description: feature.description,
  };
}

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#2a2a2a] bg-[#050505] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:border-[#4d4d4d] hover:bg-[#0a0a0a]"
    >
      Back to overview
      <ArrowRightIcon className="h-4 w-4" />
    </Link>
  );
}

function ProofStrip({ feature, className = "" }: { feature: MarketingFeature; className?: string }) {
  return (
    <div className={`grid gap-px overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#1f1f1f] sm:grid-cols-3 ${className}`}>
      {feature.proof.map((item) => (
        <div key={item.label} className="bg-[#030303] px-6 py-7">
          <p className="text-3xl font-semibold text-white">{item.metric}</p>
          <p className="mt-2 text-sm text-[#8f8f8f]">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

function PaperAnalysisPage({ feature }: { feature: MarketingFeature }) {
  const Icon = feature.icon;

  return (
    <MarketingShell activeSlug={feature.slug}>
      <section className="relative overflow-hidden px-4 pb-16 pt-32 sm:px-6 lg:pb-24">
        <div className="marketing-grid pointer-events-none absolute inset-0 opacity-35" />
        <div className="relative mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
          <MotionReveal>
            <span className={`inline-flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br ${feature.gradient} text-white`}>
              <Icon className="h-6 w-6" />
            </span>
            <p className="mt-7 font-mono text-xs text-[#8f8f8f]">{feature.eyebrow}</p>
            <h1 className="mt-5 text-4xl font-semibold leading-tight text-white sm:text-6xl">
              Extract the paper before you argue with it.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-[#a3a3a3] sm:text-lg">
              {feature.description} This page shows the analysis engine as a lab bench:
              file intake, section recovery, metadata, topics, and evidence all becoming structured output.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <MarketingCTA />
              <BackLink />
            </div>
          </MotionReveal>
          <PaperAnalysisShowcase />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <MotionReveal className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-6">
            <p className="font-mono text-xs text-[#8f8f8f]">PIPELINE</p>
            <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#1f1f1f] md:grid-cols-4">
              {["PDF", "Sections", "Signals", "Evidence"].map((step, index) => (
                <div key={step} className="bg-[#030303] p-5">
                  <p className="font-mono text-xs text-[#8f8f8f]">0{index + 1}</p>
                  <h3 className="mt-4 text-lg font-semibold text-white">{step}</h3>
                </div>
              ))}
            </div>
          </MotionReveal>
          <MotionReveal delay={0.1} className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-6">
            <h2 className="text-2xl font-semibold leading-tight text-white">{feature.sections[0].title}</h2>
            <p className="mt-4 text-sm leading-7 text-[#a3a3a3]">{feature.sections[0].copy}</p>
            <ul className="mt-6 space-y-3">
              {feature.sections[0].bullets.map((bullet) => (
                <SellingPoint key={bullet}>{bullet}</SellingPoint>
              ))}
            </ul>
          </MotionReveal>
        </div>
        <ProofStrip feature={feature} className="mt-4" />
      </section>

      <FinalCTA />
    </MarketingShell>
  );
}

function ResearchDashboardPage({ feature }: { feature: MarketingFeature }) {
  const Icon = feature.icon;

  return (
    <MarketingShell activeSlug={feature.slug}>
      <section className="relative overflow-hidden px-4 pb-12 pt-32 sm:px-6">
        <div className="marketing-grid pointer-events-none absolute inset-0 opacity-25" />
        <div className="relative mx-auto max-w-7xl">
          <MotionReveal className="mx-auto max-w-4xl text-center">
            <span className={`mx-auto inline-flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br ${feature.gradient} text-white`}>
              <Icon className="h-6 w-6" />
            </span>
            <p className="mt-7 font-mono text-xs text-[#8f8f8f]">{feature.eyebrow}</p>
            <h1 className="mt-5 text-4xl font-semibold leading-tight text-white sm:text-6xl">
              See the whole workspace before opening a single file.
            </h1>
            <p className="mx-auto mt-6 max-w-3xl text-base leading-8 text-[#a3a3a3] sm:text-lg">
              {feature.description} The dashboard page is a command wall: filters,
              trends, topic movement, and library coverage in one scan.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <MarketingCTA />
              <BackLink />
            </div>
          </MotionReveal>
          <div className="mt-12">
            <ResearchDashboardShowcase />
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 py-16 sm:px-6 lg:grid-cols-[0.78fr_1.22fr]">
        <MotionReveal className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-6">
          <h2 className="text-2xl font-semibold leading-tight text-white">{feature.sections[0].title}</h2>
          <p className="mt-4 text-sm leading-7 text-[#a3a3a3]">{feature.sections[0].copy}</p>
          <ul className="mt-6 space-y-3">
            {feature.sections[0].bullets.map((bullet) => (
              <SellingPoint key={bullet}>{bullet}</SellingPoint>
            ))}
          </ul>
        </MotionReveal>
        <ProofStrip feature={feature} />
      </section>

      <section className="border-y border-[#1f1f1f] bg-[#030303] px-4 py-16 sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-3">
          {feature.heroPoints.map((point, index) => (
            <MotionReveal key={point} delay={index * 0.08} className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-6">
              <p className="font-mono text-xs text-[#8f8f8f]">DASHBOARD SIGNAL</p>
              <h3 className="mt-4 text-xl font-semibold text-white">{point}</h3>
            </MotionReveal>
          ))}
        </div>
      </section>

      <FinalCTA />
    </MarketingShell>
  );
}

function AIResearchChatPage({ feature }: { feature: MarketingFeature }) {
  const Icon = feature.icon;

  return (
    <MarketingShell activeSlug={feature.slug}>
      <section className="relative overflow-hidden px-4 pb-16 pt-32 sm:px-6 lg:pb-24">
        <div className="marketing-grid pointer-events-none absolute inset-0 opacity-30" />
        <div className="relative mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.12fr_0.88fr] lg:items-center">
          <AIResearchChatShowcase />
          <MotionReveal>
            <span className={`inline-flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br ${feature.gradient} text-white`}>
              <Icon className="h-6 w-6" />
            </span>
            <p className="mt-7 font-mono text-xs text-[#8f8f8f]">{feature.eyebrow}</p>
            <h1 className="mt-5 text-4xl font-semibold leading-tight text-white sm:text-6xl">
              A research chat that can act on the paper in the room.
            </h1>
            <p className="mt-6 text-base leading-8 text-[#a3a3a3] sm:text-lg">
              {feature.description} It should feel like a serious assistant:
              attached-file context, chart mode, web citations, and deeper research steps when the question calls for it.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <MarketingCTA />
              <BackLink />
            </div>
          </MotionReveal>
        </div>
      </section>

      <section className="border-y border-[#1f1f1f] bg-[#030303] px-4 py-16 sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-3">
          {feature.sections.map((section, index) => (
            <MotionReveal
              key={section.title}
              delay={index * 0.08}
              className={index === 0 ? "rounded-lg border border-[#1f1f1f] bg-[#050505] p-6 lg:col-span-2" : "rounded-lg border border-[#1f1f1f] bg-[#050505] p-6"}
            >
              <h2 className="text-2xl font-semibold leading-tight text-white">{section.title}</h2>
              <p className="mt-4 text-sm leading-7 text-[#a3a3a3]">{section.copy}</p>
              <ul className="mt-6 space-y-3">
                {section.bullets.map((bullet) => (
                  <SellingPoint key={bullet}>{bullet}</SellingPoint>
                ))}
              </ul>
            </MotionReveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <ProofStrip feature={feature} />
      </section>

      <FinalCTA />
    </MarketingShell>
  );
}

function CloudQueuePage({ feature }: { feature: MarketingFeature }) {
  const Icon = feature.icon;

  return (
    <MarketingShell activeSlug={feature.slug}>
      <section className="relative overflow-hidden px-4 pb-16 pt-32 sm:px-6">
        <div className="marketing-grid pointer-events-none absolute inset-0 opacity-30" />
        <div className="relative mx-auto max-w-7xl">
          <div className="grid gap-10 lg:grid-cols-[0.7fr_1.3fr] lg:items-end">
            <MotionReveal>
              <span className={`inline-flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br ${feature.gradient} text-white`}>
                <Icon className="h-6 w-6" />
              </span>
              <p className="mt-7 font-mono text-xs text-[#8f8f8f]">{feature.eyebrow}</p>
              <h1 className="mt-5 text-4xl font-semibold leading-tight text-white sm:text-6xl">
                The queue keeps working after the browser stops watching.
              </h1>
              <p className="mt-6 text-base leading-8 text-[#a3a3a3] sm:text-lg">
                {feature.description} The animation here focuses on the real handoff:
                upload record, Cloud Task, worker claim, persistence, and continuation.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <MarketingCTA />
                <BackLink />
              </div>
            </MotionReveal>
            <CloudQueueShowcase />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <ProofStrip feature={feature} />
          <MotionReveal className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-6">
            <h2 className="text-2xl font-semibold leading-tight text-white">{feature.sections[1].title}</h2>
            <p className="mt-4 text-sm leading-7 text-[#a3a3a3]">{feature.sections[1].copy}</p>
            <ul className="mt-6 space-y-3">
              {feature.sections[1].bullets.map((bullet) => (
                <SellingPoint key={bullet}>{bullet}</SellingPoint>
              ))}
            </ul>
          </MotionReveal>
        </div>
      </section>

      <section className="border-y border-[#1f1f1f] bg-[#030303] px-4 py-16 sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-3">
          {feature.heroPoints.map((point, index) => (
            <MotionReveal key={point} delay={index * 0.08} className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-6">
              <p className="font-mono text-xs text-[#8f8f8f]">QUEUE CAPABILITY</p>
              <h3 className="mt-4 text-xl font-semibold text-white">{point}</h3>
            </MotionReveal>
          ))}
        </div>
      </section>

      <FinalCTA />
    </MarketingShell>
  );
}

export default function FeaturePage({ params }: FeaturePageProps) {
  const feature = findFeature(params.slug);

  if (!feature) {
    notFound();
  }

  switch (feature.slug) {
    case "paper-analysis":
      return <PaperAnalysisPage feature={feature} />;
    case "research-dashboard":
      return <ResearchDashboardPage feature={feature} />;
    case "ai-research-chat":
      return <AIResearchChatPage feature={feature} />;
    case "cloud-queue":
      return <CloudQueuePage feature={feature} />;
    default:
      notFound();
  }
}
