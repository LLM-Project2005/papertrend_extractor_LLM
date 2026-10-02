/*
 * The words on the public pages, kept apart from the layout so they can be
 * checked against the product in one place.
 *
 * Every figure here can be traced to the code:
 *  - 12 analysis stages: the ingestion graph in graphs.py registers 13 nodes,
 *    12 of which analyse and the thirteenth assembles the dataset.
 *  - 6 dashboard views: DashboardClient's TAB_DEFINITIONS.
 *  - 50 PDFs per upload, 10 MB each: AnalyzeFlowModal's MAX_UPLOAD_FILES and
 *    MAX_UPLOAD_FILE_BYTES.
 *  - 2 to 12 custom categories: project-analysis-profile.ts.
 * A claim that cannot be checked like this does not belong on these pages.
 */

export type FeatureSlug =
  | "paper-analysis"
  | "research-dashboard"
  | "ai-research-chat"
  | "cloud-queue";

export interface FeatureSection {
  title: string;
  copy: string;
  bullets: string[];
  /** A screenshot name from public/marketing (see shot-manifest.ts). */
  shot?: string;
  shotAlt?: string;
}

export interface MarketingFeature {
  slug: FeatureSlug;
  navLabel: string;
  /** The page's headline. */
  title: string;
  /** One sentence under the headline, and the meta description. */
  description: string;
  /** The line used where the feature is listed on the home page. */
  homeSummary: string;
  shot: string;
  shotAlt: string;
  proof: {
    metric: string;
    label: string;
  }[];
  sections: FeatureSection[];
}

