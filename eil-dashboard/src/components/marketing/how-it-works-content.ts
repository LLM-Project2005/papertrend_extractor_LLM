/*
 * The words of the How it works page that name parts of the system, kept apart
 * from the layout so tests can hold them to the code:
 *  - the topic stages and the analysis steps they cover: graphs.py
 *    (build_ingestion_graph), nodes/keyword_extractor.py, keyword_grouper.py,
 *    topic_labeler.py;
 *  - agreement across papers: src/lib/topic-themes.ts (CONSENSUS_RUNS,
 *    CONSENSUS_AGREEMENT) and topic-theme-service.ts;
 *  - the chat trace, the planner's operations and the whole-repository flow:
 *    src/lib/repository-chat.ts and docs/33.
 * The page was first drawn as six agents. The product runs thirteen steps, so
 * the six are told as stages, each naming the steps it stands for.
 */

export type TopicStageKey = "read" | "find" | "group" | "name" | "check" | "agree";

export interface TopicStage {
  key: TopicStageKey;
  name: string;
  role: string;
  /** The analysis steps (graph nodes) this stage stands for; none for one that is not a step of its own. */
  steps: string[];
}

export const TOPIC_STAGES: TopicStage[] = [
  { key: "read", name: "Read", role: "Text, sections, and a translation if needed", steps: ["extract", "clean", "translate", "segment"] },
  { key: "find", name: "Find", role: "Exact phrases from the paper, counted", steps: ["mine_keywords", "extract_author_keywords"] },
  { key: "group", name: "Group", role: "Phrases into topics, with their sentences", steps: ["group_topics"] },
  { key: "name", name: "Name", role: "A short name for each topic", steps: ["label_trends"] },
  // Runs inside find, group and name, and at the save: code, not a step of its own.
  { key: "check", name: "Check", role: "Rules run by code, not a model", steps: [] },
  // Runs on the dashboard, across every paper's topics.
  { key: "agree", name: "Agree", role: "Themes across papers, where passes agree", steps: [] },
];

/** The analysis steps that run beside the topic stages, and the save. */
export const ALONGSIDE_STEPS = ["metadata", "extract_facets", "classify_tracks", "classify_typology"];
export const SAVE_STEP = "build_dataset";
export const ANALYSIS_STEP_COUNT = TOPIC_STAGES.flatMap((stage) => stage.steps).length + ALONGSIDE_STEPS.length + 1;

/** The hero's status line for each stage. */
export const STAGE_STATUS: Record<TopicStageKey, string> = {
  read: "text, sections, and a translation if it is Thai",
  find: "exact phrases, each found in the paper and counted",
  group: "every phrase into one topic, with its sentences",
  name: "two to five words, all different",
  check: "rules run by code, not by a model",
  agree: "themes kept where two of three groupings agree",
};

/** The phrases the sample paper's stages work with (the invented Semarang paper). */
export const SAMPLE_PHRASES: Array<{ phrase: string; count: number; kind: "subject" | "method" }> = [
  { phrase: "mangrove cover", count: 14, kind: "subject" },
  { phrase: "seawall", count: 11, kind: "subject" },
  { phrase: "flood exposure", count: 9, kind: "subject" },
  { phrase: "mangrove restoration", count: 8, kind: "subject" },
  { phrase: "land subsidence", count: 7, kind: "subject" },
  { phrase: "community participation", count: 6, kind: "subject" },
  { phrase: "risk perception", count: 5, kind: "subject" },
  { phrase: "trade-offs", count: 3, kind: "subject" },
  { phrase: "household survey", count: 4, kind: "method" },
];

/** The sample paper's topics, each with its member phrases and one sentence of evidence. */
export const SAMPLE_TOPICS: Array<{ name: string; kind: "subject" | "method"; phrases: string[]; evidence: string; mark: string }> = [
  {
    name: "Mangrove restoration",
    kind: "subject",
    phrases: ["mangrove restoration", "mangrove cover", "community participation"],
    evidence: "Community participation in replanting was strongest where fishing groups kept the right to harvest shellfish.",
    mark: "Community participation",
  },
  {
    name: "Seawall trade-offs",
    kind: "subject",
    phrases: ["seawall", "trade-offs", "risk perception"],
    evidence: "Residents valued the seawall for the certainty it gave, but most expected it to need raising again within fifteen years.",
    mark: "seawall",
  },
  {
    name: "Coastal land subsidence",
    kind: "subject",
    phrases: ["land subsidence", "flood exposure"],
    evidence: "Land subsidence, driven by groundwater extraction, doubled the area flooded by ordinary spring tides.",
    mark: "Land subsidence",
  },
  {
    name: "Household surveys",
    kind: "method",
    phrases: ["household survey"],
    evidence: "We surveyed 412 households in six coastal neighbourhoods between March and June 2021.",
    mark: "surveyed 412 households",
  },
];

