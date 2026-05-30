export type DocsCalloutTone = "info" | "success" | "warning";

export interface DocsCallout {
  tone: DocsCalloutTone;
  title: string;
  body: string;
}

export interface DocsSection {
  id: string;
  title: string;
  body: string[];
  bullets?: string[];
  steps?: string[];
  checklist?: string[];
  callout?: DocsCallout;
}

interface DocsPageBase {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  popular?: boolean;
  sections: DocsSection[];
  related?: string[];
}

interface DocsCategoryBase {
  id: string;
  label: string;
  description: string;
  pages: DocsPageBase[];
}

export interface DocsPage extends DocsPageBase {
  categoryId: string;
  categoryLabel: string;
}

export interface DocsCategory {
  id: string;
  label: string;
  description: string;
  pages: DocsPage[];
}

export interface DocsSearchItem {
  id: string;
  title: string;
  description: string;
  href: string;
  category: string;
  tags: string[];
  searchText: string;
  pageSlug: string;
  sectionId?: string;
}

const rawDocsCategories: DocsCategoryBase[] = [
  {
    id: "start",
    label: "Start here",
    description: "Learn the product model, workspace structure, and first useful workflows.",
    pages: [
      {
        slug: "getting-started",
        title: "Getting started",
        description:
          "Create a workspace, upload papers, wait for analysis, and use the first dashboard and chat workflows.",
        tags: ["start", "workspace", "upload", "dashboard", "chat", "first run"],
        popular: true,
        sections: [
          {
            id: "what-papertrend-does",
            title: "What Papertrend does",
            body: [
              "Papertrend turns research PDFs into a reusable workspace of structured evidence, dashboard views, and AI conversations. Instead of treating each paper as an isolated file, Papertrend stores the paper, extracted sections, metadata, topics, keywords, track labels, facets, and chat context together.",
              "The result is a research workspace where the same analyzed paper can power library search, trend charts, chart mode in chat, deep research reports, and paper detail inspection.",
            ],
            bullets: [
              "Use the library to manage uploaded or imported files.",
              "Use analysis to extract structured signals from each paper.",
              "Use the dashboard to understand patterns across the workspace.",
              "Use chat and deep research to ask questions, build charts, and produce longer research outputs.",
            ],
          },
          {
            id: "first-workflow",
            title: "Recommended first workflow",
            body: [
              "The fastest way to understand Papertrend is to run one small paper batch, then inspect the same papers in the library, dashboard, and chat.",
            ],
            steps: [
              "Open a workspace and choose or create a project.",
              "Go to Library and upload a small set of PDFs.",
              "Start analysis and keep the page open until the first status update appears.",
              "Open the Dashboard after one or more papers finish analyzing.",
              "Open Chat, attach an analyzed paper, and ask for a summary, critique, or chart.",
            ],
            callout: {
              tone: "info",
              title: "Start with a small batch",
              body:
                "For the first run, use two or three papers. This makes it easier to verify analysis quality and understand the status lifecycle before uploading a larger folder.",
            },
          },
          {
            id: "what-ready-means",
            title: "What ready means",
            body: [
              "A paper is ready when the analysis run succeeds and its extracted outputs are persisted. Ready papers can appear in the dashboard, chart mode, library detail panels, and chat retrieval.",
              "A queued or processing paper can still be visible in the library, but it may not have topics, keywords, year evidence, or chartable values yet.",
            ],
            checklist: [
              "The file status is succeeded.",
              "The paper detail panel opens without a failed-status warning.",
              "The dashboard counts the paper in the workspace scope.",
              "Chart mode can find at least one topic, keyword, track, or year value for the paper.",
            ],
          },
          {
            id: "common-first-questions",
            title: "Common first questions",
            body: [
              "If the dashboard looks empty, check whether the selected workspace/project/folder contains succeeded analysis runs. If chat says no analyzed data was found, the attached file may be failed, queued, processing, or not connected to a persisted paper yet.",
              "If a paper year is unknown, Papertrend could not find enough reliable year evidence in the extracted text or metadata. The evaluation guide explains how to interpret year confidence and when to reanalyze.",
            ],
            bullets: [
              "Use Library for file status.",
              "Use Dashboard for workspace-level patterns.",
              "Use Chat for paper-level questions and chart requests.",
              "Use Troubleshooting when queue, auth, or no-data states appear.",
            ],
          },
        ],
        related: ["library-uploads", "research-dashboard", "ai-research-chat"],
      },
      {
        slug: "workspace-concepts",
        title: "Workspace concepts",
        description:
          "Understand workspaces, projects, folders, files, analysis runs, and how scope affects what you see.",
        tags: ["workspace", "project", "folder", "scope", "library", "settings"],
        popular: true,
        sections: [
          {
            id: "workspace-project-folder",
            title: "Workspace, project, and folder",
            body: [
              "Papertrend separates organization-level identity from project-level research work. A workspace can contain multiple projects, and each project can contain folders. Folders are useful when a project has several datasets, courses, research themes, or collection phases.",
              "The home page and dashboard are designed to show workspace or project-wide data depending on the current route. Library views can narrow into a folder, but the home page should be read as a command center for the current workspace context.",
            ],
            bullets: [
              "Workspace: the top-level place where research teams work.",
              "Project: a research area or corpus inside a workspace.",
              "Folder: an optional grouping for paper collections.",
              "Paper: the analyzed research object created from an uploaded or imported file.",
            ],
          },
          {
            id: "analysis-run",
            title: "Analysis runs",
            body: [
              "An analysis run tracks one file as it moves through the queue. The run stores upload metadata, status, error messages, and a link to the persisted paper content when analysis succeeds.",
              "A file can exist in the library before analysis succeeds. This is why a library file can be selectable in chat but still not produce a chart until the worker has generated and saved structured data.",
            ],
            bullets: [
              "queued means the file is waiting for a worker.",
              "processing means a worker has claimed the file.",
              "succeeded means structured paper outputs were saved.",
              "failed means the worker could not complete the analysis and the file may need retry or inspection.",
            ],
          },
          {
            id: "scope-and-results",
            title: "Scope and results",
            body: [
              "Scope decides which papers a page or chat request should consider. Some requests are naturally session-focused, such as asking about an attached paper. Others are workspace-focused, such as asking for a chart of all analyzed papers.",
              "When in doubt, attach the specific paper or say the scope in the prompt. For example: create a top topic chart for this attached paper, or create a yearly trend chart across my workspace.",
            ],
            callout: {
              tone: "success",
              title: "Session context comes first in chat",
              body:
                "Chat mode should prioritize the files attached in the current conversation unless the user clearly asks for workspace, project, or folder-wide analysis.",
            },
          },
          {
            id: "settings-profile",
            title: "Settings and profile",
            body: [
              "Profile stores user-level identity such as name and avatar. Workspace settings store workspace-level preferences and display choices. Keep these concepts separate: changing a profile should not change a workspace, and changing a workspace should not change the user account.",
            ],
            checklist: [
              "Use Profile for account identity.",
              "Use Workspace settings for project and workspace preferences.",
              "Use Workspaces to switch between projects.",
              "Use Search to jump to actions, papers, folders, projects, and documentation.",
            ],
          },
        ],
        related: ["search-navigation", "settings-profile", "library-uploads"],
      },
    ],
  },
  {
    id: "workspace",
    label: "Workspace and library",
    description: "Manage files, imports, navigation, profile, and workspace settings.",
    pages: [
      {
        slug: "library-uploads",
        title: "Library, uploads, and paper status",
        description:
          "Use the library to upload papers, inspect analysis status, retry failed files, and open paper details.",
        tags: ["library", "upload", "file", "analysis status", "retry", "failed", "paper detail"],
        popular: true,
        sections: [
          {
            id: "library-purpose",
            title: "What the library is for",
            body: [
              "The library is the operational center for files. It shows uploaded papers, imported files, analysis status, favorite and trash state, and paper detail access.",
              "A library item is not always the same thing as an analyzed paper. The item appears when the file is registered, while chartable paper data appears only after analysis succeeds.",
            ],
            bullets: [
              "Upload PDFs and start analysis.",
              "Inspect queued, processing, succeeded, and failed files.",
              "Open analysis details for succeeded papers.",
              "Retry failed or stale processing runs when available.",
            ],
          },
          {
            id: "upload-flow",
            title: "Upload flow",
            body: [
              "Papertrend uses a queue-based upload flow so large PDF analysis does not block the browser request. The browser uploads the file, the app creates an analysis run, and a background worker analyzes the file later.",
            ],
            steps: [
              "Choose a project or folder context.",
              "Open Library and select upload or analysis.",
              "Select one or more PDF files.",
              "Confirm the queue action.",
              "Watch the status indicators or continue working while Cloud Tasks triggers processing.",
            ],
          },
          {
            id: "file-status",
            title: "Status meanings",
            body: [
              "Status values explain where the file is in the analysis lifecycle. They are also the first thing to check when dashboard or chart results seem missing.",
            ],
            bullets: [
              "queued: the file is waiting for the queue worker.",
              "processing: extraction or LLM analysis is currently running.",
              "succeeded: data was saved and can be used by dashboard, chat, and chart mode.",
              "failed: analysis stopped before producing a complete persisted result.",
            ],
            callout: {
              tone: "warning",
              title: "Failed files can still be attached",
              body:
                "A failed library file may appear selectable, but it may not have chartable topics or keywords. If the source file is still available, retry analysis before asking for charts from that file.",
            },
          },
          {
            id: "paper-detail",
            title: "Paper detail panel",
            body: [
              "The paper detail panel is where users inspect the output of a single succeeded analysis. It should show the extracted paper identity, abstract or text sections, keywords, topics, tracks, facets, and other saved signals when available.",
            ],
            checklist: [
              "Use the detail panel to validate whether the extracted title and year look correct.",
              "Compare keyword evidence with the paper text before citing trends.",
              "Use missing sections as a signal that the PDF extraction quality may have been weak.",
              "Retry or reupload if a paper has a failed status and no analysis detail.",
            ],
          },
        ],
        related: ["paper-analysis", "cloud-queue", "troubleshooting"],
      },
      {
        slug: "google-drive-imports",
        title: "Google Drive imports",
        description:
          "Connect Drive, select files, queue them for analysis, and understand import limitations.",
        tags: ["google drive", "drive", "import", "integration", "cloud files", "queue"],
        sections: [
          {
            id: "drive-purpose",
            title: "What Drive imports do",
            body: [
              "Google Drive imports let users bring research PDFs into Papertrend without downloading and reuploading them manually. Imported files still enter the same analysis queue as browser uploads.",
              "The integration is a convenience layer. The final analysis quality still depends on file accessibility, PDF extraction quality, and successful queue processing.",
            ],
          },
          {
            id: "import-flow",
            title: "Import flow",
            body: [
              "A Drive import starts with authorization, then file selection, then queue creation. The app should show imported files in the library so users can track status like any other run.",
            ],
            steps: [
              "Connect Google Drive from the import or integration entry point.",
              "Choose one or more accessible PDF files.",
              "Queue the selected files for analysis.",
              "Return to Library or Home to watch progress.",
              "Open Dashboard or Chat once files succeed.",
            ],
          },
          {
            id: "limitations",
            title: "Limitations",
            body: [
              "Drive imports depend on permissions and file type. If a file cannot be read, converted, or downloaded by the integration, Papertrend cannot analyze it until the user fixes access or uploads the file directly.",
            ],
            bullets: [
              "Prefer PDF files for the current analysis pipeline.",
              "Shared files may require permission changes before import.",
              "Very large files may take longer to queue and analyze.",
              "Failed imports should be retried only after confirming access.",
            ],
          },
          {
            id: "when-to-upload-instead",
            title: "When to upload instead",
            body: [
              "If Drive authorization or file permissions are the blocker, downloading the PDF and uploading it through Library is usually faster. Both routes end in the same queue and analysis pipeline.",
            ],
            callout: {
              tone: "info",
              title: "Same analysis path",
              body:
                "Drive imports and local uploads should produce comparable outputs because both are processed by the same background worker pipeline after the file enters the queue.",
            },
          },
        ],
        related: ["library-uploads", "cloud-queue", "troubleshooting"],
      },
      {
        slug: "search-navigation",
        title: "Search and navigation",
        description:
          "Use the workspace command search to jump to actions, papers, folders, projects, and docs.",
        tags: ["search", "command menu", "navigation", "docs", "library search", "project switch"],
        sections: [
          {
            id: "global-search",
            title: "Workspace search",
            body: [
              "Workspace search is a command menu for moving quickly through the app. It searches actions, pages, library files, workspaces, projects, folders, and documentation entries.",
              "This search is different from docs search. Workspace search is optimized for navigation and app actions. Docs search is optimized for learning and troubleshooting content.",
            ],
            bullets: [
              "Search analyze paper to open upload and analysis actions.",
              "Search deep research to open chat workflows.",
              "Search a paper title to open a library item.",
              "Search docs topics such as queue stuck or chart mode to open documentation.",
            ],
          },
          {
            id: "navigation-model",
            title: "Navigation model",
            body: [
              "The workspace shell has a main top header, a compact rail, and page-specific content. Public pages such as the marketing home and docs are outside the project workspace, while workspace pages depend on the selected project context.",
            ],
            bullets: [
              "Use the logo to return to the public front page.",
              "Use Workspaces to switch project context.",
              "Use Docs for product help and evaluation guidance.",
              "Use Search when you know what you want but not where it lives.",
            ],
          },
          {
            id: "good-search-queries",
            title: "Good search queries",
            body: [
              "Search works best with product words and task names. If a result does not appear, try a feature name, a symptom, or an action.",
            ],
            bullets: [
              "upload paper",
              "failed file",
              "chart mode",
              "unknown year",
              "dashboard filter",
              "queue stuck",
              "deep research report",
            ],
          },
          {
            id: "search-boundaries",
            title: "Search boundaries",
            body: [
              "Workspace search can find files that the current user can access through the app. It does not expose another user's private library. Public docs search does not require authentication and only searches public documentation content.",
            ],
          },
        ],
        related: ["getting-started", "troubleshooting", "workspace-concepts"],
      },
      {
        slug: "settings-profile",
        title: "Profile and workspace settings",
        description:
          "Understand account profile, workspace preferences, and when to use each settings surface.",
        tags: ["profile", "settings", "workspace settings", "account", "avatar", "preferences"],
        sections: [
          {
            id: "profile",
            title: "Profile",
            body: [
              "Profile is the user-level identity surface. It is where a user checks or updates account-facing details such as display name and avatar where supported.",
              "Profile changes should not be treated as project changes. The same user profile can work across multiple workspaces or projects.",
            ],
          },
          {
            id: "workspace-settings",
            title: "Workspace settings",
            body: [
              "Workspace settings are for workspace identity and preferences. These settings should affect how the workspace is presented, not the underlying analysis outputs already saved for papers.",
            ],
            bullets: [
              "Use settings for naming and workspace preferences.",
              "Use Library for file-level actions.",
              "Use Dashboard for analysis views.",
              "Use Workspaces for project switching.",
            ],
          },
          {
            id: "safe-changes",
            title: "Safe changes",
            body: [
              "Changing display preferences should be safe. Analysis outputs such as keywords, paper content, tracks, and year evidence are tied to paper records and should not be affected by profile display changes.",
            ],
            checklist: [
              "Confirm the selected workspace before changing workspace settings.",
              "Use project switching if the wrong project is open.",
              "Avoid reanalyzing papers just to update profile or display preferences.",
            ],
          },
          {
            id: "access",
            title: "Access expectations",
            body: [
              "Papertrend relies on authenticated workspace access for private data. Public documentation is available without login, but workspace data, library files, chat history, and dashboard results require a valid session.",
            ],
          },
        ],
        related: ["workspace-concepts", "search-navigation", "troubleshooting"],
      },
    ],
  },
  {
    id: "insight",
    label: "Analysis and insight",
    description: "Understand extraction, dashboards, chat tools, deep research, and background processing.",
    pages: [
      {
        slug: "paper-analysis",
        title: "Paper analysis pipeline",
        description:
          "Understand how Papertrend extracts metadata, sections, keywords, topics, tracks, typologies, facets, and year evidence.",
        tags: ["analysis", "pipeline", "metadata", "year", "keyword", "topic", "track", "typology", "facet"],
        popular: true,
        sections: [
          {
            id: "pipeline-overview",
            title: "Pipeline overview",
            body: [
              "The analysis pipeline turns a PDF file into structured paper data. It starts with file download and text extraction, then separates useful sections, sends focused tasks to models, normalizes the result, and persists rows that the dashboard, library, and chat can reuse.",
              "The exact model used may change by deployment configuration, but the product contract is stable: a succeeded paper should have enough structured output to be useful in search, dashboard views, and chat.",
            ],
            bullets: [
              "Text extraction and cleanup.",
              "Semantic section detection.",
              "Metadata and year evidence extraction.",
              "Keyword, topic, and concept extraction.",
              "Track, typology, and facet classification.",
              "Persistence into workspace-scoped tables.",
            ],
          },
          {
            id: "outputs",
            title: "Important outputs",
            body: [
              "The most visible outputs are paper title, year, topics, keywords, tracks, paper content, and evidence snippets. Some outputs are used directly in charts, while others support quality review and grounded answers.",
            ],
            bullets: [
              "Year values power timelines and dashboard filters.",
              "Topics group keywords into higher-level themes.",
              "Keywords provide searchable paper-level signals.",
              "Tracks classify papers into research track buckets.",
              "Facets and typologies add higher-level interpretation.",
              "Paper content provides the grounding context for chat and detail panels.",
            ],
          },
          {
            id: "year-detection",
            title: "Year detection",
            body: [
              "Year detection is evidence-based. Papertrend should prefer strong year evidence from title pages, metadata, citation context, or publication-like fields. If the year cannot be found reliably, it should be marked unknown rather than invented.",
              "A low confidence year should be treated as a review signal. Users should inspect year evidence before using the paper in timeline claims.",
            ],
            callout: {
              tone: "warning",
              title: "Unknown is safer than fake precision",
              body:
                "If no credible year evidence exists in the extracted content, Papertrend should preserve uncertainty instead of guessing a publication year.",
            },
          },
          {
            id: "quality-review",
            title: "How to review analysis quality",
            body: [
              "The best review is evidence-first. Check whether the extracted title matches the file, whether the year evidence is plausible, whether keywords appear in meaningful sections, and whether topics represent the paper rather than a single stray phrase.",
            ],
            checklist: [
              "Title and file identity match.",
              "Year is known or uncertainty is clearly shown.",
              "Keywords have evidence from relevant sections.",
              "Topic labels are broad enough to group related terms.",
              "Track labels match the paper's actual research focus.",
              "Charts built from the paper reflect available analyzed rows.",
            ],
          },
        ],
        related: ["evaluation-quality", "research-dashboard", "cloud-queue"],
      },
      {
        slug: "research-dashboard",
        title: "Research dashboard and adaptive views",
        description:
          "Use workspace-wide analytics, filters, top topics, top keywords, tracks, and year views to understand a corpus.",
        tags: ["dashboard", "adaptive dashboard", "filters", "topics", "keywords", "tracks", "year", "charts"],
        popular: true,
        sections: [
          {
            id: "dashboard-purpose",
            title: "What the dashboard shows",
            body: [
              "The dashboard turns succeeded analysis rows into research views. It is designed for comparing topics, keywords, track distributions, years, and coverage across the current corpus.",
              "Dashboard values should be read as structured summaries of analyzed papers, not as a replacement for reading the papers. Use the detail panel and evidence snippets when a pattern matters.",
            ],
            bullets: [
              "Paper counts and coverage.",
              "Top topics and keywords.",
              "Year distribution and trend movement.",
              "Single-track and multi-track classifications.",
              "Adaptive views that reorganize the same corpus signals.",
            ],
          },
          {
            id: "filters",
            title: "Filters and scope",
            body: [
              "Filters change which analyzed rows are included in the dashboard view. Typical filters include folder, year, track, and other corpus dimensions available in the UI.",
              "If a count does not change after a filter, first confirm that the data exists across multiple filter values. A corpus with one dominant folder, one year, or missing year data may not visibly change for every filter.",
            ],
            checklist: [
              "Confirm you are viewing the intended workspace or project.",
              "Check whether papers have known years before using year filters.",
              "Use all folders when you want workspace-wide counts.",
              "Use paper detail when a dashboard aggregate looks surprising.",
            ],
          },
          {
            id: "adaptive-dashboard",
            title: "Adaptive dashboard",
            body: [
              "The adaptive dashboard is intended to help users move between overview and focused inspection. It should make the strongest available patterns easy to scan while still letting users drill into the underlying papers.",
              "Adaptive views are useful when the corpus is uneven. They can reveal whether a trend is broad across papers or driven by a small number of files.",
            ],
            bullets: [
              "Use adaptive views for exploration.",
              "Use fixed filters for repeatable comparisons.",
              "Use chart mode in chat when you need a custom visualization.",
            ],
          },
          {
            id: "interpreting-results",
            title: "Interpreting dashboard results",
            body: [
              "Dashboard charts are only as complete as the analyzed data. Failed, queued, or processing files do not contribute complete topic and keyword rows. Unknown year values can reduce timeline usefulness.",
            ],
            callout: {
              tone: "info",
              title: "Dashboard is analysis-backed",
              body:
                "If a paper can be opened in the library but has failed analysis, it may not appear in topic, keyword, or timeline charts until it is reanalyzed successfully.",
            },
          },
        ],
        related: ["paper-analysis", "ai-research-chat", "evaluation-quality"],
      },
      {
        slug: "ai-research-chat",
        title: "AI research chat",
        description:
          "Use attached-paper context, web search, chart mode, and flexible research conversation in one chat surface.",
        tags: ["chat", "ai", "attachments", "web search", "chart mode", "citations", "conversation"],
        popular: true,
        sections: [
          {
            id: "chat-purpose",
            title: "What chat is for",
            body: [
              "Papertrend chat is a research interface over the current conversation, attached files, and available workspace data. It should answer normal questions, explain papers, compare papers, create charts, and use web search when the user asks for current or external information.",
              "The chat is intentionally session-focused. If a user attaches a paper and says this paper, the assistant should prioritize that paper. If the user asks across the workspace, project, or folder, the assistant should broaden scope.",
            ],
            bullets: [
              "Ask summaries, critiques, comparisons, and research questions.",
              "Attach library files or uploaded files to ground the answer.",
              "Use web search for external or current information.",
              "Use chart mode for visualizations from analyzed data.",
            ],
          },
          {
            id: "attachments",
            title: "Attachments",
            body: [
              "Attachments tell chat which files matter for the current request. If an attached library file is already analyzed, chat can use saved analysis outputs. If the file is not analyzed or previously failed, the app should guide the user toward analysis or retry before charting.",
            ],
            callout: {
              tone: "warning",
              title: "Attached does not always mean analyzed",
              body:
                "A file can be attached from the library while still being failed, queued, or processing. For charts and dashboard-like answers, succeeded analysis data is required.",
            },
          },
          {
            id: "web-search",
            title: "Web search",
            body: [
              "Web search is for questions that need outside sources, recent information, or citation links beyond the user's library. Search results should include citations so users can inspect the source trail.",
              "Use web search when asking about current events, external publications, missing bibliographic context, or comparison against the wider research field.",
            ],
            checklist: [
              "Ask for web search explicitly when you want outside sources.",
              "Check citation links before reusing claims.",
              "Prefer library-grounded answers when the question is about uploaded papers.",
            ],
          },
          {
            id: "chart-mode",
            title: "Chart mode",
            body: [
              "Chart mode lets users ask naturally for visualizations. The assistant plans a chart from the prompt and available data. If the user asks for multiple charts, the assistant should return multiple chart objects and explain the main pattern by default unless the user asks for another style of response.",
            ],
            bullets: [
              "Top topic chart for this paper.",
              "Top keyword chart and explain the main pattern.",
              "Year trend across the workspace.",
              "Track distribution for all analyzed papers.",
              "Compare two attached papers by keyword emphasis.",
            ],
          },
        ],
        related: ["deep-research-agent", "evaluation-quality", "troubleshooting"],
      },
      {
        slug: "deep-research-agent",
        title: "Deep research agent",
        description:
          "Use the multi-step research mode for planning, corpus inspection, synthesis, and longer reports.",
        tags: ["deep research", "agent", "plan", "report", "langgraph", "research synthesis"],
        popular: true,
        sections: [
          {
            id: "agent-purpose",
            title: "What deep research is for",
            body: [
              "Deep research is for questions that need more than one answer turn. It is best for multi-paper synthesis, research gap exploration, structured comparison, and report-style output.",
              "Instead of producing a quick response immediately, the system can plan steps, inspect available corpus evidence, wait for needed analysis, and synthesize a final answer.",
            ],
            bullets: [
              "Generate a research plan.",
              "Inspect multiple papers or workspace signals.",
              "Identify recurring themes and gaps.",
              "Produce a final report with reasoning and source context.",
            ],
          },
          {
            id: "agent-logic",
            title: "How the agent works",
            body: [
              "The agent follows a graph-style workflow. It creates or updates a research session, tracks steps, decides whether more analysis is needed, runs retrieval or analysis actions, and produces a final report when enough evidence is available.",
              "This graph approach makes state visible and resumable. It is designed to avoid losing progress when a longer research task cannot finish in one immediate chat response.",
            ],
            callout: {
              tone: "info",
              title: "Technical note",
              body:
                "Internally, deep research should behave like a stateful graph: plan, wait if analysis is missing, process evidence, synthesize, and persist the report.",
            },
          },
          {
            id: "good-prompts",
            title: "Good deep research prompts",
            body: [
              "Use deep research when you want the assistant to reason across a collection, not just answer from one sentence. Include the scope and the output style you want.",
            ],
            bullets: [
              "Find research gaps across my analyzed papers about digital learning.",
              "Compare these three attached papers and propose a literature review structure.",
              "Create a research brief on the main trends in this workspace.",
              "Evaluate whether this corpus is balanced across methods and years.",
            ],
          },
          {
            id: "expectations",
            title: "Expectations and limits",
            body: [
              "Deep research is powerful, but it still depends on available analyzed data. If papers are missing, failed, or not yet analyzed, the agent should explain what is missing or wait for analysis where the product supports it.",
            ],
            checklist: [
              "Use analyzed papers for best results.",
              "Expect longer latency than normal chat.",
              "Review cited evidence before treating a report as final.",
              "Use retry or reanalysis when the agent says data is missing.",
            ],
          },
        ],
        related: ["ai-research-chat", "cloud-queue", "evaluation-quality"],
      },
      {
        slug: "cloud-queue",
        title: "Cloud queue and multi-paper processing",
        description:
          "Understand queued analysis, Cloud Tasks continuation, worker locks, retries, stale runs, and status visibility.",
        tags: ["cloud queue", "cloud tasks", "worker", "queue", "retry", "stuck", "processing", "multi paper"],
        sections: [
          {
            id: "why-queue",
            title: "Why Papertrend uses a queue",
            body: [
              "PDF analysis can take longer than a normal web request. Papertrend separates upload from processing so users can queue multiple papers without keeping a single request open for the entire analysis.",
              "The queue also makes retry and recovery possible. If one file fails, it should not permanently block the rest of the workspace from processing.",
            ],
            bullets: [
              "Uploads create queued ingestion runs.",
              "Workers claim queued runs one at a time or according to configured limits.",
              "Cloud Tasks can trigger the next processing request automatically.",
              "Heartbeat and stale-run settings help identify stuck processing.",
            ],
          },
          {
            id: "status-lifecycle",
            title: "Status lifecycle",
            body: [
              "A normal run moves from queued to processing to succeeded. If extraction, model output, storage, or persistence fails, the run can move to failed with an error message.",
            ],
            steps: [
              "File enters the queue.",
              "Worker claims the run.",
              "Worker downloads the file.",
              "Pipeline extracts and analyzes the paper.",
              "Results persist to Supabase tables.",
              "Run completes and the next queued paper can be triggered.",
            ],
          },
          {
            id: "stuck-runs",
            title: "Stuck runs",
            body: [
              "A run can look stuck if the PDF needs OCR, a model call is slow, a network request is retrying, or a worker loses its heartbeat. Stale-processing recovery is designed to avoid leaving runs stuck forever.",
            ],
            checklist: [
              "Check whether the worker is still logging progress.",
              "Check whether the file is using OCR fallback.",
              "Check whether the run exceeded the stale-processing threshold.",
              "Retry or recover only after confirming the worker is not still active.",
            ],
            callout: {
              tone: "warning",
              title: "Do not assume slow means broken",
              body:
                "Scanned PDFs and long model calls can look quiet for a while. Use status, logs, and heartbeat behavior together before deciding a run is stuck.",
            },
          },
          {
            id: "user-actions",
            title: "What users can do",
            body: [
              "Most users should not need to understand worker internals. They should watch status, retry failed files, and use the needs-attention surfaces when the app exposes them.",
            ],
            bullets: [
              "Retry failed files from Library or analysis status surfaces.",
              "Reupload a corrupted or inaccessible PDF.",
              "Use smaller batches when validating a new collection.",
              "Open Troubleshooting when the queue does not start the next file.",
            ],
          },
        ],
        related: ["library-uploads", "troubleshooting", "paper-analysis"],
      },
    ],
  },
  {
    id: "trust",
    label: "Quality and troubleshooting",
    description: "Evaluate outputs, understand limits, and recover from common problems.",
    pages: [
      {
        slug: "evaluation-quality",
        title: "Evaluation and quality guide",
        description:
          "Evaluate year detection, keyword quality, topic grouping, chart trust, chat answers, and when to reanalyze.",
        tags: ["evaluation", "quality", "confidence", "year confidence", "keyword quality", "chart trust", "reanalyze"],
        popular: true,
        sections: [
          {
            id: "evaluation-mindset",
            title: "Evaluation mindset",
            body: [
              "Papertrend accelerates research review, but users should still evaluate outputs before using them in claims. Treat extracted signals as structured research aids with evidence, not as final truth.",
              "The right evaluation question is not only did the AI answer, but what evidence supports this output and how complete is the underlying analyzed data.",
            ],
          },
          {
            id: "year-quality",
            title: "Year quality",
            body: [
              "A year is high quality when the extracted value is supported by credible evidence such as publication metadata, title-page context, journal/conference information, or a clear citation field.",
              "Unknown or low-confidence year values should be excluded from serious timeline analysis until reviewed.",
            ],
            checklist: [
              "Year evidence mentions a publication-like context.",
              "The year is not only from a reference list citation.",
              "The title and source file match the paper being evaluated.",
              "The year is plausible for the corpus and not a random date in the body.",
            ],
          },
          {
            id: "keyword-topic-quality",
            title: "Keyword and topic quality",
            body: [
              "Good keywords represent meaningful concepts in the paper. Good topics group related keywords without becoming too broad or too narrow.",
              "Watch for keywords that are citation artifacts, names from references, generic research words, or OCR noise. These are signals that the paper may need review or prompt improvement.",
            ],
            bullets: [
              "Strong keyword: appears in the abstract, method, result, or conclusion context.",
              "Weak keyword: appears only in a reference or isolated citation.",
              "Strong topic: explains a set of related terms.",
              "Weak topic: duplicates a single keyword or hides unrelated terms together.",
            ],
          },
          {
            id: "chart-quality",
            title: "Chart quality",
            body: [
              "A chart is trustworthy when the data scope is clear, the included papers are analyzed, and the metric matches the user question. A chart can be technically valid but still misleading if the scope is wrong.",
            ],
            checklist: [
              "Confirm whether the chart uses attached files, a folder, a project, or the workspace.",
              "Check that failed or queued papers are not expected to contribute structured rows.",
              "Use top-N charts for ranking and line charts for time movement.",
              "Ask for an explanation when the chart pattern is not obvious.",
            ],
          },
          {
            id: "chat-quality",
            title: "Chat answer quality",
            body: [
              "Good chat answers state scope, cite sources when web search is used, and distinguish paper-grounded claims from interpretation. If the answer needs exact evidence, ask the assistant to quote or point to the supporting section rather than relying on broad summary.",
            ],
            callout: {
              tone: "info",
              title: "When to reanalyze",
              body:
                "Reanalyze when the file failed, the extracted text is incomplete, year evidence is missing but visible in the PDF, or keywords/topics clearly come from the wrong sections.",
            },
          },
        ],
        related: ["paper-analysis", "ai-research-chat", "research-dashboard"],
      },
      {
        slug: "troubleshooting",
        title: "Troubleshooting",
        description:
          "Fix common issues with login, missing dashboard data, failed files, stuck queue runs, unknown years, and chart no-data responses.",
        tags: ["troubleshooting", "login", "missing data", "failed", "queue stuck", "unknown year", "chart no data"],
        popular: true,
        sections: [
          {
            id: "login-session",
            title: "Login or session issues",
            body: [
              "If workspace pages stop updating or API requests return unauthorized, the browser session may be stale. Refreshing after reauthenticating is usually safer than continuing to click through a half-authenticated state.",
            ],
            checklist: [
              "Confirm you are signed in.",
              "Refresh the page after a long idle period.",
              "Return to Workspaces and reopen the project.",
              "If API requests continue returning unauthorized, sign out and sign in again.",
            ],
          },
          {
            id: "missing-dashboard-data",
            title: "Dashboard shows missing data",
            body: [
              "Dashboard data comes from succeeded analysis outputs. If the library has files but the dashboard has low counts, check whether those files succeeded and whether the current scope includes them.",
            ],
            steps: [
              "Open Library and check file statuses.",
              "Switch to all folders if the current folder is narrow.",
              "Confirm the selected workspace and project.",
              "Open a succeeded paper detail panel to confirm topics and keywords exist.",
              "Retry failed files before expecting them in dashboard charts.",
            ],
          },
          {
            id: "chart-no-data",
            title: "Chart says no analyzed data found",
            body: [
              "This usually means the requested scope has no succeeded analysis rows that match the chart. It can happen when a user attaches a failed file, asks about a queued file, or requests a metric the paper does not have.",
            ],
            bullets: [
              "If using an attached paper, confirm it succeeded in Library.",
              "If using workspace scope, confirm at least one paper has relevant rows.",
              "If asking for a year chart, confirm papers have known years.",
              "If asking for topics or keywords, confirm paper_keywords or concepts exist for the paper.",
            ],
          },
          {
            id: "queue-not-starting",
            title: "Queue does not start the next paper",
            body: [
              "A queue continuation issue can be caused by a missing trigger, active lock, stale processing run, failed worker request, or Cloud Task retry delay. Users should check visible status first and retry from the UI if available.",
            ],
            checklist: [
              "Wait long enough for Cloud Tasks retry delay if the worker recently returned busy.",
              "Check whether a previous paper is still processing.",
              "Retry failed or stale runs from available UI controls.",
              "Reupload files that consistently fail before analysis starts.",
            ],
          },
          {
            id: "unknown-year",
            title: "Paper year is unknown",
            body: [
              "Unknown year means Papertrend did not find reliable enough evidence in extracted text or metadata. This is often better than guessing. If the year is clearly visible in the PDF, extraction may have missed it and reanalysis may help.",
            ],
            callout: {
              tone: "success",
              title: "Safe default",
              body:
                "For timeline work, it is safer to keep a paper as unknown than to silently assign a weak year. Review year evidence before using the paper in year-based conclusions.",
            },
          },
        ],
        related: ["evaluation-quality", "cloud-queue", "library-uploads"],
      },
    ],
  },
];

