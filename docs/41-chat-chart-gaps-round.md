# Chat and Chart mode: the question bank again, the gaps it showed, and the competitors (2026-10-28)

The user asked:
- for a score for the chat and Chart mode against NotebookLM and other tools;
- then to re-run the question bank and fix every shortfall named: wrongly merged papers, missing details, thin evidence and answers that change between runs (speed was left as it is);
- and to look for more places where Papertrend falls short of its competitors, so they can be worked on.

All measurements are on the test repository (41 uploads of 36 studies) with GPT-6 Luna at each question's effort, mostly Medium. Answers were judged by reading them, not by a model judge. OpenRouter spend for the round was $0.68: the baseline run $0.21, the re-runs $0.47.

## 1. The baseline: 48 chat questions on production code

The planner routed 68 of the 70 chat and Chart mode questions as expected, for $0.02. A full run of the 48 chat questions cost $0.19. Reading every answer: 37 were right, specific and cited; 8 were partly right; 3 failed.

| Question | What happened | Cause |
| --- | --- | --- |
| C43 How many studies are quantitative, qualitative or mixed? | "The full-project counts cannot be determined" | A breakdown went to the repository synthesis, which reads stored summaries |
| C40 Total number of participants across all studies | A total of 2,236 that nothing checked; said three studies give no count, though they do (33, 20, 25) | The same: stored summaries, not the papers |
| C27 Which instruments measured speaking ability? | 4 studies, without the project-based oral communication study | The short read of each paper (4,000 characters) missed its test |
| C31 Table of the writing interventions' participants and duration | "Participants: not found in the text read" for a paper that states 20 Grade 11 students | Passages are chosen by the question's words; the paper says "students", not "participants" |
| C45 Does any paper report an effect size? | "The reported excerpt does not state its value" for η2p = .093 | The same |
| C12 List all the papers | 41 rows for 36 studies, each second upload numbered again | The listing did not count copies once |
| C14 How often does "motivation" appear? | A 41-row table of mostly zeros, both copies of five studies counted, the total in the last row | The same |
| C35 (Thai) How many studies are in the repository? | "56 files, 41 analysed" and never 36 studies, which the English answer led with | The Thai overview had no study count |
| C11, C41 Which year has most papers? Which paper is longest? | The answer, then five lines of file statistics | The overview was appended whole after every fact |
| C18 Quote what the learner autonomy study says about its participants | Quoted the intervention's 149 sixth graders, not the study's 37 fifth graders | Run-to-run choice of passage |

## 2. What changed

**Duplicates.**
- `likelyDuplicatePapers` (dashboard-analytics.ts) needed only 80% of the shorter title's words to call two papers one study. It now needs every content word, in one spelling: plurals, -ise and -ize, -our and -or.
- A title that differs by one content word ("… Thai EFL learners" and "… Vietnamese EFL learners") is another study. So is one whose extra words number it (Part 1, Part 2).
- The chat's listing, word counts and repository overview now count each study once and say how many uploads are second copies.
- A term count leads with its total and lists only the papers that use the word.

**Reading the right passages** (paper-reading.ts).
- A question that asks about participants, duration, instruments, design, effect sizes or setting also looks for the words papers use for them: "students", "aged", "grade" and "sample" for participants; "weeks", "semester" and "sessions" for duration; and so on.
- This applies to every reader: answers, screening, Chart mode and Max.

**Screening** (paper-screening.ts).
- Each paper's first read is now 6,000 characters, up from 4,000.
- A paper read only in part whose text cannot settle the condition is marked unsure. It is read again at 24,000 characters with a yes-or-no verdict for each paper, and only a yes is kept.
- The first version of that second read reused the first prompt. It listed four undergraduate studies as "school students", each with a detail that said otherwise; the verdict fixed it.
- A detail re-read is now 32,000 characters, up from 16,000.

**Breakdowns, totals and averages** (repository-chat.ts, chart-reading.ts).
- "How many are quantitative, qualitative or mixed?", "the total number of participants" and "the average sample size" go to the reader Chart mode uses. Each paper is read for the value, and each value is kept only when its sentence and number are in the paper.
- A total or a mean that is asked for is computed in code, with a note that a person in two studies is counted twice.

