import type { DocsPageBase } from "./types";

export const dashboardPage: DocsPageBase = {
  slug: "dashboard",
  title: "The dashboard",
  description:
    "Six views of one repository: what each chart shows, how themes are formed, how filters and Refresh work, the semantic map and the AI-planned Adaptive charts.",
  tags: ["dashboard", "charts", "themes", "filters", "semantic map", "adaptive", "trends"],
  popular: true,
  related: ["analysis-pipeline", "analysis-profiles", "chat"],
  sections: [
    {
      id: "overview",
      title: "One repository at a time",
      body: [
        "The **Dashboard** charts the repository you have open, and only that one. Each view opens with a sentence that says what the chart shows in numbers, written from the data rather than by a model, so you can read the finding before the picture.",
        "Six tabs sit under the header: **Overview**, **Trend Analysis**, **Category Analysis**, **Keyword Explorer**, **Semantic Map** and **Adaptive**. The tab is kept in the address, so a link such as `/workspace/dashboard?tab=trend_analysis` opens that view.",
      ],
      figure: {
        shot: "dashboard-trends",
        alt: "The Trend Analysis tab: a summary sentence, then themes by year as stacked bars from 2011 to 2025.",
      },
    },
    {
      id: "filters",
      title: "Search and filters",
      body: [
        "The search box finds papers by title, year, theme, keyword, evidence text or category. It filters whole papers: when a paper matches, all of its rows stay in the charts. **Filters** opens year and category chips (categories only when the repository uses them).",
      ],
      bullets: [
        "While every year is selected, clicking one year selects only that year; later clicks add or remove years. Removing the last one returns to all years. **Show all** resets.",
        "Filters apply to Overview, Trend Analysis, Category Analysis and Keyword Explorer, and to the Adaptive tab when you generate charts. The Semantic Map always shows the whole repository.",
        "Your filters are remembered in this browser for each repository separately, and restored when you come back.",
        "Papers without a readable year appear under an **Unknown** year chip.",
      ],
    },
    {
      id: "refresh",
      title: "Refresh, and when new papers appear",
      body: [
        "The dashboard does not reload by itself. A newly analyzed paper appears the next time the dashboard loads, or straight away when you press **Refresh**, which reads the repository fresh. Moving between tabs reuses what is already loaded.",
      ],
    },
    {
      id: "themes",
      title: "Themes: how topics are grouped",
      body: [
        "Each paper names its own topics, so two papers can call the same subject by different names. The dashboard gathers topics that share a research focus into **themes**, and every chart counts papers per theme. The drilldown still shows each paper's own label under its theme.",
        "Themes are formed by an AI model that reads each topic's label and keywords. It groups by what is studied, not by shared words: two topics that both mention \"assessment\" or \"Thai\" are not grouped for that alone. Three separate groupings are made and only merges most of them agree on are kept. Method topics form method themes, shown apart under **How these studies were done**. Phrases that only name a group of people, such as \"Thai EFL learners\", are left out.",
      ],
      subsections: [
        {
          title: "When grouping happens",
          body: [
            "Grouping runs when the Dashboard, Home or Chat opens and finds topics that are not yet grouped. New topics are filed under the existing themes. When a repository grows by a quarter or more, or many new topics arrive at once, the whole repository is grouped again and themes can reshuffle.",
            "While it runs, a notice says `Grouping <n> new topics into themes`; the charts update when it finishes, usually within a minute. If it cannot run, the new topics are shown under their papers' own labels and it is tried again later.",
          ],
        },
      ],
    },
    {
      id: "overview-tab",
      title: "Overview",
      body: ["The repository at a glance, from top to bottom:"],
      bullets: [
        "A summary: how many papers, the years they span, the busiest year, the largest themes and how many themes two or more papers share.",
        "A notice when papers look like second copies of each other (their titles nearly match), with **Show which** and links to open each one in the Library.",
        "Four figures: **Papers**, **Shared themes** (themes in two or more papers), **Keywords** and **Years covered**.",
        "**What this repository studies**: the ten largest themes by number of papers.",
        "**Papers published per year**, with every year in the range shown, empty years included. A note counts papers without a readable year.",
        "**Category distribution** and **Category overlap** (primary categories, and all categories including secondary ones), when the repository uses categories.",
        "**How these studies were done**: the method themes.",
      ],
      callout: {
        tone: "info",
        title: "Click to see the papers",
        body: "Clicking a bar, a slice or a theme opens the drilldown: the papers behind that number (see below).",
      },
    },
    {
      id: "trend-analysis",
      title: "Trend Analysis",
      body: [
        "**Themes by year** stacks the papers in each theme shared by two or more papers, year by year. The slider shows between 3 and 15 themes. Every year in the range has a slot, so a year without papers shows as a gap rather than disappearing.",
        "**Gaining and losing ground** splits the dated papers in half by year and compares the two periods. A theme is shown only when it has at least 3 papers, differs by at least one paper from what the period sizes alone predict, and would still lean the same way if any single paper were removed. When no theme qualifies, the tab says so, which is a finding in itself: the themes are holding steady.",
      ],
    },
    {
      id: "category-analysis",
      title: "Category Analysis",
      body: [
        "Available when the repository uses categories. **Papers per category per year** stacks primary categories over the years; **Category co-occurrence** shows how often categories appear together on one paper; **Top topics per category** lists the largest themes within each category. In a General Research repository this tab explains how to turn categories on.",
      ],
      figure: {
        shot: "dashboard-categories",
        alt: "The Category Analysis tab: papers per category per year, stacked by the three EIL categories.",
      },
    },
    {
      id: "keyword-explorer",
      title: "Keyword Explorer",
      body: [
        "The concept search at the top follows one idea through the repository: type a concept in English or Thai and it shows where it first appears, how it has grown over the years, which themes move with it, supporting evidence and the related papers. It matches text as written (it does not translate), and it uses no AI allowance.",
      ],
      bullets: [
        "**Keywords used by the most papers**: ranked by how many papers use a keyword, not how often one paper repeats it.",
        "**Themes across years**: a heatmap of the 15 largest themes.",
        "**Theme sizes**: every theme as a rectangle sized by its papers.",
        "**Themes and what they gather**: each theme with the topic labels and keywords its papers use.",
        "**Compare themes over time**: pick themes to compare their papers per year.",
      ],
      figure: {
        shot: "dashboard-keywords",
        alt: "The Keyword Explorer tab with its summary and keyword rankings.",
      },
    },
    {
      id: "drilldown",
      title: "The drilldown",
      body: [
        "Clicking a chart element opens a window listing the papers behind it, within your current filters: each with its year, categories, its own topic labels (and the theme each was grouped under), keywords and the matching evidence. **Open paper** opens it in the Library. Heatmaps and the Adaptive charts cannot be clicked.",
      ],
    },
    {
      id: "semantic-map",
      title: "Semantic Map",
      body: [
        "A map of how the papers relate by what they say. Each dot is a paper; papers with similar text sit close together, and colors mark neighborhoods of related papers. The map is built only when you ask for it: **Generate semantic map**, and later **Update map** when the badge says **Map out of date**.",
      ],
      subsections: [
        {
          title: "How to read it",
          body: [
            "Each paper's title, year, categories, topics, keywords and main sections are turned into an embedding. Neighborhoods are found from those embeddings and labeled with their most frequent terms. Lines join papers that are among each other's closest neighbors; thicker lines mean closer.",
            "Distance shows similarity of content only. It does not mean one paper cites another, agrees with it, or is better.",
          ],
        },
        {
          title: "What you can do",
          bullets: [
            "Search to dim papers that do not match; color by neighborhood, category, year or track.",
            "Hide papers from view without rebuilding the map, or switch from **Fixed projection** to **Free graph** and drag papers around. In the free graph, positions come from the links and your dragging, so distance no longer shows similarity.",
            "Selecting a paper brings it to the front and fades the rest, so its neighbourhood is easy to read.",
            "Select a paper to open its analysis, or select two or more and choose **Compare** or **Ask about papers** to continue in Chat with them attached.",
          ],
          body: [],
        },
      ],
    },
    {
      id: "adaptive",
      title: "Adaptive",
      body: [
        "An AI planner picks up to five charts that the current data can honestly support, from seven kinds (publication volume, top topics, papers by category, topics that changed, largest shifts, when keyword families appear, and how categories differ by topic), and writes a reason for each. **Generate charts** builds them for your current filters; after a filter change, **Update charts**.",
      ],
      bullets: [
        "If the planner fails or picks nothing the data supports, a conservative **Safe fallback** set is shown instead.",
        "Adaptive charts are not saved: they stay while you switch tabs, and are gone when you leave the page.",
        "Each generation counts toward a daily limit of 100 chart plans.",
      ],
    },
    {
      id: "undated-papers",
      title: "Papers without a year",
      body: [
        "A paper whose year could not be read is never drawn as a year of its own, because a missing year is not a period. Most charts say how many papers they leave out for this reason; the category-by-year chart and the concept search's timeline leave them out without a note. Correct the year in the paper explorer and the paper takes its place.",
      ],
    },
    {
      id: "good-to-know",
      title: "Good to know",
      body: [],
      table: {
        columns: ["View", "Needs at least"],
        rows: [
          ["Themes by year", "A theme in two or more papers"],
          ["Gaining and losing ground", "Two dated years, and themes with three or more papers"],
          ["Keyword ranking", "Keywords used by two or more papers"],
          ["Semantic map", "One analyzed paper; neighborhoods need five"],
        ],
      },
      bullets: [
        "There is no export or download on the dashboard yet.",
        "A paper moved to Trash leaves every chart.",
      ],
    },
  ],
};
