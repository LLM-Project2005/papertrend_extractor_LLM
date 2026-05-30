import type { ComponentType } from "react";
import {
  ArrowRightIcon,
  ChartIcon,
  ChatIcon,
  CheckCircleIcon,
  EqualizerIcon,
  PaperIcon,
  SearchIcon,
  SparkIcon,
  UploadIcon,
} from "@/components/ui/Icons";

export type FeatureSlug =
  | "paper-analysis"
  | "research-dashboard"
  | "ai-research-chat"
  | "cloud-queue";

export interface MarketingFeature {
  slug: FeatureSlug;
  navLabel: string;
  title: string;
  eyebrow: string;
  description: string;
  homeSummary: string;
  gradient: string;
  icon: ComponentType<{ className?: string }>;
  heroPoints: string[];
  proof: {
    metric: string;
    label: string;
  }[];
  sections: {
    title: string;
    copy: string;
    bullets: string[];
  }[];
}

export const marketingFeatures: MarketingFeature[] = [
  {
    slug: "paper-analysis",
    navLabel: "Analysis",
    title: "Paper analysis that turns PDFs into structured research signals.",
    eyebrow: "Analysis Engine",
    description:
      "Upload research papers and let Papertrend extract metadata, sections, keywords, topics, typologies, and confidence-backed year evidence in one guided flow.",
    homeSummary:
      "Extract sections, metadata, keywords, topics, tracks, and evidence from messy research PDFs.",
    gradient: "from-[#007cf0] via-[#00dfd8] to-[#50e3c2]",
    icon: PaperIcon,
    heroPoints: ["PDF extraction", "keyword intelligence", "year evidence"],
    proof: [
      { metric: "1", label: "upload flow" },
      { metric: "9", label: "analysis passes" },
      { metric: "20+", label: "paper signals" },
    ],
    sections: [
      {
        title: "From upload to usable evidence",
        copy:
          "Papertrend reads each paper as a research object, not just a file. The pipeline separates content, recovers metadata, and keeps evidence snippets close to every extracted signal.",
        bullets: ["Metadata and year detection", "Topic and keyword extraction", "Track and typology classification"],
      },
      {
        title: "Designed for imperfect PDFs",
        copy:
          "When normal text extraction is weak, the analysis path can fall back to vision/OCR-style processing so scanned or unusual documents still have a route forward.",
        bullets: ["Extraction quality checks", "Vision fallback support", "Retry-ready queue records"],
      },
    ],
  },
  {
    slug: "research-dashboard",
    navLabel: "Dashboard",
    title: "A research dashboard that makes trends visible across the workspace.",
    eyebrow: "Insight Dashboard",
    description:
      "Turn analyzed papers into searchable, filterable views of yearly movement, topics, keywords, research tracks, and workspace-wide coverage.",
    homeSummary:
      "Explore trends, topics, tracks, and coverage across all analyzed papers in the workspace.",
    gradient: "from-[#7928ca] via-[#ff0080] to-[#eb367f]",
    icon: ChartIcon,
    heroPoints: ["workspace-wide views", "trend charts", "filterable corpus"],
    proof: [
      { metric: "All", label: "workspace scope" },
      { metric: "4", label: "track views" },
      { metric: "Live", label: "library updates" },
    ],
    sections: [
      {
        title: "Understand the shape of a corpus",
        copy:
          "The dashboard summarizes papers at the workspace level, so teams can see what topics dominate, which years are represented, and where research coverage is thin.",
        bullets: ["Top topics and keywords", "Track distributions", "Year and coverage indicators"],
      },
      {
        title: "Move from overview to detail",
        copy:
          "Every high-level pattern can lead back to the underlying paper context, helping researchers inspect the evidence behind a trend before making claims.",
        bullets: ["Paper-level drilldown", "Evidence-backed keywords", "Reusable library filters"],
      },
    ],
  },
  {
    slug: "ai-research-chat",
    navLabel: "AI Chat",
    title: "AI research chat grounded in your papers, library, and charts.",
    eyebrow: "Research Chat",
    description:
      "Ask questions about attached papers, search the web when needed, and create charts from analyzed files or workspace data without leaving the conversation.",
    homeSummary:
      "Chat with attached papers, trigger web search, and build charts from research data in one place.",
    gradient: "from-[#ff4d4d] via-[#f9cb28] to-[#ff0080]",
    icon: ChatIcon,
    heroPoints: ["attached-paper context", "chart mode", "web citations"],
    proof: [
      { metric: "Tools", label: "search + charts" },
      { metric: "Session", label: "file context" },
      { metric: "Cites", label: "source links" },
    ],
    sections: [
      {
        title: "Ask from the paper in front of you",
        copy:
          "Papertrend keeps chat session context close to the user's selected files, so requests like summaries, critiques, charts, and comparisons can stay grounded.",
        bullets: ["Library attachments", "File status handling", "Paper-aware responses"],
      },
      {
        title: "Charts without leaving chat",
        copy:
          "Chart mode lets users ask naturally for visualizations while the app plans the chart, finds the relevant analyzed data, and renders the result inline.",
        bullets: ["LLM chart planning", "Multiple chart outputs", "Default explanations"],
      },
    ],
  },
  {
    slug: "cloud-queue",
    navLabel: "Cloud Queue",
    title: "A cloud queue for multi-paper analysis that keeps moving.",
    eyebrow: "Cloud Processing",
    description:
      "Batch uploads become background work with Cloud Tasks, retry-safe worker runs, and status feedback that keeps users out of long-running request timeouts.",
    homeSummary:
      "Analyze multiple papers in sequence with background workers, retries, and visible run status.",
    gradient: "from-[#007cf0] via-[#7928ca] to-[#ff4d4d]",
    icon: UploadIcon,
    heroPoints: ["Cloud Tasks trigger", "retry-aware worker", "queue visibility"],
    proof: [
      { metric: "Async", label: "processing" },
      { metric: "Retry", label: "failed files" },
      { metric: "Queue", label: "multi-paper flow" },
    ],
    sections: [
      {
        title: "Built for batches, not single clicks",
        copy:
          "Papertrend separates upload from analysis, then lets Cloud Tasks trigger the next queued paper without relying on the browser tab to stay alive.",
        bullets: ["Queued ingestion runs", "Cloud Task continuation", "Stale run recovery"],
      },
      {
        title: "Progress users can understand",
        copy:
          "Run status, failed files, and worker activity are surfaced in the workspace so users know whether the system is analyzing, retrying, or waiting.",
        bullets: ["Library status indicators", "Worker logs and retry actions", "Needs-attention surfaces"],
      },
    ],
  },
];

