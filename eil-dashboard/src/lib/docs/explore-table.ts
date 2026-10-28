import type { DocsPageBase } from "./types";

export const tablePage: DocsPageBase = {
  slug: "table",
  title: "Table",
  description:
    "Lay a repository's studies out against your own columns: participants, setting, design, findings or anything you name, each value with the paper's own sentence, downloaded as CSV.",
  tags: ["table", "extraction", "columns", "compare papers", "csv", "literature review"],
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
      body: ["A new table starts from a few common columns, which you can change, and reads every paper for them."],
      steps: [
        "Open **Table** and choose **New table**.",
        "Name it, tick the columns to start with (participants, sample size, setting, research design, instruments, duration, main finding) and choose **Make and read**.",
        "The table opens with the studies down the side and fills in as the papers are read, a few papers at a time. **Stop** keeps what was read; **Fill table** reads the rest.",
        "**Add column** adds a column of your own: a name, and what to read from each paper, said as you would to a research assistant. It is read straight away.",
      ],
      bullets: [
        "A table holds up to 8 columns and the first 120 studies; a repository holds up to 30 tables.",
        "Renaming a column keeps its values. Changing what it reads, or whether it is a number, clears it to be read again.",
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
      id: "download",
      title: "Downloading",
      body: [
        "**Download CSV** saves the table for a spreadsheet: for each column, the value and then the paper's sentence for it, so the file can be checked and cited. The file opens in Excel, Google Sheets and Numbers, with Thai titles intact.",
      ],
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