export const marketingFeatures: MarketingFeature[] = [
  {
    slug: "paper-analysis",
    navLabel: "Analysis",
    title: "Every paper, read the same careful way.",
    description:
      "Upload a PDF and Papertrend reads it for its title, year, sections, keywords, topics, methods and category, and keeps the passage each finding came from.",
    homeSummary: "Title, year, methods, topics and category for every paper, each with the passage it came from.",
    shot: "paper",
    shotAlt: "The paper explorer showing a 2017 study's category, the journal line its year came from, its own keywords and the method found.",
    proof: [
      { metric: "12", label: "analysis stages per paper" },
      { metric: "50", label: "PDFs per upload" },
      { metric: "2", label: "languages: English and Thai" },
    ],
    sections: [
      {
        title: "Findings you can check",
        copy:
          "A year is shown with the line it was read from. A category comes with the reason it was chosen. Keywords are only kept when they appear in the paper, and each one comes with the sentence it was found in.",
        bullets: [
          "Year with its source line and confidence",
          "Category with a written rationale",
          "Keywords grounded in the text",
          "The paper's own keywords, kept separately",
        ],
        shot: "paper",
        shotAlt: "A paper's analysis: category and rationale, publication year with its evidence, and research type.",
      },
      {
        title: "Built for real PDFs",
        copy:
          "Scanned pages are read with OCR, Thai papers are translated for analysis, and long theses are split by their own headings. If a step cannot finish, the paper says why instead of failing quietly.",
        bullets: [
          "OCR for pages without a text layer",
          "Thai translated before keywords are drawn",
          "Correct a title or year by hand at any time",
          "Re-analyze one paper, or a whole repository",
        ],
      },
    ],
  },
  {
    slug: "research-dashboard",
    navLabel: "Dashboard",
    title: "See how the field has moved.",
    description:
      "Themes by year, categories over time, the keywords behind each theme, and a map of how papers relate, all drawn from the papers you analyzed.",
    homeSummary: "Themes by year, categories over time and the keywords behind them, for one repository at a time.",
    shot: "dashboard-trends",
    shotAlt: "The Trend Analysis tab: themes by year as stacked bars from 2011 to 2025, with a written summary of which themes are gaining ground.",
    proof: [
      { metric: "6", label: "dashboard views" },
      { metric: "Themes", label: "grouped across papers" },
      { metric: "Filters", label: "year, category, search" },
    ],
    sections: [
      {
        title: "A summary before the chart",
        copy:
          "Each view opens with a sentence that says what the chart shows, in numbers: which themes grew, which category holds the most papers, which years are thin.",
        bullets: [
          "Overview, Trend Analysis and Category Analysis",
          "Keyword Explorer and Semantic Map",
          "Adaptive: patterns no other view shows, with the numbers behind them",
        ],
        shot: "dashboard-categories",
        shotAlt: "The Category Analysis tab: papers per category per year, stacked by English Language Instruction, Linguistics and Assessment.",
      },
      {
        title: "Themes, not a pile of keywords",
        copy:
          "Topics from different papers that study the same thing are grouped into one theme, so a chart counts papers rather than spellings. Duplicate uploads are flagged, so nothing is counted twice without you knowing.",
        bullets: [
          "Topics grouped into shared themes",
          "Undated papers kept out of year charts, and counted",
          "Duplicate uploads flagged on the dashboard",
        ],
        shot: "dashboard-keywords",
        shotAlt: "The Keyword Explorer tab showing the keywords behind each theme.",
      },
    ],
  },
  {
    slug: "ai-research-chat",
    navLabel: "Chat",
    title: "Ask a question. Check the answer.",
    description:
      "Chat answers from the papers in your repository and cites the paper behind each claim. Deep research plans its reading first, then writes a report.",
    homeSummary: "Answers drawn from your papers, with a numbered citation for every claim.",
    shot: "chat",
    shotAlt: "A deep research report in Chat about dynamic assessment in Thai EFL papers, with numbered citations.",
    proof: [
      { metric: "Cites", label: "a paper for each claim" },
      { metric: "Deep", label: "research reports" },
      { metric: "Charts", label: "on request" },
    ],
    sections: [
      {
        title: "Grounded in your repository",
        copy:
          "An answer only draws on the papers you chose to ask about: a whole repository, or a handful you attach. Each claim carries a number that opens the paper it came from.",
        bullets: [
          "Ask the whole repository or selected papers",
          "Numbered citations with the paper's title and year",
          "Says so when the papers do not answer the question",
        ],
      },
      {
        title: "Deep research for bigger questions",
        copy:
          "For a question that needs more than one paper, deep research sets out its steps, reads the relevant sections, checks that the evidence covers the question, and writes a report you can open full screen.",
        bullets: [
          "A visible plan before any writing",
          "Reads sections, not only summaries",
          "Charts from your data, drawn in the conversation",
        ],
      },
    ],
  },
  {
    slug: "cloud-queue",
    navLabel: "Batch uploads",
    title: "Add a folder of papers and keep working.",
    description:
      "Upload up to 50 PDFs at once. They are analyzed in the background, one after another, and a small tray shows where each paper is.",
    homeSummary: "Up to 50 PDFs at a time, analyzed in the background with a step-by-step progress tray.",
    shot: "home",
    shotAlt: "A repository's home page: the papers, topics and keywords it holds, a box to ask about the papers, and the most recent papers with their status.",
    proof: [
      { metric: "50", label: "PDFs per upload" },
      { metric: "10", label: "steps shown per paper" },
      { metric: "10 MB", label: "per file" },
    ],
    sections: [
      {
        title: "Progress you can read",
        copy:
          "Each paper shows the step it is on, out of ten, and how long it has been there. Once the files have uploaded you can close the tab: the analysis carries on, and the tray picks up where it was when you come back.",
        bullets: [
          "Ten named steps, from upload to saved",
          "A corner tray on every page, a bottom sheet on a phone",
          "Cancel one paper or all of them",
        ],
      },
      {
        title: "Nothing counted twice by accident",
        copy:
          "A file already analyzed in your account is caught before it uploads. A paper that fails says why, in a sentence, with the original error underneath for whoever is diagnosing it.",
        bullets: [
          "Duplicate files stopped before upload",
          "Plain-language failure reasons",
          "Retry a stalled queue from the tray",
        ],
      },
    ],
  },
];

