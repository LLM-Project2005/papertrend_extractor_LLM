import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FinalCTA, SellingPoint } from "@/components/marketing/FeatureBand";
import {
  AIResearchChatShowcase,
  AnalysisFullPipelineShowcase,
  CloudQueueShowcase,
  DeepResearchGraphShowcase,
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

function TechNoteGrid({
  eyebrow,
  title,
  copy,
  items,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  items: string[];
}) {
  return (
    <MotionReveal className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-6">
      <p className="font-mono text-xs text-[#8f8f8f]">{eyebrow}</p>
      <h2 className="mt-4 text-2xl font-semibold leading-tight text-white">{title}</h2>
      <p className="mt-4 text-sm leading-7 text-[#a3a3a3]">{copy}</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item} className="rounded-md border border-[#1f1f1f] bg-[#030303] px-3 py-2 text-sm leading-6 text-[#d0d0d0]">
            {item}
          </div>
        ))}
      </div>
    </MotionReveal>
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
              file intake, section recovery, metadata, year evidence, topics,
              tracks, facets, and workspace tables becoming structured output.
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
            <p className="font-mono text-xs text-[#8f8f8f]">MARKETING VERSION</p>
            <h2 className="mt-4 text-2xl font-semibold leading-tight text-white">
              The simple story: clean the paper, find the signals, save the evidence.
            </h2>
            <p className="mt-4 text-sm leading-7 text-[#a3a3a3]">
              The real worker does more than one AI call. For users, the journey
              can be understood in four plain stages: take in the PDF, recover
              usable sections, extract research signals, then persist evidence
              so the dashboard and chat can reuse it.
            </p>
            <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#1f1f1f] md:grid-cols-4">
              {["Ingest", "Recover", "Analyze", "Persist"].map((step, index) => (
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

      <section className="border-y border-[#1f1f1f] bg-[#030303] px-4 py-16 sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <AnalysisFullPipelineShowcase />
          <TechNoteGrid
            eyebrow="FULL PIPELINE"
            title="A full run becomes reusable research data."
            copy="The worker keeps every output close to a paper, owner, folder, and evidence trail. That makes the same analysis available to the library, dashboard, charts, and chat without re-reading the PDF every time."
            items={[
              "Text extraction first, vision/OCR fallback when text is unusable.",
              "Structured model calls for segmentation, metadata, keywords, topics, tracks, typology, and facets.",
              "Supabase persistence writes paper rows, content, keyword rows, concepts, tracks, and analysis facets.",
              "Retry-safe queue records let failed or incomplete files be resumed instead of silently disappearing.",
            ]}
          />
        </div>
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
              trends, topic movement, track distribution, paper coverage, and
              library status in one scan.
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
          <p className="mt-4 text-sm leading-7 text-[#a3a3a3]">
            This part is intentionally deterministic: most charts are built from
            stored tables and views, not fresh model guesses. That keeps dashboard
            numbers stable when users switch folders, years, tracks, or workspace scope.
          </p>
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

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <TechNoteGrid
          eyebrow="DASHBOARD LOGIC"
          title="Fast views come from normalized research tables."
          copy="The dashboard reads analyzed paper rows, keyword rows, concept rows, and track rows, then aggregates them into views the user can filter instantly. AI helps create the source signals; the dashboard keeps the math predictable."
          items={[
            "Workspace-wide scope is the default for Home and high-level metrics.",
            "Topic and keyword charts are aggregated from persisted analysis rows.",
            "Year and track filters reuse the same data shape as library and chart mode.",
            "The dashboard acts as the stable source for chat-generated visualizations.",
          ]}
        />
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
              attached-file context, chart mode, web citations, and deeper
              research steps when the question calls for it.
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

      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
        <TechNoteGrid
          eyebrow="CHAT LOGIC"
          title="The assistant routes simple chat, chart requests, web search, and deep research differently."
          copy="A normal answer can use recent messages and attached papers. Chart mode adds a planning step that decides which analyzed data to visualize. Web search stays opt-in so citations and cost stay visible."
          items={[
            "Attached library files define the first context window for paper-specific questions.",
            "Chart requests use an LLM planner first, then deterministic chart data builders.",
            "Web search is treated as a tool result with citation links, not hidden background browsing.",
            "Failed or unanalyzed attachments can be sent back into the analysis queue before charting.",
          ]}
        />
        <DeepResearchGraphShowcase />
      </section>

      <section className="border-y border-[#1f1f1f] bg-[#030303] px-4 py-16 sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[0.82fr_1.18fr]">
          <MotionReveal className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-6">
            <p className="font-mono text-xs text-[#8f8f8f]">DEEP RESEARCH</p>
            <h2 className="mt-4 text-2xl font-semibold leading-tight text-white">
              For bigger questions, chat becomes a graph-style research run.
            </h2>
            <p className="mt-4 text-sm leading-7 text-[#a3a3a3]">
              Deep research works like a LangGraph-style state graph: resolve the
              user's intent, create a plan, execute scoped tools, verify evidence
              coverage, then synthesize the final answer. The important bit for
              users is simple: it does not jump straight to a polished paragraph;
              it checks what it knows first.
            </p>
          </MotionReveal>
          <MotionReveal delay={0.1} className="rounded-lg border border-[#1f1f1f] bg-[#050505] p-6">
            <p className="font-mono text-xs text-[#8f8f8f]">WHY IT MATTERS</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                "Plans are stored so the user can see what the research run is doing.",
                "Tool steps can fetch papers, read sections, search keywords, or inspect dashboard summaries.",
                "Verification catches weak evidence before synthesis.",
                "The final report is grounded in retrieved paper snippets and visible citations.",
              ].map((item) => (
                <SellingPoint key={item}>{item}</SellingPoint>
              ))}
            </div>
          </MotionReveal>
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
                upload record, Cloud Task, worker claim, heartbeat, persistence,
                and continuation.
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
            <p className="mt-4 text-sm leading-7 text-[#a3a3a3]">
              Technically, the web app creates ingestion runs, then Google Cloud
              Tasks calls the worker endpoint. The worker claims one run at a time,
              updates heartbeats, saves results, and triggers the next task when
              more papers are waiting.
            </p>
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

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <TechNoteGrid
          eyebrow="QUEUE LOGIC"
          title="Background analysis is designed to be boring in the best way."
          copy="Long-running paper analysis should not depend on an open browser tab. The queue keeps the work durable and visible while still protecting the worker from too many concurrent runs."
          items={[
            "Cloud Tasks triggers the worker endpoint when queued work exists.",
            "The worker claims one run, processes it, persists results, then releases the lock.",
            "Heartbeats make stuck processing runs visible and recoverable.",
            "Retry records let failed papers be requeued from the library instead of reuploaded.",
          ]}
        />
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
