import type { DocsPageBase } from "./types";

export const tablePage: DocsPageBase = {
  slug: "table",
  title: "Table",
  description:
    "Lay a repository's studies out against columns you choose from over sixty ready-made ones or write yourself, each value with the paper's own sentence; sort, filter and screen the studies, ask about any cell, and download as CSV, Excel or an image.",
  tags: ["table", "extraction", "columns", "compare papers", "csv", "excel", "xlsx", "png", "literature review", "sort", "filter", "screening", "leave out"],
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
        "**Add column** adds a column of your own: a name, what to read from each paper (said as you would to a research assistant), and whether the answer is words, a short label, a number, or yes or no. It is read straight away.",
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
      id: "rows",
      title: "Sorting, filtering and leaving papers out",
      body: ["None of this changes what a cell says: it changes which studies you see, and in what order."],
      bullets: [
        "**Sort**: select a column's name. A number column sorts from the highest, then from the lowest, then back to the table's order; words sort from A. A cell without a value always goes last. The **Paper** heading sorts the newest first, then by title.",
        "**Filter**: select the funnel by a column's name. A short-label or yes/no column lists its labels with how many studies say each; a number column takes a range; a words column takes words to look for. Any column can also keep the cells that say Not stated or Not confirmed. The funnel by **Paper** filters by title and years. Each filter shows as a chip above the table; clear one with its cross, or all at once.",
        "**Leave a paper out**: select the minus by its year and give a reason if you like. It is no longer shown, read or downloaded with this table, and what was read for it is kept. **Left out**, below the table, lists each with its reason; **Put back** returns it. **Undo** follows each change.",
        "Your sorting and filters are kept for each table in this browser. The papers you leave out are kept with the table.",
      ],
    },
    {
      id: "screen",
      title: "Screening the papers",
      body: [
        "**Screen** adds a yes/no column: a rule each study meets or not, such as \"empirical studies with university students\". Every paper is read for it and answers **Yes** or **No**, with the sentence that decides it, checked as any other cell is.",
        "The column's heading counts the answers. **Leave out the N that say No** leaves those studies out in one step, with the column as the reason, and the Excel file lists them with that sentence: a record of the screening you can keep.",
      ],
    },
    {
      id: "ask",
      title: "Asking about a cell",
      body: [
        "Select any cell, whatever it says, to see what the table has for it: the value and its sentence, or for **Not confirmed**, the answer the reading gave and the sentence it gave, which is not in the paper. **Read again** reads that one cell again from the whole paper.",
        "Below it, ask about the cell, such as \"Why 30 and not 32?\". The panel becomes a chat beside the table, and the question is a Chat conversation from the moment you send it: about that one paper, named after the column and the paper, with the cell shown above the question. Ask follow-ups in the panel, or choose **Open in Chat** to carry on there. A cell you have asked about is marked, and opens its conversation again.",
        "Each answer is a Chat answer, with numbered sources that open the passage in the paper, and counts against the daily allowance as one does. Closing the panel while an answer is being written stops it; the question stays in the conversation.",
      ],
    },
    {
      id: "download",
      title: "Downloading",
      body: ["**Download** saves the columns and studies shown, in the order shown, in the format you choose:"],
      table: {
        columns: ["Format", "What it holds"],
        rows: [
          ["CSV", "For each column, the value and then the paper's sentence for it. Opens in any spreadsheet or tool, with Thai titles intact."],
          ["Excel (.xlsx)", "**Table**, as on screen, with number columns as numbers a spreadsheet can add up; **Sources**, one line per cell with its value, note, the paper's sentence and whether it was found; and, when papers are left out, **Left out**, each with its reason and, when a yes/no column left it out, that column's sentence."],
          ["Image (.png)", "The table as a picture, for a slide or a report, with the date it was made."],
        ],
      },
    },
    {
      id: "usage",
      title: "Daily allowance",
      body: [
        "Filling a table reads the papers with the same model as Chat (GPT-6 Luna) and counts against the same daily allowance as Chat; so does **Read again**, and so does each question asked about a cell. A table of 40 papers and 5 columns uses about as much as a few chat answers. Making a table, opening it, sorting, filtering, leaving papers out and downloading use none. The meter beside **Fill table** shows how much of today's allowance is left; select it to see when it starts again.",
      ],
    },
  ],
};
