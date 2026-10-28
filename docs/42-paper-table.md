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

**Cost.** Luna is $0.10 per million input tokens and $0.50 per million output. A table of 36 studies and 5 columns reads about 36 × 14,000 characters, roughly 130,000 input tokens, and writes about 180 cells, roughly 15,000 output tokens: about $0.02.

## 4. Open items

- **NotebookLM comparison** and the **OpenRouter top-up**: left with the user. Credit was $0.61 after this round.
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
  - the navigation.
- `tests/schema-authority.test.ts` checks the new table is in `schema.sql`.
- `tests/spend-limits.test.ts` lists `paper-table-reading.ts` among the files that call a model.
- `tests/test_ingestion_extractor.py`: tables read across, empty cells kept, `<br>` and bold dropped, and the cleaner keeping them.