/** Pairs of topics from different papers, and how many of three groupings put them together. */
export const SAMPLE_MERGES: Array<{ left: string; right: string; votes: [boolean, boolean, boolean] }> = [
  { left: "mangrove replanting", right: "restored mangrove belts", votes: [true, true, true] },
  { left: "inundation mapping", right: "flood exposure maps", votes: [true, true, true] },
  { left: "planned relocation", right: "managed retreat", votes: [true, false, true] },
  { left: "seawall upkeep", right: "managed retreat", votes: [false, true, false] },
];

/** What happens to one focused question, in order (repository-chat.ts; docs/33). */
export const CHAT_TRACE: Array<{
  title: string;
  detail?: string;
  model?: string;
  parallel?: boolean;
  loop?: boolean;
  log: { tag: string; text: string };
}> = [
  {
    title: "Check the request",
    detail: "Signed in, within the daily limit, fewer than two answers in progress.",
    model: "code",
    log: { tag: "gate", text: "signed in · within today’s limit · 0 of 2 answers in progress" },
  },
  {
    title: "Load the papers, check for a repeat",
    detail: "Only papers whose analysis finished. The same question about the same papers within 30 minutes comes back at once.",
    model: "code",
    log: { tag: "scope", text: "41 analysed papers · not asked in the last 30 minutes" },
  },
  {
    title: "Plan",
    detail: "One to four operations, the search phrases, and the language to answer in.",
    model: "GPT-6 Luna · brief",
    log: { tag: "plan", text: "search_evidence · phrases: mangroves, seawalls, flood damage · answer in English" },
  },
  {
    title: "Two searches at once",
    parallel: true,
    model: "text-embedding-3-small",
    log: { tag: "search", text: "words ∥ meaning → two rankings merged" },
  },
  {
    title: "Choose the papers",
    detail: "The merged ranking’s strongest candidates are read side by side; up to 10 papers are kept.",
    model: "GPT-6 Luna · brief",
    log: { tag: "choose", text: "48 candidates · 24 read closely · 6 kept" },
  },
  {
    title: "Is it enough?",
    detail: "Checked before any writing starts.",
    loop: true,
    model: "GPT-6 Luna · brief",
    log: { tag: "enough", text: "yes · no second search needed" },
  },
  {
    title: "Write from the passages",
    detail: "Only from the chosen passages, with a numbered source on every claim. Code confirms each source is a paper that was read.",
    model: "GPT-6 Luna",
    log: { tag: "write", text: "draft cites [1]–[3] · each one a paper that was read" },
  },
  {
    title: "Check the draft, when in doubt",
    detail:
      "Runs on every whole-repository answer and on any draft that is less than certain. A claim that says more than its source is corrected or removed.",
    model: "GPT-6 Luna",
    log: { tag: "check", text: "draft less than certain → read beside its sources · 1 sentence narrowed" },
  },
  {
    title: "Deliver",
    detail: "Numbered sources, source cards, a coverage line, and a note on anything that could not be checked.",
    log: { tag: "done", text: "Based on 3 of 41 papers" },
  },
];

/** The planner's operations (RepositoryOperation in repository-chat.ts), in plain words. */
export const PLANNER_OPERATIONS: Array<{ key: string; when: string; how: string; model: "model" | "small model" | "no model" }> = [
  { key: "converse", when: "A greeting, or a question not about the papers", how: "A short reply, marked “Repository context not used”.", model: "model" },
  { key: "inspect_scope", when: "What is in scope: how many papers, which years", how: "Counted from the stored analysis.", model: "no model" },
  { key: "list_documents", when: "Which papers, the oldest, the newest", how: "Listed from the stored analysis, every paper cited.", model: "no model" },
  { key: "analyze_text", when: "How often a word or phrase appears", how: "Counted in the stored text.", model: "no model" },
  { key: "search_evidence", when: "A focused question", how: "Search, choose, write from the passages, check when in doubt.", model: "model" },
  { key: "analyze_each_document", when: "“Summarise each paper”", how: "A short analysis of every paper, a batch at a time.", model: "model" },
  { key: "aggregate_corpus", when: "A question about the whole repository", how: "One answer from every paper, with exact counts.", model: "model" },
  { key: "visualize", when: "A chart, in Chart mode", how: "A small model picks the measures; code computes every number.", model: "small model" },
];

/** A whole-repository question, split and combined (docs/33, section 5). */
export const SPLIT_COMBINE: Array<{ title: string; detail: string }> = [
  { title: "Every analysed paper", detail: "Title, year, topics, abstract, methods, results and conclusion." },
  { title: "Groups of ten", detail: "So each call stays well within what a model can read at once." },
  { title: "A summary per group", detail: "Written side by side, one for each group." },
  { title: "Exact counts, by code", detail: "Themes, methods and keywords, grouped as the dashboard groups them." },
  { title: "One answer", detail: "Written from every summary and the counts." },
  { title: "Checked, then delivered", detail: "Read against the summaries and counts; papers cited by title." },
];
