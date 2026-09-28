import type { DocsPageBase } from "./types";

export const analysisPipelinePage: DocsPageBase = {
  slug: "analysis-pipeline",
  title: "How a paper is analyzed",
  description:
    "Every step between upload and Ready: reading the text, translation, sections, title and year, keywords, topics, category, research type and facets, with the rules each step follows.",
  tags: ["analysis", "pipeline", "ocr", "translation", "year", "keywords", "topics"],
  related: ["reading-a-paper", "analysis-profiles", "uploading-papers"],
  sections: [
    {
      id: "overview",
      title: "The analysis at a glance",
      body: [
        "Each paper is read on its own, always in the same order. The steps that depend on each other run one after another; the rest run side by side. When the last step finishes, everything is saved in one go, so a paper is either fully Ready or keeps its previous results.",
      ],
      steps: [
        "Read the text from the PDF, using OCR for pages that are scanned images.",
        "Clean it: rejoin words split across lines, drop page numbers and tables.",
        "Translate it into English if it is mostly in another script, such as Thai.",
        "Find the sections: abstract, introduction, literature review, methods, results, discussion, conclusion and references.",
        "At the same time: work out the title and year, collect the paper's own keyword list, find keywords in the text, and note the paper's objective and contribution (facets).",
        "Group the keywords into topics and give each topic a short label.",
        "At the same time: place the paper in a category (if the repository uses categories) and decide its research type.",
        "Assemble and save everything, then check whether the paper duplicates another one in the repository.",
      ],
    },
    {
      id: "the-ten-steps",
      title: "The ten steps you see",
      body: [
        "The progress tray groups the work into ten steps. The message under each paper names the latest step that finished, so it can seem to run slightly behind. Because facets run alongside keyword mining, the step shown can move to **Classify** and briefly back to **Keywords**.",
      ],
      table: {
        columns: ["Step", "What happens"],
        rows: [
          ["**Upload**", "The file travels from your browser to private storage."],
          ["**Queued**", "The paper waits its turn. The queue is shared, and papers are taken oldest first."],
          ["**Prepare**", "The stored PDF is fetched for analysis."],
          ["**Read text**", "The text is extracted, with OCR where needed, then cleaned."],
          ["**Sections**", "The text is translated if necessary and divided into sections."],
          ["**Metadata**", "The title, year and the paper's own keywords are worked out."],
          ["**Keywords**", "Keywords are found in the text, grouped into topics and labeled."],
          ["**Classify**", "Category, research type and facets."],
          ["**Save**", "The results are assembled and saved."],
          ["**Done**", "The paper is Ready everywhere."],
        ],
      },
    },
    {
      id: "reading-the-text",
      title: "Reading the text, and scanned PDFs",
      body: [
        "Papertrend first reads the PDF's own text layer. If a whole document has no usable text (for example a scanned thesis), each page is sent to a vision model to be read as an image: OCR, preserving Thai and English exactly.",
        "Where only some pages are scanned, those pages are read with OCR when the scan starts on the first or second page or covers a good share of the document.",
      ],
      table: {
        columns: ["Limit", "What it means"],
        rows: [
          ["OCR: 24 pages", "A longer scanned document is sampled: its first 8 pages, its last 8, and 8 spread between. A note says how many pages were read."],
          ["Long papers", "Every page's text layer is read, but later steps each read a budget of the text (for example, the first 40,000 characters for the year), so very long theses are summarized from their key parts."],
          ["80-page note", "A PDF over 80 pages is still analyzed. The analysis notes simply record that it is long."],
        ],
      },
      callout: {
        tone: "warning",
        title: "When nothing can be read",
        body: "If a PDF is damaged, protected, or its scan is unreadable, the paper fails with `No readable text could be found in this PDF` or `The PDF could not be read`. Saving the file again as a PDF (for example with Print to PDF) usually fixes it.",
      },
    },
    {
      id: "translation",
      title: "Translation",
      body: [
        "A paper is translated when fewer than about three quarters of its letters are Latin (A to Z), which covers Thai and any other non-Latin script. It is translated into formal academic English, keeping headings and paragraphs and translating each term the same way every time. Nothing is summarized.",
        "Sections, keywords, title and year are then drawn from the English text. The original text is kept, and you can still read it in the paper explorer.",
      ],
      bullets: [
        "Up to 60,000 characters are translated whole.",
        "A longer paper has its opening and its main sections translated (abstract, introduction, literature review, methods, results, discussion, conclusion). The reference list is not translated.",
        "A part that fails to translate stays in its original language, with a note. If every part fails, the paper is analyzed untranslated.",
      ],
    },
    {
      id: "sections",
      title: "Sections",
      body: [
        "The paper is divided into abstract, introduction, literature review, methods, results, discussion, conclusion and references. Headings are recognized in English and Thai. A model reads an outline of the headings to decide where each section starts; if that fails, heading rules are used and a note says so.",
      ],
      bullets: [
        "If no abstract is found, the first 3,000 characters stand in for it.",
        "If no conclusion or discussion is found, the last 3,500 characters before the references stand in.",
        "Running headers are ignored, and acknowledgements, appendices and author biographies end a section.",
      ],
    },
    {
      id: "title-and-year",
      title: "Title and year",
      body: [],
      subsections: [
        {
          title: "Title",
          body: [
            "A title is first read from the layout of the opening lines, skipping journal headers, emails and affiliations. A model then checks it against the first page and abstract, keeping the full title with its subtitle. For a bilingual paper the English title is preferred; a Thai-only title is translated.",
          ],
        },
        {
          title: "Year",
          body: [
            "The year is taken only from evidence that it is the publication year: a line such as \"published\", \"available online\" or ©, a journal issue line, or a thesis cover. A year in the file name can support that evidence but not decide it. Years near \"received\", \"accepted\", data collection or references are discounted, and a PDF's file dates never decide the year. Thai Buddhist-era years are converted (2563 becomes 2020).",
            "When the paper does not state its year clearly, Papertrend looks it up online (Crossref, then OpenAlex) using the DOI or an exact title. If two strong candidates disagree, or the online year contradicts the paper, the year is left **Unknown** rather than guessed.",
            "A year you correct by hand always wins and is kept through any re-analysis.",
          ],
        },
      ],
    },
    {
      id: "keywords",
      title: "Keywords",
      body: [
        "Keywords are concepts the paper studies, found in its own text. Papertrend reads a set amount of each section (for example 3,000 characters of the abstract and 5,000 of the results) and never reads the reference list.",
      ],
      bullets: [
        "The model proposes 12 to 20 concepts, each marked as a subject or a method, with at most 3 methods.",
        "**Every keyword must appear in the text.** A concept that cannot be found, as a whole phrase, is dropped, and a note says how many were.",
        "Each keyword keeps the sentence it was found in, and its frequency is counted in the text rather than estimated.",
        "Phrases that only name a group of people, such as \"Thai EFL learners\", are not keywords. \"Learner autonomy\" still is.",
        "The paper's own printed keyword list (\"Keywords\", \"Index terms\", \"คำสำคัญ\") is collected separately and joins the candidates when it appears in the text.",
      ],
    },
    {
      id: "topics",
      title: "Topics and labels",
      body: [
        "The keywords are then grouped into topics, each keyword in exactly one topic. Subjects and methods never share a topic. An acronym joins its long form only when the paper defines it, so \"DA\" and \"dynamic assessment\" merge only if the paper says they are the same.",
        "Each topic gets a label of 2 to 5 words, distinct within the paper and in its own wording. On the dashboard, topics from different papers that study the same thing are gathered into shared themes; see [The dashboard](/docs/dashboard#themes).",
      ],
    },
    {
      id: "category-type-facets",
      title: "Category, research type and facets",
      body: [],
      subsections: [
        {
          title: "Category",
          body: [
            "In a repository with categories, the paper is placed in one primary category and up to two secondary ones, with a written reason. General Research repositories skip this step. [Analysis profiles](/docs/analysis-profiles) explains the rules.",
          ],
        },
        {
          title: "Research type",
          body: ["Every paper is given a primary research type, and sometimes a secondary one, from four groups:"],
          bullets: [
            "EIL repositories: Descriptive & Explanatory; Pedagogical & Intervention; Assessment & Measurement; Policy, Sociolinguistic & Critical.",
            "Other repositories: Descriptive & Explanatory; Intervention & Design; Measurement & Method; Review, Theory & Critique.",
            "A test used only to measure whether teaching worked makes a paper Pedagogical or Intervention; a test that is itself designed or validated makes it Assessment or Measurement.",
          ],
        },
        {
          title: "Facets",
          body: [
            "Up to four objective verbs (investigate, compare, evaluate...) and four contribution types, each with its supporting text.",
          ],
        },
      ],
    },
    {
      id: "saving-and-duplicates",
      title: "Saving, and possible copies",
      body: [
        "All of a paper's results are saved together. After saving, its text is compared with the other finished papers in the same repository. If it closely matches one, the later copy is marked `Possible copy of \"<title>\"`. Nothing is removed; you decide whether to move one copy to Trash.",
      ],
    },
    {
      id: "analysis-notes",
      title: "Analysis notes",
      body: [
        "A step that cannot run normally falls back to a simpler method rather than failing the paper, and records a note: for example `extraction: the PDF is scanned, and OCR read 24 of its 180 pages`, or `translation: the document was long, so its opening and main sections were translated`. Up to 10 notes appear under **Analysis notes** in the paper explorer. A paper with notes is still Ready, but check its key facts against the PDF.",
      ],
    },
    {
      id: "time-and-cost",
      title: "How long it takes, and what it costs",
      body: [
        "The analysis itself usually takes under a minute; with queueing and saving, most papers are Ready within a few minutes. Papers in one upload are analyzed one after another, so a batch of 50 takes longer. Scanned papers take longest, because every page goes through OCR.",
        "Model use costs roughly one to two US cents per paper, more for scanned papers. Papertrend shows an estimate (about US$0.02 per paper) before you analyze papers again.",
      ],
    },
    {
      id: "models",
      title: "Which models do the work",
      body: [
        "The analysis uses fast, low-cost language models reached through OpenRouter: Gemini 3.1 Flash-Lite and Gemini 2.5 Flash-Lite, each backing up the other if a call fails. Answers that do not match the expected format are retried once with the problem described. Cleaning, the year lookup, duplicate checks and the participant filter use no model at all.",
      ],
    },
    {
      id: "stalls-and-failures",
      title: "When a paper stalls or fails",
      body: [
        "While a paper is analyzed, the service reports in every minute. If a paper stops reporting for about six minutes, it is put back in the queue automatically (`Recovered stalled analysis run`); after two such recoveries it fails, so a problem file cannot block the queue forever.",
        "If nothing moves for five minutes, the progress tray offers **Retry processing**. A failed paper says why in plain words, with the original error underneath. [Troubleshooting](/docs/troubleshooting#analysis) lists every message.",
      ],
    },
  ],
};

