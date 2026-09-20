# Professor Feedback — Round 1 Response

Last updated: 2026-09-20 (Asia/Bangkok)
Branch: `development` → PR into `test`

This document records what the professor asked for, what was found in the code,
what changed, and what is measured rather than asserted. It is the evidence
trail for the next review meeting.

## Feedback items

1. Expand distance in the semantic map so it is really usable.
2. Clusters need to be separate; some papers sit inside a neighborhood they do
   not belong to. What is actually used to calculate a cluster?
3. How is a neighborhood differentiated? Why do two papers share a colour but
   have no line between them?
4. Most important: make chat genuinely smart and usable for all cases, for
   example counting words in a paper. More test cases, more evaluation.

## Findings

### A. Thai text was tokenized incorrectly (severity: high)

`tokenizeRepositoryText` matched words with `/[\p{L}\p{N}]+/u`. Thai vowel and
tone marks are Unicode category `Mn` (non-spacing mark), not `L`, so every Thai
word was split at each mark into fragments that are not words:

```text
การศึกษานี้มุ่งเน้นการใช้ภาษาอังกฤษ...
  before: ["การศ","กษาน","ม","งเน","นการใช","ภาษาอ","งกฤษเป", ...]
  after:  ["การ","ศึกษา","นี้","มุ่ง","เน้น","การ","ใช้","ภาษา","อังกฤษ", ...]
```

This silently corrupted every Thai word count and every Thai lexical retrieval
match, which matters because Thai theses are a core use case.

**Fix.** `Intl.Segmenter` (ICU dictionary-based Thai word breaking, available in
the Node 22+ runtime the app already requires) now performs segmentation.
English tokenization is byte-identical to the previous behaviour, which the test
suite pins. `TERM_INDEX_VERSION` was bumped to `papertrend-term-index-v3-icu` so
cached term indexes rebuild rather than serving stale fragment counts.

### B. "How many words is this paper?" did not work (severity: high)

This is the professor's literal example. Two separate defects:

- Intent detection only recognised term *frequency* phrasing (`count`,
  `frequency`, `how many times`). "How many words" matched none of them, so the
  question fell through to generic QA where a language model guesses a number it
  has no way to know.
- Even when `word_count` was reached, `wordCountResult` required a quoted term
  and otherwise replied "Which exact word or phrase should I count?".

**Fix.** `requestsTotalWordCount` detects document-length questions in English
and Thai and routes them to `word_count` with no term and exhaustive scope.
`wordCountResult` now answers the length question directly with a per-paper
table, a corpus total and an average, in the conversation's language.

### C. Word counts did not disclose what they counted (severity: medium)

`canonicalPaperContent` uses the full document text when stored, and otherwise
silently falls back to the extracted sections (abstract, methods, results,
conclusion). A count over four sections was presented as though it were the
whole paper.

**Fix.** Papers now carry `contentSource` (`full_text` / `extracted_sections` /
`empty`). Answers state which was used, and a machine-readable limitation is
returned to the caller when any paper is not full text.

### D. Cluster colour and screen position were computed independently (severity: high)

This is the direct cause of feedback items 2 and 3.

- Colour came from `clusterEmbeddings` — k-means over the **full 1,536-dimension
  embeddings**, with `k` chosen by best silhouette score, Euclidean distance.
- Position came from `projectEmbeddings` — PCA (≤12 papers) or UMAP, run
  **independently** on the same embeddings.

Nothing tied the two together, so a paper legitimately assigned to neighborhood
A could be projected into the middle of neighborhood B. The map contradicted its
own legend.

Separately, lines came from `buildSimilarityEdges` — mutual nearest neighbours
under a percentile distance threshold. That is a third independent computation,
which is why two papers could share a colour with no line.

**Fix.**

- `separateClusters` runs after projection: each neighborhood is tightened
  toward its own 2D centroid and pushed away from the map centre, so position
  agrees with colour while membership stays the honest high-dimensional
  assignment.
