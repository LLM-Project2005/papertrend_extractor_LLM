/*
 * The words on the public pages that more than one page uses, kept apart from
 * the layout so they can be checked against the product in one place.
 *
 * Every figure here can be traced to the code:
 *  - 13 analysis steps, 4 in parallel: the ingestion graph in graphs.py.
 *  - 4 dashboard views: DashboardClient's TAB_DEFINITIONS.
 *  - 10 progress steps: AnalysisStatusCard's step list.
 *  - 50 PDFs per upload, 10 MB each: AnalyzeFlowModal; 50 papers per account:
 *    upload-safety.ts.
 *  - 2 to 12 custom categories: project-analysis-profile.ts.
 *  - Daily limits: server-env.ts and the production build config.
 *  - Models: docs/34 and server-env.ts.
 * A claim that cannot be checked like this does not belong on these pages.
 * Each feature page's own words live with its layout (components/marketing/pages).
 */

export type FeatureSlug =
  | "paper-analysis"
  | "research-dashboard"
  | "ai-research-chat";

export interface MarketingFeature {
  slug: FeatureSlug;
  navLabel: string;
  /** The page's headline. */
  title: string;
  /** One sentence under the headline, and the meta description. */
  description: string;
  /** The line used where the feature is listed on the home page. */
  homeSummary: string;
  /** What a reader will find on the feature page, for the links that lead there. */
  inside: string;
  shot: string;
  shotAlt: string;
}

export const marketingFeatures: MarketingFeature[] = [
  {
    slug: "paper-analysis",
    navLabel: "Analysis",
    title: "Every paper, read the same careful way.",
    description:
      "Upload a PDF and Papertrend finds its title, year, methods, topics and research area, and keeps the sentence each one came from.",
    homeSummary: "Title, year, methods, topics and research area for every paper, each with the passage it came from.",
    inside: "The 13-step pipeline, four steps at a time, and a puzzle: date a Thai thesis by its cover.",
    shot: "paper",
    shotAlt:
      "The paper viewer for a 2022 sample paper on mangroves and seawalls in Semarang: its research area and the reason for it, the line its year was read from, its own keywords, methods and topics.",
  },
  {
    slug: "research-dashboard",
    navLabel: "Dashboard",
    title: "See how a field has moved.",
    description:
      "Four views over the papers you analysed: a map of related papers, how themes and research areas moved, the keywords behind them, and patterns worth a second look.",
    homeSummary: "Themes by year, research areas over time and the keywords behind them, for one repository at a time.",
    inside: "How three passes agree on a theme, four views and the question each answers, and every number’s papers one click away.",
    shot: "dashboard-trends",
    shotAlt:
      "The Area Analysis view of a 41-paper sample repository: a sentence on which themes are gaining ground, above themes by year from 2011 to 2025.",
  },
  {
    slug: "ai-research-chat",
    navLabel: "Chat",
    title: "Ask your papers. Check every answer.",
    description:
      "Chat answers from the papers in your repository, in English or Thai, with a numbered source on every claim. Deep research writes a checked report; Chart mode counts.",
    homeSummary: "Answers drawn from your papers, with a numbered source for every claim.",
    inside: "What happens after you press Enter, the models behind each step, and a chance to be the auditor.",
    shot: "chat",
    shotAlt:
      "Chat answering “Do mangroves or seawalls reduce flood damage more?” from a 41-paper sample repository, with four numbered sources, Copy and Download (.md), and GPT-6 Luna named under the composer.",
  },
];

export const faqs: Array<{ question: string; answer: string }> = [
  {
    question: "How do I get an account?",
    answer:
      "Papertrend is invite-only during its beta: a new account needs an invite code. Ask for one on the Request access page, and if there is room you will get a code by email for that address.",
  },
  {
    question: "What kind of papers does it work with?",
    answer:
      "Research papers, theses and articles as PDF files, in English or Thai. It was built with applied linguistics and English-language education research, and its General profile works for other fields too.",
  },
  {
    question: "How long does a paper take?",
    answer:
      "Usually one to three minutes, a little longer for a scanned paper. Papers in one upload are analysed one after another in the cloud, so you can close the page once the files are up; the progress tray shows the step each paper is on.",
  },
  {
    question: "How do I know an answer is right?",
    answer:
      "Every claim in a chat answer carries a numbered source that opens the paper at that sentence, and every year and research area in an analysis shows the line or reason behind it. A draft whose support is in doubt is checked against its sources before you see it, and when the papers do not answer a question, Chat says so.",
  },
  {
    question: "Which AI models does it use?",
    answer:
      "GPT-6 Luna (OpenAI) plans, writes and checks chat answers and deep research reports. Gemini 3.8 Flash (Google) checks every sentence of a deep research report. Gemini Flash-Lite reads each paper and builds charts, and OpenAI’s text-embedding-3-small finds passages by meaning. Each was measured on a real repository before it was switched on.",
  },
  {
    question: "Can I use my own research areas?",
    answer:
      "Yes. Each repository has an analysis profile: General research, the official EIL tracks, or a custom taxonomy of 2 to 12 research areas you define. Change it later and reclassify the papers already analysed.",
  },
  {
    question: "Are there limits?",
    answer:
      "During the beta: 50 papers per account, 10 MB per PDF, and each day 1,000,000 chat tokens, 10 deep research runs and 40 web searches. The daily limits reset at midnight UTC.",
  },
  {
    question: "Who can see my papers?",
    answer:
      "Only you. A repository belongs to the account that created it; every request for its papers, charts or chats is checked against that account, and the database enforces it too.",
  },
];

export const footerLinks = [
  { label: "Paper analysis", href: "/features/paper-analysis" },
  { label: "Research dashboard", href: "/features/research-dashboard" },
  { label: "Research chat", href: "/features/ai-research-chat" },
  { label: "Search docs", href: "/docs/search" },
];
