import type { DocsCategoryBase } from "./types";

export const startCategory: DocsCategoryBase = {
  id: "start",
  label: "Start here",
  description: "What Papertrend does, and the first hour: signing in, a repository, the first papers.",
  pages: [
    {
      slug: "getting-started",
      title: "Getting started",
      description:
        "Sign in, make a repository, add your first papers and read what the analysis found, in about fifteen minutes.",
      tags: ["start", "first steps", "repository", "upload", "overview"],
      popular: true,
      related: ["repositories", "uploading-papers", "analysis-pipeline"],
      sections: [
        {
          id: "what-papertrend-does",
          title: "What Papertrend does",
          body: [
            "Papertrend reads research papers for you, one at a time and always the same way. For every PDF you add it works out the title and publication year, splits the paper into its sections, collects the paper's own keywords, finds the topics it studies and the methods it uses, and, if you ask it to, sorts it into research areas you choose.",
            "Because every paper is read the same way, the results add up. The **Dashboard** charts how the topics in a collection have moved over the years, and **Chat** answers questions about the papers with a numbered citation for each claim, so you can open the paper and check.",
          ],
          figure: {
            shot: "home",
            alt: "A repository's Home page: the number of papers, topics and keywords, a box to ask about the papers, the top topics and keywords, and the most recent papers.",
            caption: "A repository's Home page, once a few dozen papers have been analyzed.",
          },
        },
        {
          id: "before-you-start",
          title: "Before you start",
          body: ["Papertrend runs in the browser; there is nothing to install. It works best in a current version of Chrome, Edge, Firefox or Safari."],
          table: {
            columns: ["What", "Limit"],
            rows: [
              ["File type", "PDF only"],
              ["File size", "10 MB per PDF"],
              ["Files per upload", "50 PDFs at a time"],
              ["Papers per account", "50 papers for a standard account, across all its repositories"],
              ["Languages", "English and Thai (Thai is translated before keywords and topics are drawn from it)"],
            ],
          },
          callout: {
            tone: "warning",
            title: "The 50-paper limit counts Trash too",
            body: "A standard account can hold 50 papers in total, and a paper in Trash still counts until you delete it permanently from Trash. Admin accounts have no limit.",
          },
        },
        {
          id: "sign-in",
          title: "Sign in",
          body: [
            "Open the sign-in page and choose **Continue with Google**, **Continue with Facebook**, or your email and password. Google and Facebook open in a small pop-up window, so allow pop-ups for the site if nothing happens when you click.",
            "After signing in you land on the page you were trying to open, or on the list of your repositories. [Account and settings](/docs/account-and-settings) covers sign-in, passwords and the theme in detail.",
          ],
        },
        {
          id: "make-a-repository",
          title: "Make your first repository",
          body: [
            "A repository holds one collection of papers: a thesis, a literature review, a course reading list. Each repository has its own papers, dashboard and chat, and nothing crosses between them.",
          ],
          steps: [
            "Open **Repositories** (the account menu at the top right, or the name at the top left of any workspace page).",
            "Click **New repository** and give it a name.",
            "Choose an **Analysis profile**. **General Research** suits most collections; **EIL Tracks** uses the official English as an International Language research areas; **Custom Taxonomy** lets you define 2 to 12 research areas of your own. You can change this later.",
            "Click **Create repository**. You arrive on its Home page, which is empty until the first papers are analyzed.",
          ],
          callout: {
            tone: "info",
            title: "A description helps later",
            body: "The create dialog has no description field. Add one or two sentences in **Settings > General** and they appear under the name on the repository's Home page.",
          },
        },
        {
          id: "add-papers",
          title: "Add papers",
          steps: [
            "On the repository's Home page, click **Add papers**.",
            "Drop PDFs onto the dialog, or click to choose them. You can add up to 50 at once.",
            "Check the target at the top of the dialog: it says **Add papers to** and the repository's name.",
            "Click **Analyze**. The files upload one after another, then the analysis starts.",
            "Keep the tab open until the upload finishes. Once the dialog says the papers are being analyzed, you can close it, move around the app or close the tab: the analysis carries on without you.",
          ],
          body: [
            "A file you have already analyzed in this account is caught before it uploads, so the same paper is not counted twice. [Uploading papers](/docs/uploading-papers) explains every check and message.",
          ],
        },
        {
          id: "follow-the-analysis",
          title: "Follow the analysis",
          body: [
            "Each paper passes through ten steps, from **Upload** to **Done**, usually in a few minutes. Papers in one upload are analyzed one after another.",
            "On Home, a progress card lists every paper with the step it is on. On any other page a small pill in the bottom corner shows the overall progress; click it to open the full list. [How a paper is analyzed](/docs/analysis-pipeline) describes each step.",
          ],
        },
        {
          id: "read-the-results",
          title: "Read the results",
          body: ["As soon as a paper finishes it appears everywhere at once."],
          definitions: [
            { term: "Library", detail: "Every paper in the repository. Click a finished paper to open the paper explorer: its research area and the reason for it, the year with the line it came from, keywords with their evidence, and the PDF. See [Reading a paper's analysis](/docs/reading-a-paper)." },
            { term: "Dashboard", detail: "Charts of the whole repository: themes by year, research areas over time, keywords and a map of how the papers relate. See [The dashboard](/docs/dashboard)." },
            { term: "Chat", detail: "Questions answered from the papers, with a numbered citation for each claim. See [Research chat](/docs/chat)." },
          ],
        },
        {
          id: "next-steps",
          title: "Where to go next",
          body: [],
          checklist: [
            "Add a description to the repository in **Settings > General**.",
            "Open one paper in the Library and check its year and research area. If either is wrong, use **Correct title or year**.",
            "Ask Chat one question you already know the answer to, and open the citations.",
            "Read [The dashboard](/docs/dashboard) before drawing conclusions from a chart.",
          ],
        },
      ],
    },
    {
      slug: "repositories",
      title: "Repositories and the Library",
      description:
        "How papers are organized: repositories, the Library, Home, Trash, and everything you can do to a single paper.",
      tags: ["repository", "library", "trash", "rename", "favorite", "analyze again"],
      related: ["uploading-papers", "reading-a-paper", "account-and-settings"],
      sections: [
        {
          id: "what-a-repository-is",
          title: "What a repository is",
          body: [
            "A repository is one collection of papers with its own dashboard and chat. Everything in it is private to your account: no one else can see, search or chat with your papers.",
            "Repositories have no folders. Each paper belongs to exactly one repository, and the same PDF cannot be in two repositories (the duplicate check covers the whole account).",
            "The repository you have open is shown at the top left of every workspace page. Home, Dashboard and Chat always work on that repository.",
          ],
        },
        {
          id: "the-repository-list",
          title: "The repository list",
          body: [
            "**Repositories** (at /workspaces) lists every repository you own, with its description, analysis profile and when it was last updated. Click a card to open it; the choice is remembered in this browser.",
          ],
          bullets: [
            "**Search repositories** filters by name and description.",
            "**New repository** creates one (see [Getting started](/docs/getting-started#make-a-repository)).",
            "The pencil on a card renames it. You can also rename a repository, and give it a description, in **Settings > General**.",
          ],
          callout: {
            tone: "warning",
            title: "Repositories cannot be deleted",
            body: "There is no way to delete or archive a repository, so choose names you are happy to keep. A repository with no papers takes no space in your 50-paper allowance.",
          },
        },
        {
          id: "home",
          title: "Home",
          body: [
            "**Home** is a repository's overview. The line under its name counts the analyzed papers, topics and keywords and gives the range of publication years (papers without a year are left out of the range).",
          ],
          bullets: [
            "**Ask about these papers** opens Chat with your question already in the box, so you can pick a mode before sending it. The suggestions (**Main findings**, **Make a chart**, **Summarize recent papers**, **Compare papers**, **Find research gaps**) do the same with a ready-made question.",
            "**What the papers cover** ranks the five largest themes and the five most frequent keywords by how often they are mentioned.",
            "**Recent papers** lists the six newest papers with their status. Click one to open it in the Library.",
            "A notice appears when a recent paper failed or has been analyzing for 15 minutes or more; **Review in Library** shows why.",
          ],
        },
        {
          id: "the-library",
          title: "The Library",
          body: [
            "The **Library** is where the papers themselves live. Opened from the left navigation it first lists your repositories, each with its number of analyzed papers and any failures; open one to see its papers.",
            "Browsing a repository here does not change which repository Home, Dashboard and Chat use. If you browse a different one, a notice says so and offers **Switch to this repository**.",
          ],
          figure: {
            shot: "library-papers",
            alt: "The Library inside a repository: a searchable, sortable list of papers with their status and actions.",
          },
          table: {
            caption: "The toolbar",
            columns: ["Control", "What it does"],
            rows: [
              ["**New**", "Inside a repository: **Add papers**, or **Analyze repository again**. At the top level it opens the upload dialog for the repository you have open."],
              ["**Trash**", "Shows papers moved to Trash, across all repositories. **Back to library** returns."],
              ["Search", "Matches the shown name, the file name, the status and the grey line under each paper."],
              ["**Type**, **Modified**, **Source**", "Filters. **Modified** offers the last 7 or 30 days, this year, or older."],
              ["**Sort**", "By name, date modified or file size, in either direction. Column headers sort too."],
              ["**Refresh**", "Reloads the list. It also refreshes itself every 15 seconds."],
              ["List and grid", "Two layouts of the same papers."],
            ],
          },
        },
        {
          id: "paper-status",
          title: "What a paper's status means",
          body: ["Every paper shows one of four statuses, and a grey line underneath with more detail."],
          table: {
            columns: ["Status", "Meaning"],
            rows: [
              ["**Queued**", "Uploaded and waiting its turn. Papers are analyzed one after another."],
              ["**Analyzing**", "The analysis is running; the grey line names the current step."],
              ["**Ready**", "Finished. Click the name to open the paper explorer."],
              ["**Failed**", "The analysis stopped. The grey line says why, in plain words; see [Troubleshooting](/docs/troubleshooting)."],
            ],
          },
          bullets: [
            "`Possible copy of \"<title>\"` means the paper's text closely matches another paper in the same repository. Both stay; nothing is removed.",
            "`Analyzing again did not finish; the earlier results are shown.` means a re-analysis failed and the previous results are still in place.",
          ],
        },
        {
          id: "paper-actions",
          title: "What you can do with a paper",
          body: ["The buttons at the end of each row download the PDF, rename it and mark it as a favorite. The **...** menu holds the rest."],
          table: {
            columns: ["Action", "What happens"],
            rows: [
              ["**View analysis**", "Opens the paper explorer (finished papers only)."],
              ["**Download analysis report**", "Saves a Markdown (.md) file of the analysis. See [Reading a paper's analysis](/docs/reading-a-paper#reports)."],
              ["**Preview PDF** / **Open in new tab**", "Shows the original file."],
              ["**Rename file**", "Changes the name shown in Papertrend. It does not change the detected title; for that, use **Correct title or year** in the paper explorer."],
              ["**Make a copy**", "Adds a second entry for the same PDF in the same repository, with the same results. It is not analyzed again."],
              ["**Move to another repository...**", "Moves the paper, with its analysis, so it is counted and searched where it lands."],
              ["**Add to favorite**", "Adds a star. There is no favorites filter yet."],
              ["**Analyze again** / **Try again**", "Runs the analysis again with the current pipeline and the repository's current profile (see below)."],
              ["**File information**", "Name, type, source, size, last update and storage path."],
              ["**Move to trash**", "Moves the paper to Trash (see below)."],
            ],
          },
        },
        {
          id: "several-papers",
          title: "Several papers at once",
          body: [
            "Tick the box beside each paper, or the box above the list to tick every paper shown. A bar above the list then acts on all of them together: **Move...**, **Analyze again**, **Try again**, **Cite** and **Move to Trash**; in Trash, **Restore** and **Delete permanently...** (type `delete` to confirm more than one).",
            "Only papers in view are acted on: a paper hidden by the search or a filter is never changed unseen.",
          ],
        },
        {
          id: "references",
          title: "Exporting references",
          body: [
            "**Cite** in the bar (for the papers ticked) or **New > Export references** (for the whole repository) opens the references as **BibTeX**, **RIS** or **APA**, to copy or download. BibTeX and RIS import into Zotero, Mendeley, EndNote and LaTeX; APA is an APA 7 reference list as plain text.",
            "The analysis keeps a paper's title and year, but not its authors or journal. Those are looked up in Crossref, by the DOI printed on the paper or else by an exact title match, and kept with the paper, so the first export takes a few seconds per paper and later ones are immediate. A paper Crossref does not list, such as many theses, is exported with its title and year only, and the window says how many. A title or year you corrected is used instead of Crossref's.",
          ],
        },
        {
          id: "analyze-again",
          title: "Analyzing a paper again",
          body: [
            "**Analyze again** (a finished paper) or **Try again** (a failed one) runs the whole analysis once more, using today's pipeline and the repository's current analysis profile. **New > Analyze repository again** does the same for every finished paper in the repository, up to 200 at a time.",
            "Before it starts, Papertrend shows how many papers will be analyzed and roughly how many tokens of model use that takes (about 30,000 a paper; analysis does not count toward your daily chat tokens). Titles and years you corrected by hand are kept. The papers then appear in the progress tray, exactly like a new upload.",
          ],
          callout: {
            tone: "info",
            title: "Changed your research areas?",
            body: "If you only changed the analysis profile, you do not need a full re-analysis. **Settings > Analysis & classification > Reclassify existing papers** re-sorts the papers into the new research areas much faster. See [Analysis profiles](/docs/analysis-profiles).",
          },
        },
        {
          id: "trash",
          title: "Trash",
          body: [
            "**Move to trash** takes a paper out of its repository: it leaves the Library list, the Dashboard, Home's counts, Chat, the semantic map and reclassification. **Restore to repository** puts it back exactly as it was.",
          ],
          bullets: [
            "Trash is shared by all your repositories.",
            "In Trash, a paper's **...** menu has **Delete permanently...**, and **Empty Trash...** deletes everything in it. Both remove the PDF and everything the analysis found, and cannot be undone; emptying Trash asks you to type `delete` first.",
            "A paper in Trash still counts toward the 50-paper allowance until it is deleted permanently.",
            "A copy made with **Make a copy** shares its original's analysis: deleting the copy leaves the original untouched.",
            "Uploading the same PDF again leaves it out of the upload while a copy is in Trash, and says so; restore the existing one instead.",
          ],
        },
        {
          id: "limits",
          title: "Good to know",
          body: [],
          bullets: [
            "The Library shows the 200 most recently updated files of the account. Standard accounts, limited to 50 papers, never reach this.",
            "Filters, sort order and layout are not remembered when you leave the page.",
            "A link such as `/workspace/library?runId=...` opens that paper directly; Chat's citations use this.",
          ],
        },
      ],
    },
  ],
};