- `connectClusters` adds a minimum spanning tree inside each neighborhood, so no
  coloured group is ever drawn with no internal lines. Added links stay strictly
  inside one neighborhood and are marked `rank: 0` so they can be styled apart.
  Existing nearest-neighbour edges are never removed.
- `normalizeCoordinates` now scales on a 3rd–97th percentile span instead of
  min–max, so one outlier can no longer compress every other paper into the
  centre, and uses a larger canvas. This is the "expand distance" item.

### E. The map never explained itself (severity: medium)

The professor had to ask what computes a cluster. That question should be
answerable on screen.

**Fix.** `semanticMapMethodology` produces a plain-language explanation of what
decides a neighborhood, what decides a position, what decides a line, why the
same colour can lack a line, and how distance must *not* be read. It is rendered
as a "How this map is built" panel beside the canvas, populated from the map's
own recorded quality metrics.

## Measured results

`npm run evaluate:semantic-map-layout` on synthetic corpora with known
neighborhood structure:

| Scenario | Separation ratio | Neighborhoods with no internal line |
| --- | ---: | ---: |
| 3 themes / 30 papers / tight | 35.96 → **79.40** | 3 → **0** |
| 4 themes / 48 papers / overlapping | 29.77 → **65.89** | 4 → **0** |
| 5 themes / 100 papers / noisy | 28.56 → **63.05** | 5 → **0** |
| 2 themes / 14 papers / small | 24.04 → **52.26** | 2 → **0** |

Separation ratio is mean distance between neighborhood centres divided by mean
spread inside a neighborhood; higher reads as more visually distinct. It roughly
doubled in every scenario, and every neighborhood is now internally connected.

Honest caveat: "papers drawn inside the wrong neighborhood" was already 0 on
these synthetic blobs because they are cleanly separable. The harder unit
fixture in `tests/semantic-map-clustering.test.ts` is the one that exercises
that property. Real repositories are messier than both, so this still needs a
visual check against a real repository.

## Tests

The suite grew from **120 to 152** tests, all passing, with typecheck and the
production Next.js build clean.

```powershell
npx tsc --noEmit
npm run test:repository-chat        # full suite, 152 passing
npm run test:chat:word-count        # 18 new chat/word-count tests
npm run test:semantic-map:layout    # 14 new layout/clustering tests
npm run evaluate:semantic-map-layout
npm run build
```

New coverage includes Thai segmentation correctness, English non-regression,
mixed-script counting, multi-word Thai phrases, intent disambiguation between
"how many papers" and "how many words", per-paper totals, content-source
disclosure, cluster/position agreement, canvas bounds, determinism, outlier
resistance, intra-neighborhood connectivity, and the honesty constraints on the
methodology text.

## Not done yet

Stated plainly so it is not mistaken for finished work:

- **Deep research** was not changed in this round. The chat work here targeted
  the defects behind the professor's stated example; the broader deep-research
  quality pass is still open.
- No live authenticated test was run against the pilot or production URL. All
  verification above is deterministic/offline plus a production build.
- The visual check of the new layout against a real repository is still
  outstanding and needs a signed-in browser session.
- `SEMANTIC_MAP_PROJECTION_VERSION` was left unchanged, so existing saved maps
  keep their stored coordinates until they are regenerated. Decide whether to
  bump it to force a rebuild for everyone.

## Round 2 — deep research and Thai retrieval

### F. Deep research silently ran on incomplete corpora (severity: high)

`research_preflight_node` is the gate that decides whether analysis is still
running before research starts. It called `_pending_runs`, which queried
Supabase REST directly instead of going through the `workspace_data` provider
switch. Production Cloud Run sets `DATABASE_PROVIDER=cloud-sql` and carries **no**
Supabase credentials at all, so `_pending_runs` hit its
`if not _get_supabase_url(): return 0` guard and always reported zero pending
runs. Deep research therefore treated a half-ingested repository as ready and
reported it as complete.