export const docsCategories: DocsCategory[] = rawDocsCategories.map((category) => ({
  ...category,
  pages: category.pages.map((page) => ({
    ...page,
    categoryId: category.id,
    categoryLabel: category.label,
  })),
}));

export const docsPages: DocsPage[] = docsCategories.flatMap((category) => category.pages);

export const popularDocsPages = docsPages.filter((page) => page.popular);

export function getDocsPage(slug: string) {
  return docsPages.find((page) => page.slug === slug) ?? null;
}

export function getRelatedDocs(page: DocsPage) {
  return (page.related ?? [])
    .map((slug) => getDocsPage(slug))
    .filter((related): related is DocsPage => Boolean(related));
}

export const docsSearchItems: DocsSearchItem[] = docsPages.flatMap((page) => {
  const pageText = [
    page.title,
    page.description,
    page.categoryLabel,
    page.tags.join(" "),
    page.sections
      .map((section) =>
        [
          section.title,
          section.body.join(" "),
          section.bullets?.join(" ") ?? "",
          section.steps?.join(" ") ?? "",
          section.checklist?.join(" ") ?? "",
          section.callout ? `${section.callout.title} ${section.callout.body}` : "",
        ].join(" ")
      )
      .join(" "),
  ].join(" ");

  return [
    {
      id: `page:${page.slug}`,
      title: page.title,
      description: page.description,
      href: `/docs/${page.slug}`,
      category: page.categoryLabel,
      tags: page.tags,
      searchText: pageText,
      pageSlug: page.slug,
    },
    ...page.sections.map((section) => ({
      id: `section:${page.slug}:${section.id}`,
      title: section.title,
      description: page.title,
      href: `/docs/${page.slug}#${section.id}`,
      category: page.categoryLabel,
      tags: page.tags,
      searchText: [
        page.title,
        page.description,
        section.title,
        section.body.join(" "),
        section.bullets?.join(" ") ?? "",
        section.steps?.join(" ") ?? "",
        section.checklist?.join(" ") ?? "",
        section.callout ? `${section.callout.title} ${section.callout.body}` : "",
      ].join(" "),
      pageSlug: page.slug,
      sectionId: section.id,
    })),
  ];
});

export const docsSuggestedQueries = [
  "upload paper",
  "failed paper",
  "chart mode",
  "deep research",
  "queue stuck",
  "unknown year",
  "dashboard filters",
  "google drive",
];
