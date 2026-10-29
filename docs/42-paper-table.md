# The paper table, the docs/41 release and the table-image backfill (2026-10-28)

After docs/41 the user approved three of the five open decisions: promote the round to production, backfill the tables printed as images into existing papers, and build the extraction table. The OpenRouter top-up and the NotebookLM comparison were left with the user.

## 1. The docs/41 release

- **A fix found before release.** The worker now reads tables printed as images from the page image (docs/41). Its first version wrote them as Markdown tables. The cleaner replaces any Markdown table with `[TABLE_REMOVED]` in `paper_content.body`, the text the chat reads, so those tables reached `raw_text` only. Rows are now read across ("DA1 · 12.40 · 3.10") without rule lines, the form the Evidence view already uses for a scan's tables, and a cell's `<br>` and bold marks are dropped (#292, #293). The worker test now runs the cleaner on the extracted text.
- **Production.** #291 (test → main) was merged on 2026-10-28 at about 04:27 UTC. Web is **00103-siw** and worker **00065-jq6**; rollback is web 00101-taq and worker 00064-65k.
- **Production check.** `p67-gaps.cjs` on papertrend.web.app passed:
  - the group answer showed its note (43 s);
  - "Added up, they come to 2,187 participants" came from 31 checked counts (28 s);
  - the chart's CSV downloaded with 31 rows;
  - there were no page errors and no failed requests.
  - It cost about $0.02.

## 2. The table-image backfill

Papers analysed before the worker read image tables have them only as captions. A one-off script (outside the repo, in the session's scratchpad) did what the worker now does, for every live paper in the database:
- **scan:** download each PDF from its bucket and find pages with a table caption and pictures over 12% of the page, as `_table_image_pages` does. Pages a scanned paper already had read whole by OCR were skipped. No model calls.
- **ocr:** transcribe those pages with the worker's own vision call (`_ocr_pages` with `TABLE_OCR_INSTRUCTION`, Gemini 3.1 Flash-Lite under `budget-structured`). The same PDF in two repositories was read once.
- **apply:** after the page's last line, add the block "[Tables on page N, read from the page image]" with the rows read across. It goes in `raw_text`, and in `body` cleaned the cleaner's way. Each write was checked: taking the added blocks out gives back the old text exactly. The old `raw_text` and `body` of every changed paper were saved first.

| | |
| --- | --- |
| Live papers checked | 92, across 5 accounts and 11 repositories |
| Already read whole by OCR (scans) | 9 left out |
| Papers with table-image pages | 18 copies (several papers are in two repositories), 35 pages |
| Pages transcribed | 20 (identical files read once), $0.0104 |
| Pages with no table after all | 3 (in 4 paper copies), left out |
| Pages whose text lies beyond the stored 100,000 characters | 9, in one thesis, left out |
| Papers updated | 14 copies |

Among them is "Table 3. Descriptive statistics for the CDRA scores (n = 30)", the table the docs/41 question bank could not read, now in the paper's text with its means and standard deviations.

The word index used by the chat is keyed by each paper's content hash, so it was rebuilt on the next question; the semantic search index (embeddings of 2,800-character chunks) was not re-embedded and still ranks papers by their earlier text. Cloud SQL's 7-day recovery also covers the change.

## 3. The paper table

**Table** in the side navigation lays out the open repository's studies against the reader's own columns. It closes the largest gap in docs/41 §4: Elicit, SciSpace and NotebookLM all have it.

**Where it lives.** A page of its own, between Chat and Library, rather than inside a chat answer. A table is wider than the chat column, it is kept and reopened, and its columns change over time, which a chat answer does not.

**What it does.**
- Rows are the repository's analysed papers, one copy of each study (`oneCopyEach`), oldest first, at most 120. The rows are not stored, so a paper added later appears with empty cells.
- Columns are the reader's: a name, what to read from each paper, and whether it is words or a number. Seven presets start a table: participants, sample size, setting, research design, instruments, duration, main finding. At most 8 columns.
- **Fill table** reads the empty cells, and any whose reading failed. Four papers go to a call, with GPT-6 Luna (`PAPER_TABLE_EXTRACT`), at 14,000 characters a paper: the passages that bear on the columns, found with the same BM25 and detail words as the chat, or the whole paper when it fits. Six calls run at once. Each batch is saved, then streamed to the page as JSON lines, so the table fills in as it is read. **Stop**, or leaving the page, keeps what was read.
- A cell is **found** only when its quote is in the paper (`quoteInText`) and, for a number column, the number is printed in its quote (`numberInQuote`): Chart mode's checks. Otherwise it is **not stated**, or **not confirmed** when an answer came without a sentence the paper has. A failed call marks its cells to read again.
- A value opens its sentence in a panel, and **Show in paper** opens the PDF with it marked, as a chat citation does.
- **Download CSV**: Paper, Year, then for each column its value and "<column>: sentence in the paper".
- A column renamed keeps its values. A new instruction or kind clears them to be read again; so does a new name when the column has no instruction.
- One allowance use per fill (usage kind `chart`), and its tokens recorded with source `paper-table`.

**Storage.** `paper_tables` (`cloudsql/20261028_paper_tables.sql`, folded into `schema.sql` and `live-structure.json`): owner, repository, name, `columns` (JSON array) and `cells` (JSON object keyed "<paper id>:<column id>"). Each batch merges with `cells || $new` under a row lock, so batches finishing together never overwrite each other. Row-level security by owner; at most 30 tables a repository. The migration was applied on 2026-10-28 after on-demand backup 1793163132497; it adds one empty table and changes nothing else.

**Files.**
- `src/lib/paper-table.ts`: what the page and the server share (types, presets, column rules, CSV).
- `src/lib/paper-table-reading.ts`: the reading and checks, server only.
- `src/lib/paper-table-server.ts`: the rows.
- `src/lib/cloudsql/paper-table-repository.ts`: the SQL.
- `src/app/api/workspace/tables/...`: list and create, open, rename, change columns, delete, and fill (streamed).
- `src/components/table/PaperTableClient.tsx` and `src/app/workspace/table/page.tsx`: the page.
- `src/lib/docs/explore-table.ts`: the help page.

**On the pilot** (00290-p9k, `p68-table.cjs`, the test repository):
- A table with two columns, sample size and setting, filled 72 cells in 21 s, appearing as they were read: 59 values, 11 not stated, 4 not confirmed.
- The values read true: "180 students", "60 learners (30 intermediate and 30 advanced)", "Thailand; King Mongkut's University of Technology Thonburi".
- The CSV had 36 rows. At phone width the table scrolled inside its frame and the page did not. There were no page errors.
- Three things were fixed after it (#295):
  - The sentence panel opened at the foot of the page, out of sight; it is now drawn in a portal.
  - Some notes said where a value was stated ("Thailand is stated in the preceding sentence") instead of qualifying it.
  - A 2011 paper's sample size was its pilot's ("30 samples (Pilot)"); the instructions now ask for the study's own data first.
- On the re-check (00291-l78) the panel was in view, notes only qualified their values ("three faculties", "two groups of 30", "50 initially; 49 analyzed"), and the 2011 value read "30 samples (pilot study only)". "Not confirmed" rose from 4 to 6 cells. Asking for a total where a paper gives only parts produced totals not printed in the paper (10 learners and 10 judges, "20"). A number cell now passes the same way as in Chart mode: when the parts in its note are each printed in the sentence and add up to it (#296).
- A check proves the sentence is in the paper, not that it is the right sentence. The learner autonomy thesis gives 149 sixth graders in the intervention and 37 fifth graders in the study, and the table took the 149, as docs/41's C18 did.

**Cost.** Luna is $0.10 per million input tokens and $0.50 per million output. Each paper is read once for every eight columns a fill reads (`COLUMNS_PER_CALL`, since #297), about 14,000 characters each time; the output grows with the cells. Since §3.2 a paper read in excerpts is read again whole for the cells it lacked. On the pilot a two-column fill of 36 studies cost about $0.022 (OpenRouter credit fell from $0.612 to $0.568 over the two fills), so a five-column table is about $0.03.

### 3.1 The table as a dashboard (same day, #297)

The user asked for the table to work like YouTube Studio's analytics: many ready-made columns to show or hide, a chart above the table, and a Download menu with more than CSV.

- **62 ready-made columns** in seven groups (`paper-table-presets.ts`), up to 80 columns a table:
  - study design (7), participants (12), setting (7), intervention (9), data and analysis (10), results (10), publication (7);
  - **Columns** opens a picker with a search; tick to show, clear to hide, then **Apply**.
  - Hiding keeps a column's cells (`hidden: true` on the column), so showing it again reads nothing. A ready-made column shown for the first time is added and read.
  - A new table starts from a set: study overview, methods, intervention studies, results and implications, or empty.
- **A third kind, the short label** (`category`): one to four words worded alike across papers, such as Country, Methodology or Research design, so the chart can count them.
- **The chart above the table** (`TableChart.tsx`; figures from `foundChart`, `numberChart` and `categoryChart`, all computed from the cells):
  - what was found per shown column;
  - a number column study by study, with total, median and range;
  - a label column's answers, with capitals ignored, and "A; B" counting for both.
- **Download** (`TableDownloadMenu.tsx`), each with the shown columns:
  - CSV as before.
  - Excel: a **Table** sheet with number columns as numbers, and a **Sources** sheet with one line per cell: value, note, sentence and status. `xlsx-writer.ts` writes the .xlsx in the browser as a stored zip of the minimal Office parts, with no new library. Text is written as inline strings, so it is never a formula. A test reads the file back through its zip directory and CRCs, and openpyxl opened a sample with Thai text intact.
  - PNG: the chart and the table drawn from the data onto a canvas, as the semantic map's PNG is (`paper-table-png.ts`). Each cell is wrapped to its column, at most six lines.
- **Reading many columns:** eight columns go to a call (`COLUMNS_PER_CALL`), and each call finds its own passages, so a cell's 14,000 characters are chosen for the columns it is asked with. Twenty columns cost about three times one fill.

**On the pilot** (00293-bcz, `p69-dashboard.cjs`):
- The picker showed 7 groups. Ticking Country and Methodology read 72 cells in 15 s, 61 values found.
- The Country chart counted 33 of 36 studies (Thailand 31, China 2, Vietnam 1). The Sample size chart gave 30 of 36 studies, total 2,149, median 31.5, range 5–484.
- CSV, Excel and PNG all downloaded:
  - openpyxl read the workbook: a Table sheet with 30 sample sizes as numbers, and Sources with 324 lines, the header frozen;
  - the PNG was 4,920 × 9,532 pixels, with its chart and wrapped cells.
- The page did not scroll sideways at phone width, and there were no errors.
- The paper of "10 learners and 10 judges" now reads "20 people (10 learners and 10 judges)" (#296).
- **Found:** columns made before columns recorded their preset (the first seven presets) showed twice in the picker: ticked under *Your columns*, unticked in their group. Ticking the second would have added a duplicate. They are now matched to their preset by name (#298).
- The check ran on the newest table, "Study details 3", which the user had made on the pilot, and added Country and Methodology to it. Those two were hidden again straight after, with their cells kept.

**Taken back out** (same day, at the user's request): the chart above the table. Only the table is shown, the PNG is the table alone, and the Download menu is three one-line choices (CSV, Excel, Image) without descriptions. The short-label kind stays, for answers worded alike across papers. The chart code (`TableChart.tsx` and the chart data functions) was removed rather than left unused.

### 3.2 Flaws found in the stored tables, and their fixes (same day)

Asked whether the table was perfect, I read the four tables in the test repository directly (read-only, no model calls).

**What the audit found.**
- **Excerpts missed stated values.** Every one of the 36 papers is longer than the 14,000 characters a row reads; the median is 57,000 and the longest 103,000. The same column read in different tables disagreed on a cell's status for 10 of 36 papers (Sample size), 6 (Setting) and 5 (Research design). "Not stated" was given for "all the 149 sixth graders" and "There were 25 students in this section", both in their papers, including by the current version.
- **One column in eight was not even searched.** `readPapers` searches for the first ten queries. A column gave two (its name and its instruction), so in a call of eight columns the last three were never searched. In "Study details 3" those were Duration (19 of 36 not stated), Main finding and Methodology. Main finding was still found, because the abstract is always read.
- **Labels did not match.** Methodology read "Mixed methods" 12 times, "Mixed-methods" 9 and "Mixed-method" 2. Papers are read four to a call, so nothing made them agree.
- **Old answers were final.** A fill reads only empty and failed cells, so a later fix never reached a cell already answered. "105 participants" (3 teachers and 102 learners) stayed Not confirmed in two older tables, though the newest one confirms it.
- **The limit kept the oldest.** Past 120 studies the oldest were kept and the newest dropped.

**The fixes (the user chose these; hand-editing a cell was not wanted).**
- **A second look** (`paper-table-reading.ts`). A cell that comes back Not stated or Not confirmed from excerpts is held back. Its paper is then read again whole: up to 120,000 characters, one paper a call, all the columns it lacked in that call. The second look's answer stands, and a failed second look leaves the cell to be read again. A paper read whole the first time is not read again. Each cell records `readWhole`.
- **One search per column.** Name and instruction now go in as one query, so all eight columns of a call are searched.
- **Labels tidied** (`tidyLabels`, `labelKey` in `paper-table.ts`). In a short-label column, labels that differ only in case, hyphens, spacing or a plural are shown as their commonest spelling, on the page and in all three downloads. The stored cells keep what was read.
- **Read again.** A button by Fill table, and one in each column's edit box. It reads every Not stated and Not confirmed cell that has not had a whole-paper read (`doubtfulCells`) straight from the whole paper, so it appears only for cells read before the second look. The fill route takes `{"again": true, "columnIds": [...]}`, and it counts against the allowance as a fill does.
- **The newest 120** (`tableStudies`): past the limit the newest studies are kept, listed oldest first. The status line names it ("the newest 120 of 200 studies").
- **Wording:**
  - the empty page lists all three downloads;
  - the help page explains the second look, Read again and tidy labels;
  - the cost paragraph above.
- **A table no taller than the screen** (the user's request): the table scrolls inside a frame of `max(20rem, 100dvh − 22rem)`. The sideways scrollbar stays in view without scrolling the page to the table's end, and the header row and paper column stay put. The first try, `− 19rem`, left the frame's foot 8 px below a 950 px screen: the table starts 312 px down. With `− 22rem` (#301, pilot 00297-kfq) the foot is at 910 px; on a phone the frame is 492 px.

**On the pilot** (00296-rm6, `p71-second-look.cjs`, the test repository):
- **Frame.** The header row and the paper column stayed in place when the frame was scrolled down and sideways. Nothing scrolled the page sideways, on a desktop screen or a phone (390 px).
- **Read again on "Pilot check".** 13 cells, about 9 s, $0.015:
  - Sample size: found 30 → 33, Not confirmed 4 → 2, Not stated 2 → 1;
  - Setting: found 29 → 33, Not stated 7 → 3;
  - the button then went away.
- **A new table, Duration + Research design + Methodology.** 36 studies, 108 cells in 39 s, $0.045. Against the same columns in "Study details 3" (read before these fixes):

  | Column | Found before | Found now | Not stated before | Not stated now |
  |---|---|---|---|---|
  | Research design | 23 | 28 | 13 | 8 |
  | Duration | 17 | 20 | 19 | 16 |
  | Methodology | 28 | 33 | 8 | 3 |

  Methodology used one spelling, "Mixed methods", 24 times. The table was deleted after the check.
- **Left as they were.** Found values from older readings with notes like "Country not stated" stay: Read again reads only Not stated and Not confirmed. Editing a column's instruction reads the whole column again.

### 3.3 Choosing the rows, and asking about a cell (2026-10-29)

Asked what the table still lacked against its competitors, I named two gaps from docs/41's research:
- **Choosing and ordering the rows.** Elicit's table follows a screening step, where each paper is included or excluded with a reason and a quote; ours listed every study and could not be sorted or filtered.
- **Questioning a single cell.** Elicit shows each cell's quotes and lets the reader chat from the table; ours hid a Not confirmed answer, could not read one cell again, and had no way to ask about one.

The user asked for both, with AI screening, and approved the database change. For the cell, they wanted a small side chat, linked to Chat, where a question sent appears in Chat's conversation at once.

**Rows** (`paper-table.ts`: `viewRows`, `sortRows`, `rowPasses`, `cellPasses`, `viewChips`, `columnCounts`, `changeLeftOut`; `TableRowControls.tsx`):
- **Sort:** a column's name sorts by it. A number column sorts by the number its value starts with, from the highest; any other column by its words, from A. A cell without a value goes last either way, and ties keep the table's order. The **Paper** heading sorts newest first, then by title.
- **Filter:** each column has a funnel:
  - a short-label or yes/no column lists its labels with their counts, compared as `labelKey` compares them, so "Mixed-methods" is "Mixed methods";
  - a number column takes a range;
  - a words column takes words, which the value or its note must contain;
  - any column can keep the cells that say Not stated, Not confirmed or Not read yet.
  
  The papers filter by title and years. Chips above the table say what the view does. The view is kept per table in the browser (`readTableView` checks what it reads back), and a filter on a column hidden since is set aside (`cleanView`).
- **Leaving a paper out:** by hand, with an optional reason. A paper left out is not shown, read or downloaded; its cells are kept. **Left out**, below the table, lists each with its reason and **Put back**, and **Undo** follows each change. The 120 limit counts only the papers kept.
- **Screen:** a fourth kind of column, **yes/no** (`checkCell` keeps only "Yes" or "No" and checks its sentence like any other). The heading counts the answers and offers **Leave out the N that say No**, which records the column as the reason.
- **Downloads** hold the rows shown, in the order shown; the menu says so. Excel adds a **Left out** sheet, giving each paper's reason and, for a yes/no column, its sentence: the screening record.
- **Storage:** migration `cloudsql/20261029_paper_table_rows.sql` adds `left_out` (paper id to reason) and `cell_chats` (cell key to conversation) to `paper_tables`. It is additive with empty defaults, folded into `schema.sql` and `live-structure.json`. On-demand backup 1793249436216 was taken first. The user applied it on 2026-10-29 at 09:41 UTC (the safety check stopped me from applying it to the shared database); the live columns and checks match `live-structure.json`.

**Asking about a cell** (`CellPanel.tsx`, `paper-table-chat.ts`, `TableCellQuote.tsx`):
- **Every cell opens its panel,** whatever it says. A found value shows its sentence and **Show in paper**. A Not confirmed cell shows the reading's answer and the sentence it gave, marked as not in the paper. **Read again** reads that one cell from the whole paper (`{"again": true, "cellKeys": [...]}`, `cellsByKey`), a found value too.
- **Asking turns the card into a side chat** docked on the right, 420 px wide; on a wide screen the page makes room for it.
- **The question is an ordinary Chat request,** limited to the paper (`selected_papers` with its run), at Low, Medium or High effort. The chat route then:
  - names the conversation "<column> · <paper>";
  - stores the cell with the first question (`tableCell`, shown above it in Chat) and with each later one (`tableCellAbout`, not shown again);
  - links the conversation to the cell in `cell_chats`.
- **Every question in such a conversation is answered with the cell in mind.** `cellChatPrompt` puts the table, column, value and sentence before the reader's words, and the conversation keeps only the reader's words. This holds in the panel and in Chat.
- **Open in Chat** opens `/workspace/chat?thread=…`, and Chat reopens a conversation with its paper attached. It works once the answer is in, because leaving or closing the panel mid-answer stops the answer, as leaving Chat does.
- **A cell with a conversation is marked,** and opens it again. A conversation deleted in Chat leaves the cell as new.

**On the pilot** (#302, pilot 00298-9g4, `scratchpad/pw/p72-rows.cjs` with the test account). A new table "Rows check" in testtest, deleted afterwards with its conversation:
- **Fill:** Sample size from the picker read 36 cells in 21 s. **Screen** "University students" ("are empirical studies whose participants are university students") read 36 in 15 s: Yes 18 · No 18, each with its reason, such as "No (Participants were teachers)".
- **Sort:** Sample size from the highest (602, 484, 232, …) and then the lowest (5, 10, 10, …), all 36 in order. The Paper heading went newest first, A–Z, then back to the table's order, with a chip while sorted.
- **Filter:** Yes on the screen column showed the 18 that say Yes, with the chip "University students: Yes"; clearing the chip showed all 36.
- **Leave out:** one paper with a reason, then Undo, put it back in its place. "Leave out the 18 that say No" left 18 out; Left out listed each with "University students: No" and its sentence. Put all back returned them.
- **Cell chat:** a found Sample size cell opened its card with the sentence. A question sent with Enter docked the panel beside the table without covering it (panel from x = 1008, table to x = 972 at 1440 px). The answer at Low came in 12 s with citations. Open in Chat showed the conversation "Sample size · <paper>", its paper attached, and the cell above the question. The cell was marked, and opened the conversation again.
- **Fixed after the check:**
  - A filter left the fill's message ("Read 36 cells: …") where the count of studies shown belongs. A new view now clears that message, but not one with Undo.
  - The conversation mark was an icon only, hidden from screen readers. It now carries hidden words.
- **Cost:** $0.032. The fills were $0.0138 and $0.0171 and the question $0.0011. No page errors.

## 4. Open items

- **NotebookLM comparison** and the **OpenRouter top-up**: left with the user. Credit was $0.51 after the table's pilot checks, and $0.13 on 2026-10-29 after the rows check.
- **Semantic index after the backfill**: the 14 updated papers keep their earlier embeddings until they are re-indexed.
- From docs/41 §4, still to do: chart PNG and answer DOCX/PDF export, saved notes and sharing, a gap matrix, an agreement view, column suggestions written by the model.

## 5. Tests

- `tests/paper-table.test.ts`:
  - column ids, and which edits clear a column;
  - which cells a fill reads;
  - the quote and number checks;
  - batching, the retry and a failed call;
  - the instructions and the CSV;
  - the migration;
  - the routes against PGlite under the app's role with the model stubbed: owner only, rows one per study, the stream, cells saved, nothing read twice, the allowance recorded;
  - the navigation;
  - from §3.2:
    - the second look: held back until it is done, one call for all the columns a paper lacked, a failure left to read again;
    - Read again: straight to the whole paper, keeps the old answer when it fails, passes cells already read whole;
    - every column of a call searched;
    - labels tidied;
    - the newest studies past the limit;
    - the framed table.
  - from §3.3:
    - sorting by number, by words, by year and by title, a cell without a value last;
    - filtering by label (however written), range, words, kind of cell, title and years;
    - a stale filter set aside, the chips, a stored view read back;
    - leaving out and putting back, the limit, the reasons;
    - the yes/no check;
    - the Left out sheet;
    - the migration;
    - a paper left out leaving the table and its fill, and coming back;
    - one cell read again.
- `tests/paper-table-chat.test.ts` (§3.3), with the chat route run against PGlite:
  - the prompt and the title;
  - the cell found among a conversation's newest questions;
  - a question from a cell: named, kept with its cell, linked, and its follow-up answered with the cell in mind;
  - another person's table not linked, and a malformed cell refused.
- `tests/schema-authority.test.ts` checks the new table and columns are in `schema.sql`.
- `tests/spend-limits.test.ts` lists `paper-table-reading.ts` among the files that call a model.
- `tests/test_ingestion_extractor.py`: tables read across, empty cells kept, `<br>` and bold dropped, and the cleaner keeping them.
