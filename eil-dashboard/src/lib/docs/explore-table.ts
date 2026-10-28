import type { DocsPageBase } from "./types";

export const tablePage: DocsPageBase = {
  slug: "table",
  title: "Table",
  description:
    "Lay a repository's studies out against columns you choose from over forty ready-made ones or write yourself, each value with the paper's own sentence, with a chart above and downloads as CSV, Excel or an image.",
  tags: ["table", "extraction", "columns", "compare papers", "csv", "excel", "xlsx", "png", "chart", "literature review"],
  related: ["chat", "dashboard"],
  sections: [
    {
      id: "overview",
      title: "What a table is",
      body: [
        "**Table** in the side navigation lays out the studies in the open repository: one row for each study, one column for each thing you want from it. Every paper is read for every column, and a value is kept only when the paper's own sentence says it.",
        "A paper uploaded twice is one row. The rows are the repository's analysed papers when the table is opened, so a paper added later appears with empty cells, ready to fill.",
      ],
    },
    {
      id: "make",
      title: "Making and filling a table",
      body: ["A new table starts from a set of common columns and reads every paper for them. After that you choose which columns to show, as in an analytics dashboard."],
      steps: [
        "Open **Table** and choose **New table**.",
        "Name it, choose what to start with (**Study overview**, **Methods**, **Intervention studies**, **Results and implications**, or **Empty**) and choose **Make and read**.",
        "The table opens with the studies down the side and fills in as the papers are read, a few papers at a time. **Stop** keeps what was read; **Fill table** reads the rest.",
        "**Columns** lists every ready-made column by group (study design, participants, setting, intervention, data and analysis, results, publication) with a search. Tick to show a column, clear to hide it, then **Apply**. A column shown for the first time is read straight away.",
        "**Add column** adds a column of your own: a name, what to read from each paper (said as you would to a research assistant), and whether the answer is words, a short label or a number. It is read straight away.",
      ],
      bullets: [
        "Hiding a column keeps what was read for it, so showing it again reads nothing and costs nothing.",
        "A table holds up to 64 columns and the first 120 studies; a repository holds up to 30 tables.",
        "Renaming a column keeps its values. Changing what it reads, or its kind, clears it to be read again.",
        "Tables are saved with the repository and only you can see yours.",
      ],
    },
    {
      id: "cells",
      title: "What each cell says",
      body: ["Each cell is one of four things, so an empty cell never hides a guess."],
      table: {
        columns: ["The cell shows", "What it means"],
        rows: [
          ["A value", "The paper states it, and its sentence was found in the paper. Select the value to see the sentence; **Show in paper** opens the PDF with it marked."],
          ["Not stated", "The paper, as read, does not say."],
          ["Not confirmed", "An answer was given, but its sentence is not in the paper, or a number is not in its sentence, so it is not shown."],
          ["Not read yet", "The reading of that paper failed; **Fill table** reads it again."],
        ],
      },
      callout: {
        tone: "info",
        title: "A number is checked twice",
        body: "In a column marked as a number, the value must be printed in the sentence it comes with, so a sample size is never worked out or estimated.",
      },
    },
    {
      id: "chart",
      title: "The chart above the table",
      body: [
        "The chart shows what you choose from **Chart**. Every figure in it is counted from the table's cells, never written by an AI model.",
      ],
      bullets: [
        "**What was found**: for each column shown, how many studies have a value.",
        "A number column (such as **Sample size** or **Number of sessions**): each study's figure, largest first, with the total, median and range. Point at a bar to see the study.",
        "A short-label column (such as **Country**, **Research design** or **Methodology**): how many studies give each answer, with capitals ignored.",
      ],
    },
    {
      id: "download",
      title: "Downloading",
      body: ["**Download** saves the columns shown, in the format you choose:"],
      table: {
        columns: ["Format", "What it holds"],
        rows: [
          ["CSV", "For each column, the value and then the paper's sentence for it. Opens in any spreadsheet or tool, with Thai titles intact."],
          ["Excel (.xlsx)", "Two sheets: **Table**, as on screen, with number columns as numbers a spreadsheet can add up; and **Sources**, one line per cell with its value, note, the paper's sentence and whether it was found."],
          ["Image (.png)", "The chart and the table as a picture, for a slide or a report, with the date it was made."],
        ],
      },
    },
    {
      id: "usage",
      title: "Daily allowance",
      body: [
        "Filling a table reads the papers with the same model as Chat (GPT-6 Luna) and counts against the same daily allowance as Chat. A table of 40 papers and 5 columns uses about as much as a few chat answers. Making a table, opening it and downloading it use none.",
      ],
    },
  ],
};
