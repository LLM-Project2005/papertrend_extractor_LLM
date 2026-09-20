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
