import type { DocsPageBase } from "./types";

export const tablePage: DocsPageBase = {
  slug: "table",
  title: "Table",
  description:
    "Lay a repository's studies out against columns you choose from over sixty ready-made ones or write yourself, each value with the paper's own sentence, downloaded as CSV, Excel or an image.",
  tags: ["table", "extraction", "columns", "compare papers", "csv", "excel", "xlsx", "png", "literature review"],
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
        "The table opens with the studies down the side and fills in as the papers are read, a few papers at a time. **Stop** keeps what was read; **Fill table** reads the rest. A long table scrolls inside its frame, with the column names and the papers kept in view.",
        "**Columns** lists every ready-made column by group (study design, participants, setting, intervention, data and analysis, results, publication) with a search. Tick to show a column, clear to hide it, then **Apply**. A column shown for the first time is read straight away.",
        "**Add column** adds a column of your own: a name, what to read from each paper (said as you would to a research assistant), and whether the answer is words, a short label or a number. It is read straight away.",
      ],
      bullets: [
        "Hiding a column keeps what was read for it, so showing it again reads nothing and costs nothing.",
        "A table holds up to 80 columns and 120 studies (the newest, when the repository has more); a repository holds up to 30 tables.",
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
          ["Not stated", "The paper does not say. A long paper is first read in the passages that bear on the columns; before a cell says this, the whole paper is read again for it."],
          ["Not confirmed", "An answer was given, but its sentence is not in the paper, or a number is not in its sentence, so it is not shown."],
          ["Not read yet", "The reading of that paper failed; **Fill table** reads it again."],
        ],
      },
      bullets: [
        "**Read again** appears when cells say Not stated or Not confirmed from only part of a paper, as cells read before the second look do. It reads each of them from the whole paper; a value already found is kept. To read one column again, select the pencil by its name.",
        "In a short-label column, a label written in different ways (Mixed methods, Mixed-methods) is shown one way, the way most papers' cells have it.",
      ],
      callout: {
        tone: "info",
        title: "A number is checked twice",
        body: "In a column marked as a number, the value must be printed in the sentence it comes with, so a sample size is never worked out or estimated.",
      },
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
          ["Image (.png)", "The table as a picture, for a slide or a report, with the date it was made."],
        ],
      },
    },
    {
      id: "usage",
      title: "Daily allowance",
      body: [
        "Filling a table reads the papers with the same model as Chat (GPT-6 Luna) and counts against the same daily allowance as Chat; so does **Read again**. A table of 40 papers and 5 columns uses about as much as a few chat answers. Making a table, opening it and downloading it use none.",
      ],
    },
  ],
};