export const workflowSteps = [
  {
    title: "Add your papers",
    copy: "Upload PDFs into a repository: up to 50 at a time, English or Thai.",
  },
  {
    title: "Let each one be read",
    copy: "Title, year, sections, keywords, topics, methods and category, usually in a few minutes per paper.",
  },
  {
    title: "Explore and ask",
    copy: "Chart how the field has moved, then ask questions and get answers that cite their papers.",
  },
];

/**
 * The figures on the home page's specification list.
 *
 * It once read "4 core research workflows" and "1 workspace for papers, charts
 * and chat", set at display size, where the eye goes looking for evidence and
 * found a 4 and a 1 that proved nothing. Each figure here can be counted in the
 * code: twelve analysing nodes in the ingestion graph (graphs.py), six entries
 * in the dashboard's TAB_DEFINITIONS. The third is not a quantity and is not
 * set like one.
 */
export const proofMetrics = [
  { value: "12", label: "analysis stages per paper" },
  { value: "6", label: "dashboard views over one corpus" },
  { value: "Async", label: "multi-paper queue with retries" },
];

/** The details a careful reader asks about before trusting the tool. */
export const productDetails: Array<{ term: string; detail: string }> = [
  { term: "Files", detail: "PDF, up to 10 MB each and 50 per upload. A file already analyzed in your account is caught before it uploads." },
  { term: "Languages", detail: "English and Thai. Thai text is translated before keywords and topics are drawn from it." },
  { term: "Scanned papers", detail: "Pages without a text layer are read with OCR, so a scanned thesis still has a route through." },
  { term: "Analysis", detail: "12 stages per paper: text, sections, metadata, the paper's own keywords, grounded keywords, topics, labels, category, research type and facets." },
  { term: "Categories", detail: "General research with no forced categories, the official EIL tracks, or your own taxonomy of 2 to 12 categories." },
  { term: "Corrections", detail: "Fix a title or year by hand, re-analyze a paper, or reclassify a whole repository after changing its categories." },
  { term: "Dashboard", detail: "6 views over one repository: overview, trends, categories, keywords, a semantic map and an adaptive view." },
  { term: "Privacy", detail: "A repository belongs to the account that created it. Only that account can open its papers, charts and chats." },
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
      "Usually a few minutes. Papers in one upload are analyzed one after another in the background, so you can leave the page and come back; the progress tray shows the step each paper is on.",
  },
  {
    question: "How do I know an answer is right?",
    answer:
      "Every claim in a chat answer carries a numbered citation that opens the paper it came from, and every year and category in the analysis shows the passage or reason behind it. When the papers do not answer a question, Chat says so.",
  },
  {
    question: "Can I use my own categories?",
    answer:
      "Yes. Each repository has an analysis profile: General research, the official EIL tracks, or a custom taxonomy of 2 to 12 categories you define. Change it later and reclassify the papers already analyzed.",
  },
  {
    question: "Who can see my papers?",
    answer:
      "Only you. A repository belongs to the account that created it, and every request for its papers, charts or chats is checked against that account.",
  },
];

export const footerLinks = [
  { label: "Paper analysis", href: "/features/paper-analysis" },
  { label: "Research dashboard", href: "/features/research-dashboard" },
  { label: "Research chat", href: "/features/ai-research-chat" },
  { label: "Batch uploads", href: "/features/cloud-queue" },
  { label: "Documentation", href: "/docs" },
  { label: "Search docs", href: "/docs/search" },
];

export const valuePillars = [
  "Workspace-wide research intelligence",
  "Chat, charts, and dashboard from the same corpus",
  "Cloud-ready multi-paper analysis",
  // The fourth pillar used to read "Static marketing pages with client-only auth
  // CTA" - a build note, shipped to visitors as a reason to choose the product.
  // Replaced with something a researcher can actually check: each file's status
  // is shown on the file in the library, and a stalled queue can be restarted
  // from the analysis status panel.
  "Per-file queue status and stalled-queue recovery",
];