export const analysisProfilesPage: DocsPageBase = {
  slug: "analysis-profiles",
  title: "Analysis profiles and categories",
  description:
    "How a repository sorts its papers into categories: General Research, the official EIL tracks, or your own taxonomy, and how to reclassify papers after a change.",
  tags: ["categories", "profile", "eil", "taxonomy", "reclassify", "classification"],
  related: ["account-and-settings", "analysis-pipeline", "dashboard"],
  sections: [
    {
      id: "what-a-profile-does",
      title: "What a profile decides",
      body: [
        "Each repository has one analysis profile. It decides whether papers are sorted into categories and, if so, which ones. Everything else in the analysis (text, sections, title, year, keywords, topics, research type, facets) happens the same way under every profile.",
        "You choose a profile when you create a repository, and you can change it at any time in **Settings > Analysis & classification**, or with **Change** in the upload dialog. New repositories start on General Research.",
      ],
      figure: {
        shot: "settings-analysis",
        alt: "The analysis profile chooser with General Research, EIL Tracks and Custom Taxonomy, and the three official EIL categories.",
      },
    },
    {
      id: "general-research",
      title: "General Research",
      body: [
        "Recommended for most disciplines. Papers are analyzed without being sorted into categories: no category is stored, the paper explorer's category card reads **Classification not enabled**, and the dashboard's Category Analysis explains how to turn categories on.",
      ],
    },
    {
      id: "eil-tracks",
      title: "EIL Tracks",
      body: [
        "The official English as an International Language categories, with their boundary rules. They cannot be edited.",
      ],
      definitions: [
        { term: "English Linguistics (EL)", detail: "Research primarily explaining English language structure, meaning, variation, discourse, translation, or language use in global and local contexts." },
        { term: "English Language Instruction (ELI)", detail: "Research primarily concerning English teaching, learning, pedagogy, curriculum, teacher development, classroom practice, or instructional interventions." },
        { term: "Language Assessment & Evaluation (LAE)", detail: "Research primarily concerning language-test design, validation, scoring, measurement, interpretation, washback, or assessment practice." },
      ],
      callout: {
        tone: "info",
        title: "The boundary rules",
        body: "Classify by the paper's primary contribution. Instructional interventions belong to ELI even when tests measure outcomes. Linguistic analysis belongs to EL unless it primarily builds or validates an assessment, which belongs to LAE. Add secondary categories only for genuine contributions.",
      },
    },
    {
      id: "custom-taxonomy",
      title: "Custom Taxonomy",
      body: [
        "Your own categories, from 2 to 12. Each needs a name and a description of what evidence belongs in it: the description is what the model reads when it decides, so write it the way you would brief a colleague.",
      ],
      table: {
        columns: ["Field", "Limit", "What it is for"],
        rows: [
          ["**Taxonomy name**", "120 characters", "Shown on the category card and the repository list."],
          ["**Research domain**", "160 characters", "The field, in a phrase."],
          ["**Purpose and inclusion boundaries**", "1,200 characters", "The rules for telling categories apart, like the EIL boundary rules."],
          ["**Domain definition**", "1,200 characters", "What the field covers."],
          ["Category name", "80 characters", "Must be unique."],
          ["Category description", "600 characters", "What evidence belongs here."],
          ["**Additional guidance**", "2,000 characters", "Anything else the classifier should know."],
        ],
      },
      bullets: [
        "Reorder categories with the arrows; remove one with the bin (not below two).",
        "**Copy from repository** starts from another repository's profile; editing the copy does not change the original.",
        "Do not add an \"Other\" category: **Other / Unclassified** is always available automatically.",
        "Two names that differ only in punctuation or non-Latin letters count as the same name, because each category also gets an internal key made of Latin letters and digits.",
      ],
    },
    {
      id: "other-unclassified",
      title: "Other / Unclassified",
      body: [
        "Every classifying profile has an extra category, **Other / Unclassified**, for evidence that is weak, ambiguous or outside the taxonomy (not merely because a paper is interdisciplinary). It never comes with secondary categories. If the classifier fails for any reason, the paper is placed here with a note, and reclassifying or analyzing it again usually fixes it.",
      ],
    },
    {
      id: "how-classification-works",
      title: "How a paper is classified",
      body: [
        "The classifier reads the title, the abstract, methods, results and conclusion (up to 7,000 characters each) and the paper's topic labels, together with the profile's domain, boundary rules and guidance. It is told to treat the paper's text as material to judge, never as instructions.",
        "It chooses the category that best represents the paper's primary contribution, judged from its stated aim, method, findings and contribution rather than stray words, and adds at most two secondary categories for genuine secondary contributions. Its reason is stored and shown on the paper.",
      ],
    },
    {
      id: "changing-a-profile",
      title: "Changing a profile",
      body: [
        "Saving a new profile applies to new uploads straight away. Papers already analyzed keep their category, now marked **Needs reclassification** in the paper explorer, until you bring them up to date. Papers still waiting in the queue keep the profile they were uploaded under.",
      ],
    },
    {
      id: "reclassifying",
      title: "Reclassifying existing papers",
      body: [
        "**Settings > Analysis & classification > Existing papers** shows how many papers use the current profile, an earlier one or none, and offers **Reclassify existing papers**. Save the profile first; the button stays off while there are unsaved changes.",
      ],
      table: {
        columns: ["", "Reclassify", "Analyze again"],
        rows: [
          ["What it reads", "The stored text and topics", "The PDF, from the start"],
          ["What changes", "Categories only", "Everything: text, year, keywords, topics, categories..."],
          ["Speed", "Fast; four papers at a time", "Minutes per paper"],
          ["Where", "Settings", "The Library"],
          ["If something fails", "Nothing is published; the previous categories stay", "The paper keeps its earlier results"],
        ],
      },
      bullets: [
        "Reclassifying reads **every** finished paper in the repository again, so all of them end up under the same profile.",
        "Results are published all at once when every paper has a new category. If any paper fails, nothing changes and **Retry failed papers** tries just those again.",
        "**Cancel reclassification** stops the job and keeps the previous categories.",
        "Switching to General Research and reclassifying removes the categories.",
      ],
    },
    {
      id: "where-categories-appear",
      title: "Where categories appear",
      body: [
        "On each paper's category card in the paper explorer, in the dashboard's Category Analysis tab and category filters, and in the Overview's category charts.",
      ],
      callout: {
        tone: "info",
        title: "A few views still use the original EIL codes",
        body: "The concept search's **Track spread** chart and the semantic map's **Color: track** still show the original EL, ELI and LAE slots. With a custom taxonomy, use the category views and the Adaptive tab, which use your own categories.",
      },
    },
  ],
};
