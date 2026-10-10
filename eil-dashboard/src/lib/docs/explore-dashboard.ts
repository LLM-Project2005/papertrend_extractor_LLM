import type { DocsPageBase } from "./types";

export const dashboardPage: DocsPageBase = {
  slug: "dashboard",
  title: "The dashboard",
  description:
    "Four views of one repository: the semantic map, Area Analysis, the Keyword Explorer and the Adaptive insights; how themes are formed, and how filters and Refresh work.",
  tags: ["dashboard", "charts", "themes", "filters", "semantic map", "adaptive", "trends"],
  popular: true,
  related: ["analysis-pipeline", "analysis-profiles", "chat"],
  sections: [
    {
      id: "overview",
      title: "One repository at a time",
      body: [
        "The **Dashboard** charts the repository you have open, and only that one. Each view opens with a sentence that says what the chart shows in numbers, written from the data rather than by a model, so you can read the finding before the picture.",
        "Four tabs sit under the header: **Semantic Map**, which the dashboard opens on, **Area Analysis**, **Keyword Explorer** and **Adaptive**. The tab is kept in the address, so a link such as `/workspace/dashboard?tab=area_analysis` opens that view; an older link to Overview, Trend Analysis or Category Analysis opens the tab that replaced it.",
      ],
      figure: {
        shot: "dashboard-trends",
        alt: "Area Analysis: a summary sentence, then themes by year as stacked bars from 2011 to 2025.",
      },
    },
    {
      id: "filters",
      title: "Search and filters",
      body: [
        "The search box finds papers by title, year, theme, keyword, evidence text or research area. It filters whole papers: when a paper matches, all of its rows stay in the charts. **Filters** opens year and research area chips (research areas only when the repository uses them).",
      ],
      bullets: [
        "While every year is selected, clicking one year selects only that year; later clicks add or remove years. Removing the last one returns to all years. **Show all** resets.",
        "Filters apply to Area Analysis, Keyword Explorer and Adaptive, which works its insights out again for every change. The Semantic Map always shows the whole repository.",
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
        "Themes are formed by an AI model that reads each topic's label and keywords. It groups by what is studied, not by shared words: two topics that both mention \"assessment\" or \"Thai\" are not grouped for that alone. Three separate groupings are made and only merges most of them agree on are kept. Method topics form method themes, kept apart from the themes of what is studied. Phrases that only name a group of people, such as \"Thai EFL learners\", are left out.",
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
      id: "trend-analysis",
      title: "Area Analysis: themes over time",
      body: [
        "**Area Analysis** puts the field's movement and its research areas on one tab: first how the themes moved over the years, then how the research areas compare.",
        "**Themes by year** stacks the papers in each theme shared by two or more papers, year by year. The slider shows between 3 and 15 themes. Every year in the range has a slot, so a year without papers shows as a gap rather than disappearing.",
        "**Gaining and losing ground** splits the dated papers in half by year and compares the two periods. A theme is shown only when it has at least 3 papers, differs by at least one paper from what the period sizes alone predict, and would still lean the same way if any single paper were removed. When no theme qualifies, the tab says so, which is a finding in itself: the themes are holding steady.",
      ],
      callout: {
        tone: "info",
        title: "Click to see the papers",
        body: "Clicking a bar or a theme opens the drilldown: the papers behind that number (see below).",
      },
    },
    {
      id: "category-analysis",
      title: "Area Analysis: research areas",
      body: [
        "The second half of Area Analysis, when the repository uses research areas. **Papers per research area per year** stacks primary research areas over the years; **Research area co-occurrence** shows how often research areas appear together on one paper; **Top topics per research area** lists the largest themes within each research area. In a General Research repository this view explains how to turn research areas on.",
      ],
      figure: {
        shot: "dashboard-categories",
        alt: "The Research areas view: papers per research area per year, stacked by the three EIL research areas.",
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
        "Clicking a chart element opens a window listing the papers behind it, within your current filters: each with its year, research areas, its own topic labels (and the theme each was grouped under), keywords and the matching evidence. **Open paper** opens the paper over this list, so closing it brings you back here. Heatmaps cannot be clicked; in the Adaptive tab, a bar, a cell or a name lists the papers behind it.",
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
            "Each paper's title, year, research areas, topics, keywords and main sections are turned into an embedding. Neighborhoods are found from those embeddings and labeled with their most frequent terms. Lines join papers that are among each other's closest neighbors; thicker lines mean closer.",
            "Distance shows similarity of content only. It does not mean one paper cites another, agrees with it, or is better.",
          ],
        },
        {
          title: "What you can do",
          bullets: [
            "Search to dim papers that do not match; color by neighborhood, research area, year or track.",
            "The map opens as the **Free graph**: drag papers around, and positions settle from the links between them, so distance there does not show similarity. Switch to **Fixed projection** to read similarity from distance. Hide papers from view without rebuilding the map.",
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
        "Patterns in the selected papers that no other tab shows, each with the numbers behind it: which themes are studied together, which methods are used for which themes, which methods and research areas are gaining or losing ground, what sets each research area apart, which themes are new or have faded, whether the range of topics is broadening, what the studies set out to produce and what kinds of study they are.",
        "A pattern is shown only when at least 3 papers are behind it and it holds with any one of them removed. A paper uploaded twice is counted once. The tab works this out as soon as it opens, for your current filters, without AI.",
      ],
      bullets: [
        "**Write up with AI** has a model choose the strongest insights, order them and word them. It can only use the numbers computed here: any sentence with a number that does not match is replaced by the computed one. The write-up is kept for these filters until the papers change; **Rewrite with AI** makes a new one.",
        "**Ask about these papers** turns a question such as \"Which methods are used for which themes?\" into a view of the data. The answer's numbers and sentence are computed, not written by the model; questions the data cannot answer, such as about authors or citations, are declined.",
        "Each write-up and each question counts toward the daily limit of 100.",
        "**The papers behind this** under any insight lists them; so does clicking a bar, a cell or a name.",
      ],
    },
    {
      id: "undated-papers",
      title: "Papers without a year",
      body: [
        "A paper whose year could not be read is never drawn as a year of its own, because a missing year is not a period. Most charts say how many papers they leave out for this reason; the **Papers per research area per year** chart and the concept search's timeline leave them out without a note. Correct the year in the paper explorer and the paper takes its place.",
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
        "A paper moved to Trash leaves every chart.",
      ],
    },
  ],
};