`_project_folder_ids` had the same problem and always returned an empty list,
so project-scoped pending detection could not work either.

**Fix.** `workspace_data` gained `select_research_rows` and
`research_provider_available`, which honour the same provider switch the rest of
the loader uses. Both functions now read through it, so they work on Cloud SQL.
No direct Supabase REST reads remain in `nodes/deep_research.py`.

### G. Deep research deleted Thai text entirely (severity: high)

`_normalize_title` applied `re.sub(r"[^a-z0-9\s]", " ", ...)`, which removes
every Thai character. A Thai title normalized to an empty string and `_tokenize`
returned no tokens, so Thai papers could never match lexically during candidate
selection or title resolution.

**Fix.** Normalization now strips punctuation with a Unicode-aware `\w` class,
preserving every script. Tokenization keeps Thai runs and adds character
trigrams so Thai strings match partially rather than not at all. English
tokenization, including the stopword and minimum-length rules, is unchanged.

### H. Thai documents collapsed into a single retrieval passage (severity: medium)

`splitEvidencePassages` split on a blank line or an English sentence ending
followed by a capital letter. Thai has no capital letters and rarely uses
terminal punctuation, so an entire Thai document became one passage; retrieval
could only ever quote its opening 1,400 characters.

**Fix.** `splitTextPassages` is script-aware. Thai text is grouped into windows
on its natural space-delimited clause boundaries; English keeps the existing
sentence splitting. Paragraph breaks are honoured for both.

### Round 2 verification

- TypeScript suite: **162 passing** (from 152), 0 failing
- Python suite: **134 passing** (from 119), 0 failing
- `npx tsc --noEmit` clean; production Next.js build clean
- Pilot Cloud Build `ab832411` succeeded; pilot revision
  `papertrend-web-cloudsql-pilot-00081-df7` returned `200` on `/api/health`

### Still outstanding after round 2

- **No live authenticated test was run.** Connecting to Cloud SQL from this
  machine requires the Cloud SQL Auth Proxy, and starting it was blocked by the
  local sandbox policy. The deterministic suites, the production build and the
  pilot health check all pass, but no query has been run against real
  repository rows.
- The semantic map still needs a visual check against a real repository.
- `SEMANTIC_MAP_PROJECTION_VERSION` is unchanged, so saved maps keep their old
  coordinates until regenerated.

## Round 3 — live testing against real data

Rounds 1 and 2 passed every deterministic test, the production build, and the
pilot health check. Signing in as a real user and asking real questions against
real repositories then found **five further defects**, three of which the offline
suites could not have caught. This section is the argument for treating live
testing as part of the definition of done.

### I. Word counts returned zero for every paper (severity: high)

The professor's own example, on real data:

```text
| Paper                                     | word count | words per paper |
| Development of English Oral Communication |          0 |               0 |
| **Total (5 papers)**                      |      **0** |           **0** |
```

The V2 execution planner, which is the live path in production, answers a
document-length question by putting meta phrases into `plan.terms` --
`["word count", "words per paper"]` -- and the term-frequency path counted those
literal phrases. The index was never wrong: the same repository separately
reported 26,339 words. The round-1 guard only ran in `fallbackPromptPlan`, which
production bypasses whenever the planner succeeds.

### J. The planner could also divert the question entirely (severity: high)

After fixing term selection, production still failed where the pilot succeeded,
because the planner is not deterministic. It chose `analyze_each_document`, so a
model was asked to count words in excerpts it could not see and answered, quite
correctly, that it could not. A question whose answer is stored exactly must not
depend on planner discretion. `runRepositoryChat` now answers it before dispatch.

Together with round 1, a document-length question could be diverted in three
places: intent detection, term selection, and operation choice. All three are now
closed.

### K. Citations rendered as a wall of bold titles (severity: medium)

An asynchronous corpus report cited five papers in a row, and each expanded to a
full bold title run together mid-paragraph. Adjacent markers now collapse into a
single parenthetical group, repeats appear once, long titles are shortened, and
an unknown year is omitted.