**A named group of studies** (repository-chat.ts, `studiesInGroup`).
- For "What did the dynamic assessment studies find?" the planner names the group, and every study is checked for it in a 3,000-character read.
- If the group has two or more members and fits the effort's reading (10 papers at Medium), the answer reads all of them, with no reranker. So it cites the same studies on every run, and the reply says how the group was found.
- One paper named by its topic, a group too large to read whole, or no match runs the search as before.
- The first version narrowed large groups to their members. It cited 2 of 16 for "which frameworks do the SLA studies draw on?" and 1 of 13 for "what did the papers from 2023 on study?", so large groups now get the search.

**Chat charts can be downloaded.** Both kinds of chat chart card have **Download CSV**. For a chart read from the papers, the file lists each paper, its value and the paper's sentence.

**Tables printed as images** (nodes/extractor.py).
- In the test repository, 57 of 298 table captions are followed by text with almost no numbers. About a third of those are real tables printed as pictures, among them "Descriptive statistics for the CDRA scores (n = 30)".
- A page with a table caption whose pictures cover 12% of the page or more now has its tables transcribed by the vision model. They are added after the page's own text, so evidence can still be marked on the PDF. The extraction method stays `fitz_text`.
- At most 12 pages are read per paper (`TABLE_IMAGE_MAX_PAGES`). This applies to new uploads only.

**Also fixed.**
- "List every paper with its year" returned the papers-per-year table; a listing is now a listing.
- The Chat docs said charts cannot be downloaded and sample sizes cannot be charted; both are now possible.
- A category's name is capitalised at the start of a sentence.

## 3. After the changes

The 48 questions were run again ($0.29). The questions the screening and group changes touched were then run again ($0.11). Reading the answers: 45 of 48 are right, specific and cited.

| Question | Before | After |
| --- | --- | --- |
| C43 approaches | "cannot be determined" | 22 of 36 papers state one, counted, each with its sentence |
| C40 total participants | unchecked 2,236; three studies "give no count" | 29 papers' counts, each checked, added up to 2,067 |
| C27 speaking instruments | 4 studies, missing the oral communication test | the group read whole, with the oral communication study |
| C07 pretest-posttest | 12 studies | 14, the two added both with pre- and post-tests |
| C08 school students | 8 | 8 (after the verdict fix; 12 with four wrong before it) |
| C31 writing interventions | "participants not found" for From Pen to Pixels | 20 Grade 11 students, 12 weeks |
| C45 effect sizes | one value "not stated" | η2p = .093, .491, .005 found; 11 studies |
| C46 null results | 2 | 3, with the oral communication study's accuracy |
| C12, C14, C35, C11, C41 | copies counted, totals last, Thai without studies | one row per study, totals first, Thai leads with 36 studies |
| C18 participants quote | the intervention's sixth graders | "The population was the fifth graders at CCK School" |

New questions C49–C51:
- **C49:** the mean sample size, 71.39, from 31 checked counts.
- **C50:** the genre-based writing studies, all three read.
- **C51:** the listing with years, fixed after it showed the year table.

Ten Chart mode questions were also checked ($0.06): years, term counts, participants (28 papers), countries, durations, a results table, the Thai version, the weather refusal, the dynamic assessment subset and a paper's own figures. All were sensible.
- One value changed: the computerized reading assessment study, now 60 participants. The paper says "two groups of 30 first-year English students", which the check accepts as 30 + 30; the note beside the value gives the abstract's 30.

Still partly right:
- **C13:** a design for each paper hedges "the excerpt does not name a design".
- **C23:** "What were the results?" writes a long report instead of asking which results.
- **C43:** 20 papers counted as mixed methods. Each answer was checked against its sentence, but whether each label is right was not checked.

Group questions cost $0.002–0.004 more and take about 5–10 s longer.

## 4. Where competitors are ahead

A research pass on 2026 product pages and reviews covered NotebookLM (now Gemini Notebook), Elicit, SciSpace, Consensus, Scite, Undermind, Ai2 Asta and ChatGPT and Claude Projects. It was then checked against the code, so features Papertrend has are not listed. Evidence: S = the vendor's docs or release notes, M = a third party.