export const workflowSteps = [
  {
    title: "Collect",
    copy: "Upload PDFs, import folders, or attach library files from the workspace.",
    icon: UploadIcon,
  },
  {
    title: "Analyze",
    copy: "Extract sections, metadata, topics, keywords, evidence, and research tracks.",
    icon: SparkIcon,
  },
  {
    title: "Explore",
    copy: "Use dashboard filters, workspace-wide summaries, charts, and paper-level inspection.",
    icon: EqualizerIcon,
  },
  {
    title: "Ask",
    copy: "Chat with attached papers, request charts, and add web search when the answer needs it.",
    icon: SearchIcon,
  },
];

export const proofMetrics = [
  { value: "4", label: "core research workflows" },
  { value: "1", label: "workspace for papers, charts, and chat" },
  { value: "Async", label: "multi-paper analysis" },
];

export const footerLinks = [
  { label: "Paper analysis", href: "/features/paper-analysis" },
  { label: "Research dashboard", href: "/features/research-dashboard" },
  { label: "AI research chat", href: "/features/ai-research-chat" },
  { label: "Cloud queue", href: "/features/cloud-queue" },
  { label: "Documentation", href: "/docs" },
  { label: "Search docs", href: "/docs/search" },
];

export const valuePillars = [
  "Workspace-wide research intelligence",
  "Chat, charts, and dashboard from the same corpus",
  "Cloud-ready multi-paper analysis",
  "Static marketing pages with client-only auth CTA",
];

export const checkIcon = CheckCircleIcon;
export const arrowIcon = ArrowRightIcon;
