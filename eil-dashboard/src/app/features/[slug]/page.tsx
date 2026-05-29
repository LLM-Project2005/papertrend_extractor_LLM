import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FinalCTA, SellingPoint } from "@/components/marketing/FeatureBand";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import { MarketingShell } from "@/components/marketing/MarketingLayout";
import { AnimatedFeaturePanel, MotionReveal } from "@/components/marketing/MarketingMotion";
import { marketingFeatures, type FeatureSlug } from "@/components/marketing/marketing-content";
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

export default function FeaturePage({ params }: FeaturePageProps) {
  const feature = findFeature(params.slug);

  if (!feature) {
    notFound();
  }

  const Icon = feature.icon;

  return (
    <MarketingShell activeSlug={feature.slug as FeatureSlug}>
      <section className="relative overflow-hidden px-4 pb-16 pt-32 sm:px-6 lg:pb-24">
        <div className="marketing-grid pointer-events-none absolute inset-0 opacity-35" />
        <div className="relative mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
          <MotionReveal>
            <span className={`inline-flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br ${feature.gradient} text-white`}>
              <Icon className="h-6 w-6" />
            </span>
            <p className="mt-7 font-mono text-xs text-[#8f8f8f]">{feature.eyebrow}</p>
            <h1 className="mt-5 text-4xl font-semibold leading-tight text-white sm:text-6xl">
              {feature.title}
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-[#a3a3a3] sm:text-lg">
              {feature.description}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <MarketingCTA />
              <Link
                href="/"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#2a2a2a] bg-[#050505] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:border-[#4d4d4d] hover:bg-[#0a0a0a]"
              >
                Back to overview
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>
          </MotionReveal>

          <AnimatedFeaturePanel label={feature.eyebrow} />
        </div>
      </section>

      <section className="border-y border-[#1f1f1f] bg-[#030303]">
        <div className="mx-auto grid max-w-7xl gap-px bg-[#1f1f1f] sm:grid-cols-3">
          {feature.proof.map((item) => (
            <div key={item.label} className="bg-[#030303] px-6 py-8 text-center">
              <p className="text-3xl font-semibold text-white">{item.metric}</p>
              <p className="mt-2 text-sm text-[#8f8f8f]">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-2">
          {feature.sections.map((section, index) => (
            <MotionReveal
              key={section.title}
              delay={index * 0.1}
              className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-6"
            >
              <p className="font-mono text-xs text-[#8f8f8f]">0{index + 1}</p>
              <h2 className="mt-5 text-2xl font-semibold leading-tight text-white">
                {section.title}
              </h2>
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

      <section className="border-y border-[#1f1f1f] bg-[#030303] px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <MotionReveal className="max-w-3xl">
            <p className="font-mono text-xs text-[#8f8f8f]">WHAT IT ENABLES</p>
            <h2 className="mt-4 text-3xl font-semibold leading-tight text-white sm:text-5xl">
              A clearer research workflow from the same source of truth.
            </h2>
          </MotionReveal>
          <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#1f1f1f] md:grid-cols-3">
            {feature.heroPoints.map((point) => (
              <div key={point} className="bg-[#050505] p-6">
                <p className="font-mono text-xs text-[#8f8f8f]">SIGNAL</p>
                <h3 className="mt-4 text-lg font-semibold text-white">{point}</h3>
              </div>
            ))}
          </div>
        </div>
      </section>

      <FinalCTA />
    </MarketingShell>
  );
}
