import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import { MarketingShell } from "@/components/marketing/MarketingLayout";
import ProductShot from "@/components/marketing/ProductShot";
import { marketingFeatures, type MarketingFeature } from "@/components/marketing/marketing-content";
import {
  arrowLinkClass,
  displayClass,
  leadClass,
  secondaryPillClass,
  sectionTitleClass,
} from "@/components/marketing/styles";
import { ArrowRightIcon, CheckIcon } from "@/components/ui/Icons";

interface FeaturePageProps {
  params: {
    slug: string;
  };
}

export const dynamic = "force-static";
export const dynamicParams = false;

/** The documentation page that explains each feature in full. */
const FEATURE_DOCS: Record<MarketingFeature["slug"], { href: string; label: string }> = {
  "paper-analysis": { href: "/docs/analysis-pipeline", label: "How a paper is analyzed" },
  "research-dashboard": { href: "/docs/dashboard", label: "Using the dashboard" },
  "ai-research-chat": { href: "/docs/chat", label: "Using research chat" },
  "cloud-queue": { href: "/docs/uploading-papers", label: "Uploading papers" },
};

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
      title: "Features",
    };
  }

  return {
    title: feature.navLabel,
    description: feature.description,
    alternates: {
      canonical: `/features/${feature.slug}`,
    },
  };
}

/** A value to read as a measurement ("12", "10 MB") rather than a word. */
function isQuantity(value: string): boolean {
  return /^[\d][\d.,]*\+?(?:\s?[A-Z]{1,3})?$/.test(value.trim());
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-7 space-y-3.5">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-[15px] leading-6 text-body">
          <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-subtle text-ink">
            <CheckIcon weight="bold" className="h-3 w-3" />
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function FeaturePage({ params }: FeaturePageProps) {
  const feature = findFeature(params.slug);
  if (!feature) {
    notFound();
  }
  const docs = FEATURE_DOCS[feature.slug];
  const others = marketingFeatures.filter((item) => item.slug !== feature.slug);

  return (
    <MarketingShell activeSlug={feature.slug}>
      <section className="relative isolate px-4 pt-32 sm:px-6 sm:pt-40">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] bg-[radial-gradient(55%_45%_at_50%_0%,rgb(var(--ink)/0.06),transparent_72%)]"
        />
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-mute">
              <Link href="/" className="transition-colors hover:text-ink">
                Overview
              </Link>
              <span aria-hidden="true">/</span>
              <span className="text-body" aria-current="page">{feature.navLabel}</span>
            </nav>
            <h1 className={`mt-4 ${displayClass} text-4xl leading-[1.05] sm:text-6xl`}>{feature.title}</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-body">{feature.description}</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <MarketingCTA size="lg" />
              <Link href={docs.href} className={secondaryPillClass}>
                {docs.label}
              </Link>
            </div>
          </div>
          <div className="hero-rise mt-14 sm:mt-16">
            <ProductShot name={feature.shot} alt={feature.shotAlt} priority sizes="(min-width: 1152px) 1152px, 100vw" />
          </div>

          <dl className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-3">
            {/*
              Only some of these are quantities. "12" wants the larger size; a
              word such as "Cites" set as large reads as a statistic that is not
              there, so the type is fitted to the value.
            */}
            {feature.proof.map((item) => (
              <div key={item.label} className="bg-surface px-6 py-6">
                <dt className="sr-only">{item.label}</dt>
                <dd
                  className={
                    isQuantity(item.metric)
                      ? "text-3xl font-semibold tracking-tight text-ink tabular-nums"
                      : "text-lg font-semibold text-ink"
                  }
                >
                  {item.metric}
                </dd>
                <dd aria-hidden="true" className="mt-1.5 text-sm text-body">
                  {item.label}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {feature.sections.map((section, index) => {
        const flip = index % 2 === 1;
        return (
          <section key={section.title} className="px-4 py-20 sm:px-6 sm:py-28">
            {section.shot ? (
              <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-12 lg:gap-16">
                <div className={`reveal lg:col-span-5 ${flip ? "lg:order-2" : ""}`}>
                  <h2 className={sectionTitleClass}>{section.title}</h2>
                  <p className={`mt-5 ${leadClass}`}>{section.copy}</p>
                  <Bullets items={section.bullets} />
                </div>
                <div className={`reveal lg:col-span-7 ${flip ? "lg:order-1" : ""}`}>
                  <ProductShot
                    name={section.shot}
                    alt={section.shotAlt ?? section.title}
                    sizes="(min-width: 1024px) 680px, 100vw"
                  />
                </div>
              </div>
            ) : (
              <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-12 lg:gap-16">
                <h2 className={`reveal lg:col-span-5 ${sectionTitleClass}`}>{section.title}</h2>
                <div className="reveal lg:col-span-7">
                  <p className={leadClass}>{section.copy}</p>
                  <Bullets items={section.bullets} />
                </div>
              </div>
            )}
          </section>
        );
      })}

      <section className="border-t border-hairline px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-lg font-medium text-ink">More of Papertrend</h2>
          <ul className="mt-6 grid gap-x-10 gap-y-2 md:grid-cols-3">
            {others.map((item) => (
              <li key={item.slug}>
                <Link
                  href={`/features/${item.slug}`}
                  className="group block border-t border-hairline py-5 transition-colors"
                >
                  <span className="flex items-center justify-between gap-3 text-[15px] font-medium text-ink">
                    {item.navLabel}
                    <ArrowRightIcon className="h-4 w-4 text-mute transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink" />
                  </span>
                  <span className="mt-1.5 block text-sm leading-6 text-body">{item.homeSummary}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-12 flex flex-wrap items-center gap-6">
            <MarketingCTA size="lg" />
            <Link href="/" className={arrowLinkClass}>
              Back to the overview
              <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