| # | Gap | Who has it | Evidence |
| --- | --- | --- | --- |
| 1 | An extraction table: papers × the reader's columns, a quote per cell, columns added or edited, a cell re-run, Excel export | Elicit, SciSpace, NotebookLM Data Tables, Asta | S |
| 2 | Computation over extracted values: cross-tabs, scatter and box plots, regressions in code | NotebookLM (agentic, June 2026), ChatGPT, Claude | S |
| 3 | Export: charts as PNG or SVG, answers as DOCX or PDF with citations, XLSX; the conversation export keeps charts | NotebookLM, Claude, ChatGPT, Elicit | S |
| 4 | A paper's figures and tables in the answer; numbers read from figures | Consensus, Elicit | S |
| 5 | Saving an answer to notes with its citations | NotebookLM | S |
| 6 | Sharing: a read-only or chat-only link, a shared project, comments | NotebookLM, ChatGPT, Elicit | S |
| 7 | A gap matrix: topics × populations or methods, each cell's papers quoted, empty cells marked | Consensus | S |
| 8 | An agreement view: which papers support, contradict or are mixed on a claim | Consensus, Scite | M–S |
| 9 | A screening record: include or exclude per paper with its reason and quote, exportable | Elicit | S |
| 10 | Chat settings: a role, a style, an answer length | NotebookLM | S |
| 11 | Select text in the PDF and ask about it | Anara | S |
| 12 | Suggested papers to add | Consensus, NotebookLM | S |
| 13 | Column and question suggestions from the collection | Elicit | S |
| 14 | Mind maps, slides, infographics | NotebookLM, Elicit | S |
| 15 | Saved questions that re-run when papers are added | Elicit | S |
| 16 | An API or MCP server | Elicit, Consensus, Scite | S |

Done this round, from that list:
- part of 2: totals and means;
- part of 3: chat chart CSV;
- part of 4: tables printed as images, for new uploads;
- part of 1: a chart read from the papers now downloads as one column with its quotes.

Where Papertrend leads:
- Exhaustive lists and counts over the whole collection. NotebookLM's data tables return partial lists: 5 quotes from 230 sources in one review (M).
- Numbers checked in code against the paper.
- Charts of values with each value's sentence.
- No small paper cap. Elicit's chat stops at 8 papers (S), and Consensus summarises 10–50 (M).

Sources:
- [NotebookLM help](https://support.google.com/notebooklm/answer/16179559)
- [NotebookLM agentic update](https://blog.google/innovation-and-ai/products/notebooklm/better-research-notebooklm/)
- [NotebookLM data tables](https://workspaceupdates.googleblog.com/2025/12/transform-sources-structured-data-tables-notebooklm.html)
- [Data tables review](https://thesciencetalk.com/news/notebooklm-data-tables-scicomm-scientists/)
- [Elicit extraction](https://support.elicit.com/en/articles/4267649)
- [Elicit Paper Chat](https://support.elicit.com/en/articles/1467969)
- [Elicit changelog](https://support.elicit.com/en/articles/14823097-changelog)
- [Consensus fall 2026](https://consensus.app/home/fall-field-notes/)
- [ChatGPT charts](https://help.openai.com/en/articles/8437071)
- [Claude file creation](https://support.claude.com/en/articles/12111783)
- [Anara PDF reading](https://support.anara.com/en/articles/14473213-reading-pdfs-in-anara)

## 5. Open items

- **Backfill the table images in existing papers.** The worker change applies to new uploads. Existing papers need their table pages transcribed and their stored text updated, about 20–30 pages in the test repository at under $0.001 a page with the vision model. That writes to production data, so it waits for the user.
- **A blind comparison with NotebookLM.** The only way to back a claim of being better is to upload the same 41 papers to NotebookLM and judge the two tools' answers to the same 15 questions without names. Ten bank questions and five benchmark questions fit (C05, C07, C08, C19, C27, C31, C40, C43, C45, C46, Bpron, Bwriting, Bgaps, Bthai, K04). It needs the user's Google account.
- **A second real collection** outside English-language education, about 15 open-access papers, to test what was tuned on one collection.
- **The next build.** The extraction table (gap 1) has the largest effect, and today's value reader is its engine for one column. It needs a decision on where the table lives: inside a chat answer, or as its own page beside the Library.
- **Not done.** Chart image export: the charts are drawn as HTML, so a PNG has to be drawn from the chart's data, as the semantic map's is.

## 6. Tests

New and changed tests:
- dashboard-analytics: titles one word or one number apart.
- paper-screening: unsure papers read again; a no is not a match.
- chart-reading: the total and the mean.
- chat-answer-behaviour-pipeline: a group read whole; one paper is not a group; a listing with years.
- chat-word-count: the total first, a copy counted once.
- dashboard-export: chat chart CSV.
- test_ingestion_extractor: table-image pages, and the table text placed after the page.