### L. Bridge edges violated a database constraint (severity: high, self-inflicted)

Round 1 stamped `rank: 0` on the links added to connect a neighborhood, but
`repository_semantic_edges` declares `CHECK (edge_rank > 0)`. Every map needing a
bridge failed to persist. The five-paper repository hid it, because its
neighborhoods were already connected and needed no bridges; only the 38-paper
repository exercised the path. This shipped to production in PR #29 and was fixed
in PR #32.

### M. A lone outlier became its own neighborhood (severity: medium)

The real 38-paper map was split **37 to 1**. `deterministicKMeans` seeds each new
centre with the point farthest from the existing centres, which reliably promotes
an outlier into a neighborhood of its own. That is a second, independent cause of
"clusters need to be separate", unrelated to the colour/position mismatch.
Neighborhoods below 5% of the repository, floor of two, now merge into their
nearest survivor.

## Measured on real repositories

The 38-paper repository `testtest`, before and after, read back from the live API:

| Metric | Before | After |
| --- | ---: | ---: |
| Neighborhood split | 37 / 1 | 35 / 3 |
| Papers drawn nearer another neighborhood's centre | 11 / 38 | 6 / 38 |
| Neighborhoods with no internal connection | 1 | 0 |
| Disconnected papers | 11 | 0 |
| Relationship lines | 26 | 41 (26 nearest + 15 bridges) |
| Canvas used | 840 x 640 | 920 x 720 |

The five-paper repository now resolves to a single neighborhood rather than a
4/1 split, which is the more honest reading of five topically similar EFL papers.

Word counts on real data, verified through `research-trend-analysis.web.app`:

```text
| Rhythmical Patterns in the Readings of Thai Learners... | Unknown | 8,754 |
| Effects of Personal Intelligence Reading Instruction... |    2016 | 6,150 |
| ปรากฎร่วมเชิงวิชาการสำหรับนิสิต...                        | Unknown | 6,091 |
| Enhancing Learner Autonomy amongst Young EFL Learners... |    2017 | 3,618 |
| Development of English Oral Communication...             | Unknown | 1,726 |
| **Total (5 papers)**                                     |         | **26,339** |
```

That total cross-checks exactly against the independent `inspect_scope` figure,
which is computed by a different code path. The Thai phrasing
`เอกสารในคลังนี้มีกี่คำ` returns the same table fully in Thai.

The asynchronous corpus-report path was also verified end to end: the job
reached `status: succeeded` at 5/5 and returned a substantive grounded report.

## Final state

- TypeScript suite: **175 passing** (from 120), 0 failing
- Python suite: **134 passing** (from 119), 0 failing
- Typecheck and production Next.js build clean
- Production web `papertrend-web-production-00022-d6w`, worker
  `papertrend-worker-production-00015-lg9`, both healthy, no errors in logs
- Direct Cloud Run and Firebase Hosting serve the same revision
- Live authenticated checks pass against both the pilot and production

## Still open

- **6 of 38 papers still measure as sitting nearer another neighborhood's
  centre.** With a 35/3 split this is partly an artefact of the metric on very
  unbalanced groups, and this corpus is topically homogeneous -- all EFL and
  assessment work, silhouette 0.148. No clustering produces clean separation from
  genuinely homogeneous data. A human visual check is the right next step.
- A **duplicate paper** appears in `testtest`: "Effects of a Learning-oriented
  Reading Assessment Model on Thai Undergraduate Students' Reading Ability"
  (2022) is listed twice with an identical 11,995-word count. This looks like
  the same file ingested twice rather than a counting defect, but it is worth
  confirming against the duplicate-detection rule.
- `SEMANTIC_MAP_PROJECTION_VERSION` is still unchanged. Both test repositories
  were regenerated manually; other repositories keep their old coordinates until
  someone regenerates them. Bumping it would force a rebuild everywhere.
- Deep research's provider and Thai fixes are covered by unit tests but have not
  been exercised against a live deep-research session.
