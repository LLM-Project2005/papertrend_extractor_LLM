import type { DocsPageBase } from "./types";

export const uploadingPapersPage: DocsPageBase = {
  slug: "uploading-papers",
  title: "Uploading papers",
  description:
    "What files Papertrend accepts, how the duplicate check works, what happens after you click Analyze, and how to follow and manage the queue.",
  tags: ["upload", "pdf", "duplicate", "queue", "progress", "limits"],
  popular: true,
  related: ["analysis-pipeline", "repositories", "troubleshooting"],
  sections: [
    {
      id: "where-to-start",
      title: "Where uploads start",
      body: [
        "**Add papers** on a repository's Home page, or **New > Add papers** inside a repository in the Library, opens the upload dialog. The dialog always names its target at the top: **Add papers to** and the repository's name.",
        "From the Library, papers go to the repository you are browsing, which can differ from the one open elsewhere in the app. From Home they go to the open repository.",
      ],
    },
    {
      id: "limits",
      title: "Files and limits",
      body: ["The dialog skips anything it cannot take and says why."],
      table: {
        columns: ["Limit", "Value", "What you see"],
        rows: [
          ["File type", "PDF only", "`<n> file(s) were skipped. Only PDFs of 10 MB or less can be added.`"],
          ["File size", "10 MB per PDF", "The same message, or `Each PDF must be 10 MB or smaller`"],
          ["Per upload", "50 PDFs", "`Only the first 50 PDFs were kept. Add the rest in another upload.`"],
          ["Per account", "50 papers (standard accounts)", "`This account can store up to 50 papers. <n> are already stored, including any in Trash...`"],
          ["Empty files", "Refused", "`The PDF appears to be empty: <name>`"],
        ],
      },
      callout: {
        tone: "warning",
        title: "The account limit includes Trash",
        body: "The 50-paper allowance counts every paper the account holds, in every repository, including papers in Trash and papers still being analyzed. To free space, delete papers permanently from Trash. Admin accounts are not limited.",
      },
    },
    {
      id: "duplicates",
      title: "How duplicates are caught",
      body: [
        "Before anything uploads, your browser computes a fingerprint of every file (you see `Checking for papers already in your library`). The check is account-wide.",
      ],
      table: {
        columns: ["Situation", "What happens"],
        rows: [
          ["The same file selected twice in one go", "The second copy is quietly dropped, or refused with `The same PDF was selected more than once`."],
          ["A file already analyzed in this account", "The whole upload is refused with `Already analyzed in this account: <names>`, and the file is marked **Remove this file to continue**. This also matches a file with the same name and exact size."],
          ["The existing copy is in Trash", "Still refused. Restore the existing paper instead."],
          ["The earlier upload failed or never finished", "Allowed. Only finished papers block a new upload."],
          ["A different file of the same study", "Uploaded and analyzed, then marked `Possible copy of \"<title>\"` if its text closely matches a paper in the same repository. Nothing is removed."],
        ],
      },
    },
    {
      id: "profile",
      title: "The analysis profile in the dialog",
      body: [
        "The dialog shows the repository's **Analysis profile**: how every paper in this upload will be classified. **Change** opens the editor inline; **Save for repository** changes the profile for the whole repository, not just this upload. Papers are always classified with the profile stored for the repository.",
        "If some existing papers were classified with an earlier version, the dialog says how many. You can bring them up to date later with **Reclassify existing papers** (see [Analysis profiles](/docs/analysis-profiles)).",
      ],
    },
    {
      id: "what-happens",
      title: "What happens when you click Analyze",
      steps: [
        "`Preparing upload`: Papertrend creates an entry for each file. They appear in the Library straight away.",
        "`Checking for papers already in your library`: the duplicate check above.",
        "`Uploading <n> PDFs`: each file goes straight from your browser to private storage, one after another. A failed file is retried up to three times.",
        "`Starting the analysis`: the files are queued and the analysis service is asked to begin.",
      ],
      body: [
        "While files upload, the main button reads **Uploading...** and **Cancel** becomes **Hide**. Hiding the dialog, or moving to another page in the app, does not stop the upload.",
      ],
      callout: {
        tone: "warning",
        title: "Keep the tab open until the upload finishes",
        body: "The upload runs in this browser tab. Closing or reloading the tab before the dialog says the papers are being analyzed stops it; those files are later marked Failed with `Upload did not produce a storage path` and need adding again. Once the analysis has started, the tab can be closed.",
      },
    },
    {
      id: "after-upload",
      title: "After the upload",
      body: [
        "The dialog confirms how many papers are being analyzed and where they went, then offers **Open Library** and **Follow progress**. If some files could not be uploaded, it says how many; they are marked Failed in the Library.",
      ],
      table: {
        caption: "Messages about the queue",
        columns: ["Message", "Meaning"],
        rows: [
          ["**Queued**: `In line for analysis. It should start within a minute.`", "Normal. Papers in one upload are analyzed one after another."],
          ["**Waiting for another analysis to finish**", "Another upload is being analyzed first. Yours start as soon as it ends."],
          ["**Uploaded, but analysis has not started**", "The files are safe, but the analysis service did not confirm it started. Use **Start now** in the progress tray."],
        ],
      },
    },
    {
      id: "progress",
      title: "Following progress",
      body: [
        "Every upload opens the progress tray: a pill in the bottom-right corner of every workspace page that fills as the batch advances. Click it for the full list; on a phone it opens as a sheet from the bottom. On Home, the same list appears as a card on the page.",
        "Each paper shows its current step, `Step <k> of 10`, and how long it has been on that step. **Show all steps** unfolds the ten steps by name. The tray is remembered in this browser, so it survives a reload, but it does not follow you to another device.",
      ],
      table: {
        columns: ["Control", "What it does"],
        rows: [
          ["**x** on a paper", "Cancels that paper. It is marked Failed (`Canceled by user.`) and can be restarted from the Library with **Try again**."],
          ["**Cancel all**", "Cancels every paper still queued or analyzing. There is no confirmation."],
          ["**Start now**", "Appears when papers are queued but none is being analyzed. Asks the analysis service to begin."],
          ["**Retry processing**", "Appears when nothing has changed for about five minutes. Asks the service to pick the papers up again."],
          ["**Open full progress**", "Goes to Home, where the progress card has more room."],
          ["**Dismiss**", "Appears when every paper has finished. Clears the tray."],
        ],
      },
      callout: {
        tone: "info",
        title: "A long step is usually fine",
        body: "`Still working. This step has been running for about <n> minutes` means the service is still reporting in; long papers can spend several minutes on one step. Only `Nothing has moved for about <n> minutes` calls for **Retry processing**.",
      },
    },
    {
      id: "not-available",
      title: "Not available",
      body: [],
      bullets: [
        "Google Drive import is switched off. Download the PDFs and upload them from your computer.",
        "Word documents, images and other formats cannot be analyzed, even though the Library's **Type** filter lists them.",
      ],
    },
  ],
};

