/*
 * The words on the public pages that more than one page uses, kept apart from
 * the layout so they can be checked against the product in one place.
 *
 * Every figure here can be traced to the code:
 *  - 13 analysis steps, 4 in parallel: the ingestion graph in graphs.py.
 *  - 6 dashboard views: DashboardClient's TAB_DEFINITIONS.
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
  | "ai-research-chat"
  | "cloud-queue";

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
  /** The points the home page makes about it. */
  homeBullets: string[];
  shot: string;
  shotAlt: string;
}

export const marketingFeatures: MarketingFeature[] = [
  {
    slug: "paper-analysis",
    navLabel: "Analysis",
    title: "Every paper, read the same careful way.",
    description:
      "Upload a PDF and Papertrend finds its title, year, methods, topics and category, and keeps the sentence each one came from.",
    homeSummary: "Title, year, methods, topics and category for every paper, each with the passage it came from.",
    inside: "The 13-step pipeline, four steps at a time, and a puzzle: date a Thai thesis by its cover.",
    homeBullets: [
      "A year shown with the line it was read from",
      "A category with the reason it was chosen",
      "Keywords kept only when they appear in the paper",
      "Scanned pages read by a vision model, Thai papers translated",
    ],
    shot: "paper",
    shotAlt:
      "The paper viewer for a 2022 sample paper on mangroves and seawalls in Semarang: its category and the reason for it, the line its year was read from, its own keywords, methods and topics.",
  },
  {
    slug: "research-dashboard",
    navLabel: "Dashboard",
    title: "See how a field has moved.",
    description:
      "Six views over the papers you analysed: themes by year, categories, keywords, a map of related papers, and patterns worth a second look.",
    homeSummary: "Themes by year, categories over time and the keywords behind them, for one repository at a time.",
    inside: "How three passes agree on a theme, six views and the question each answers, and every number’s papers one click away.",
    homeBullets: [
      "Each view opens with a sentence that says what it shows",
      "Topics named differently by different papers grouped into one theme",
      "Click any number for the papers behind it",
      "Every chart’s data downloads as CSV",
    ],
    shot: "dashboard-trends",
    shotAlt:
      "The Trend Analysis view of a 41-paper sample repository: a sentence on which themes are gaining ground, above themes by year from 2011 to 2025.",
  },
  {
    slug: "ai-research-chat",
    navLabel: "Chat",
    title: "Ask your papers. Check every answer.",
    description:
      "Chat answers from the papers in your repository, in English or Thai, with a numbered source on every claim. Deep research writes a checked report; Chart mode counts.",
    homeSummary: "Answers drawn from your papers, with a numbered source for every claim.",
    inside: "What happens after you press Enter, the models behind each step, and a chance to be the auditor.",
    homeBullets: [],
    shot: "chat",
    shotAlt:
      "Chat answering “Do mangroves or seawalls reduce flood damage more?” from a 41-paper sample repository, with four numbered sources, Copy and Download (.md), and GPT-6 Luna named under the composer.",
  },
  {
    slug: "cloud-queue",
    navLabel: "Uploads",
    title: "Drop in fifty papers. Keep working.",
    description:
      "Upload up to 50 PDFs at once, or pick them from Google Drive. They are analysed in the cloud, one after another, while you get on with something else.",
    homeSummary: "Up to 50 PDFs at a time, from your computer or Google Drive, analysed in the background.",
    inside: "The route a PDF takes through the cloud, the ten steps you can watch, and what happens when one fails.",
    homeBullets: [
      "Up to 50 PDFs at once, from your computer or Google Drive",
      "A paper already in your library is caught before it uploads",
      "Ten named steps per paper, in a tray on every page",
      "Close the tab once the files are up: the work carries on",
    ],
    shot: "home",
    shotAlt:
      "A repository’s home page in the sample collection: 41 papers, 83 topics and 408 keywords from 2011 to 2025, a box to ask about them, and the latest papers marked Ready.",
  },
];

export const workflowSteps = [
  {
    title: "Add your papers",
    copy: "Upload PDFs into a repository, up to 50 at a time, from your computer or Google Drive. English or Thai.",
  },
  {
    title: "Let each one be read",
    copy: "Title, year, sections, keywords, topics, methods and category, each kept with the passage it came from. Usually a few minutes a paper.",
  },
  {
    title: "Explore and ask",
    copy: "Chart how the field has moved, then ask questions and get answers with a source on every claim.",
  },
];

/** The details a careful reader asks about before trusting the tool. */
export const productDetails: Array<{ term: string; detail: string }> = [
  {
    term: "Files",
    detail:
      "PDF, up to 10 MB each and 50 per upload; up to 50 papers per account during the beta. A file already in your library is caught before it uploads.",
  },
  { term: "From", detail: "Your computer, or Google Drive. With Drive, Papertrend can open only the files you pick." },
  {
    term: "Languages",
    detail:
      "Papers in English and Thai, and answers in either. Thai text is translated for analysis; Thai headings, keyword lists and Buddhist-era years are recognised.",
  },
  {
    term: "Scanned papers",
    detail: "Pages without a text layer are read by a vision model, so a scanned thesis, or just a scanned cover, still has a route through.",
  },
  {
    term: "Analysis",
    detail:
      "13 steps per paper, four of them side by side: text, sections, title and year, the paper’s own keywords, grounded keywords, aims, topics, their names, category and kind of study.",
  },
  {
    term: "Models",
    detail:
      "GPT-6 Luna writes and checks answers; Gemini 3.8 Flash checks deep research; Gemini Flash-Lite reads papers and builds charts; OpenAI embeddings search by meaning.",
  },
  {
    term: "Corrections",
    detail:
      "Fix a title or year by hand and it survives re-analysis. Re-analyse papers, or reclassify a repository after changing its categories.",
  },
  {
    term: "Exports",
    detail: "Answers, reports and whole conversations as Markdown; any chart’s data as CSV; references as BibTeX, RIS or APA.",
  },
  {
    term: "Privacy",
    detail:
      "A repository belongs to the account that created it, and the database itself enforces that. Data is kept on Google Cloud in Singapore.",
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
      "Every claim in a chat answer carries a numbered source that opens the paper at that sentence, and every year and category in an analysis shows the line or reason behind it. A draft whose support is in doubt is checked against its sources before you see it, and when the papers do not answer a question, Chat says so.",
  },
  {
    question: "Which AI models does it use?",
    answer:
      "GPT-6 Luna (OpenAI) plans, writes and checks chat answers and deep research reports. Gemini 3.8 Flash (Google) checks every sentence of a deep research report. Gemini Flash-Lite reads each paper and builds charts, and OpenAI’s text-embedding-3-small finds passages by meaning. Each was measured on a real repository before it was switched on.",
  },
  {
    question: "Can I use my own categories?",
    answer:
      "Yes. Each repository has an analysis profile: General research, the official EIL tracks, or a custom taxonomy of 2 to 12 categories you define. Change it later and reclassify the papers already analysed.",
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
  { label: "Uploads", href: "/features/cloud-queue" },
  { label: "Documentation", href: "/docs" },
  { label: "Search docs", href: "/docs/search" },
];