export const readingAPaperPage: DocsPageBase = {
  slug: "reading-a-paper",
  title: "Reading a paper's analysis",
  description:
    "The paper explorer, tab by tab: what each finding means, where it came from, how to correct a title or year, and what the downloadable report contains.",
  tags: ["paper explorer", "evidence", "keywords", "year", "correct", "report"],
  related: ["analysis-pipeline", "analysis-profiles", "repositories"],
  sections: [
    {
      id: "opening",
      title: "Opening the paper explorer",
      body: [
        "Click a finished paper's name in the Library, choose **View analysis** in its **...** menu, or follow a citation from Chat. The explorer opens over the Library, always on the **Overview** tab.",
      ],
      figure: {
        shot: "paper",
        alt: "The paper explorer for a 2017 study: its category and rationale, the year with the journal line it came from, research type, the paper's own keywords and the method found.",
        caption: "Every finding in the explorer comes with where it came from.",
      },
    },
    {
      id: "header",
      title: "The header",
      body: [
        "Under the title are the publication year (or **Year unavailable**) and the status. An amber chip appears only when the results came from an earlier analysis rather than the paper's latest one.",
      ],
      table: {
        columns: ["Button", "What it does"],
        rows: [
          ["**Correct title or year**", "Fix a wrong title or year by hand (see below)."],
          ["**Download report**", "Saves the analysis as a Markdown file (see below)."],
          ["**Download PDF**", "Saves the original file."],
          ["**Favorite**", "Marks the paper with a star."],
          ["**Rename**", "Changes the name shown in the Library, not the detected title."],
          ["**Open dashboard charts**", "Opens the Dashboard for the repository (not filtered to this paper)."],
          ["**Open in new tab**", "Opens the PDF."],
        ],
      },
    },
    {
      id: "correcting",
      title: "Correcting a title or year",
      body: [
        "**Correct title or year** turns the title into a small form. Change either field and **Save**. Your correction is kept when the paper is analyzed again, and a corrected year is shown as coming from `corrected by you`.",
      ],
      table: {
        columns: ["Field", "Rule"],
        rows: [
          ["Title", "3 to 500 characters."],
          ["Year", "Four digits between 1900 and 2099, or leave it empty for a paper with no year."],
        ],
      },
    },
    {
      id: "overview",
      title: "Overview",
      body: ["The first tab gathers what the analysis decided about the paper as a whole."],
      subsections: [
        {
          title: "Category",
          body: [
            "The category the paper was placed in under the repository's analysis profile, any secondary categories (**Also:**), and the model's written reason. **Current profile** means it was classified with today's profile; **Needs reclassification** means the profile changed since. In a General Research repository this card reads **Classification not enabled**.",
          ],
        },
        {
          title: "Extracted details",
          body: ["The facts read from the paper itself:"],
          bullets: [
            "**Publication year**, with where it was found (the journal issue line, the thesis cover, the copyright notice, the first page, scholarly metadata online...) and the exact line quoted. If no year is printed clearly, it says so and leaves it unknown.",
            "**Research type**, such as descriptive or experimental, with a one-line reason.",
            "**The paper's own keywords**, as printed in the paper, kept apart from the keywords Papertrend found.",
            "**Methods found**: methods identified as topics of their own, such as a named test or instrument.",
            "**Analysis notes**, when a step had to fall back to a simpler method.",
          ],
        },
        {
          title: "Coverage, keywords and sections",
          body: [
            "Cards for the paper's topics, its most frequent keywords and its analytical facets, then its concept groups with evidence, and four section summaries: abstract claims, methods, results and conclusion. **View full extracted text** shows exactly what was read.",
          ],
        },
      ],
    },
    {
      id: "keywords",
      title: "Keywords",
      body: [
        "Every keyword found in the paper, with the topic it belongs to, how often it appears, and the sentence it was found in. A keyword is only kept when it actually appears in the paper.",
      ],
    },
    {
      id: "evidence",
      title: "Evidence",
      body: [
        "The evidence reader puts a keyword, its stored evidence and the surrounding text side by side with the PDF. Pick a keyword on the left; the right shows how it was matched (**Exact evidence match**, **Keyword match** or **Stored rationale**), the text around the match, and the PDF opened at that passage where your browser's PDF viewer supports searching.",
      ],
    },
    {
      id: "topics",
      title: "Topics",
      body: [
        "Each topic group with its related keywords and evidence, followed by every facet (the paper's objective, population, setting and similar labels) with its supporting text.",
      ],
    },
    {
      id: "preview",
      title: "Preview",
      body: [
        "The PDF itself. The preview link lasts an hour; **Refresh preview** gets a new one if it stops loading.",
      ],
    },
    {
      id: "reports",
      title: "The downloadable report",
      body: [
        "**Download report** builds a Markdown (.md) file named after the paper: its metadata, the year with where it was read, the research type, the category and the reason for it, the paper's own keywords, its methods, topics and their keywords, facets, keywords with evidence, the extracted abstract, methods, results and conclusion, and any analysis notes or duplicate note.",
      ],
      callout: {
        tone: "info",
        title: "What the report leaves out",
        body: "There is no PDF or Word export yet, and no export of a whole repository.",
      },
    },
    {
      id: "warnings",
      title: "When something is missing",
      body: [
        "If part of the analysis was not stored, an amber **Pipeline warnings** box lists what is missing, for example `No grounded keyword rows were stored for this paper.` The rest of the explorer still works. **Analyze again** in the Library usually fills the gap.",
      ],
    },
  ],
};
