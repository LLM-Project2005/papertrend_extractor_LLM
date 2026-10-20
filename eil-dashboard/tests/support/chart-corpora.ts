/*
 * Synthetic collections of papers for the chart tests and the chart gallery
 * (docs/38). Deterministic: a shape always builds the same papers.
 *
 * They cover what a real repository can be - 1 paper or 5,000, one theme or
 * every theme its own, one year or gaps, undated papers, second uploads,
 * no research areas or many, very long names and Thai ones - so every view
 * is checked against the cases a reader will meet, not only the test
 * account's 41 papers.
 */
import type { CorpusInput, PaperProfile } from "../../src/lib/insights/corpus";
import type { CategoryAssignmentRow, PaperId, TrendRow } from "../../src/types/database";

export interface CorpusShape {
  name: string;
  papers: number;
  /** skewed: a few big themes; flat: every theme about as common; one: every paper the same theme; unique: no two papers share one. */
  themes: "skewed" | "flat" | "one" | "unique";
  /** spread: 2011-2025, more recent heavier; one: all 2024; gapped: five years far apart; some_undated: a fifth without a year; none: no years. */
  years: "spread" | "one" | "gapped" | "some_undated" | "none";
  /** Research areas; 0 turns classification off. */
  categories: number;
  labels?: "plain" | "long" | "thai";
  /** Second uploads of earlier papers, same title and year. */
  duplicates?: number;
  /** Kind of study, aims and contributions recorded. */
  profiles?: boolean;
}

const THEMES = [
  "Academic Writing", "Reading Comprehension", "Dynamic Assessment", "Speaking Fluency", "Vocabulary Learning",
  "Formative Assessment", "Global Englishes", "Teacher Feedback", "Learner Motivation", "Pronunciation",
  "Listening Strategies", "Translation", "Corpus Linguistics", "Pragmatics", "Washback", "Rater Training",
  "Discourse Analysis", "Language Policy", "Genre Pedagogy", "Online Learning", "Peer Review", "Grammar Instruction",
  "Intercultural Communication", "Test Validation", "Learner Autonomy", "Code-switching", "Literacy", "Extensive Reading",
];
const LONG_THEMES = [
  "The role of multimodal corrective feedback in second-language academic writing among first-year undergraduates",
  "Teacher beliefs and classroom practices in English-medium instruction at Thai public universities",
  "Validity arguments for locally developed English proficiency tests used for university admission",
  "Learner engagement with automated writing evaluation feedback across successive drafts",
  "Pragmatic competence in requests and refusals by intermediate learners of English",
  "Vocabulary size, depth and their relationship with reading comprehension in EFL contexts",
];
const THAI_THEMES = ["การประเมินแบบพลวัต", "การเขียนเชิงวิชาการ", "การอ่านจับใจความ", "ภาษาอังกฤษโลก", "แรงจูงใจของผู้เรียน", "การให้ผลป้อนกลับ"];
const METHODS = ["Survey", "Interviews", "Quasi-experiment", "Mixed methods", "Corpus analysis", "Classroom observation", "Think-aloud", "Case study"];
const CATEGORIES = [
  "English Linguistics", "English Language Instruction", "Language Assessment & Evaluation", "Applied Linguistics",
  "Translation Studies", "Literature", "Educational Technology", "Sociolinguistics", "Psycholinguistics", "Testing Policy", "Teacher Education",
];
const TYPES = ["Empirical", "Review", "Theoretical", "Methodological"];
const AIMS = ["investigate", "evaluate", "compare", "develop", "describe"];
const CONTRIBUTIONS = ["empirical findings", "instrument development", "pedagogical model", "framework", "review synthesis"];

/** A small, fast, seeded generator (mulberry32). */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(name: string): number {
  let hash = 2166136261;
  for (const char of name) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

/** Picks an index with weight 1/(rank+1)^power: a few common, a long tail. */
function zipf(next: () => number, size: number, power = 1.1): number {
  const weights = Array.from({ length: size }, (_, rank) => 1 / (rank + 1) ** power);
  let roll = next() * weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < size; index += 1) {
    roll -= weights[index];
    if (roll <= 0) return index;
  }
  return size - 1;
}

function themeNames(shape: CorpusShape): string[] {
  const base = shape.labels === "long" ? [...LONG_THEMES, ...THEMES] : shape.labels === "thai" ? [...THAI_THEMES, ...THEMES] : THEMES;
  // A big collection has more themes than the list: numbered ones extend it.
  const wanted = Math.max(base.length, Math.min(120, Math.round(Math.sqrt(shape.papers) * 3)));
  return [...base, ...Array.from({ length: Math.max(0, wanted - base.length) }, (_, index) => `${THEMES[index % THEMES.length]} ${Math.floor(index / THEMES.length) + 2}`)];
}

function yearFor(shape: CorpusShape, next: () => number, index: number): string {
  switch (shape.years) {
    case "one":
      return "2024";
    case "gapped":
      return String([2011, 2012, 2018, 2024, 2025][index % 5]);
    case "none":
      return "Unknown";
    case "some_undated":
      if (next() < 0.2) return "Unknown";
    // falls through
    default: {
      // More recent years are heavier, as in a growing field.
      const span = 15;
      const roll = Math.sqrt(next());
      return String(2011 + Math.min(span - 1, Math.floor(roll * span)));
    }
  }
}

export interface BuiltCorpusInput {
  input: CorpusInput;
  profiles: Map<PaperId, PaperProfile>;
  /** Paper titles by id, as the routes send them. */
  titles: Map<string, string>;
}

export function corpusInput(shape: CorpusShape): BuiltCorpusInput {
  const next = random(seedOf(shape.name));
  const themes = themeNames(shape);
  const trends: TrendRow[] = [];
  const categories: CategoryAssignmentRow[] = [];
  const profiles = new Map<PaperId, PaperProfile>();
  const titles = new Map<string, string>();
  const add = (paper: string, year: string, title: string, topic: string, kind: "topic" | "method") =>
    trends.push({ paper_id: paper, year, title, topic, topic_kind: kind, keyword: topic.toLowerCase(), keyword_frequency: 1, evidence: "" });

  const made: Array<{ id: string; year: string; title: string; rows: Array<[string, "topic" | "method"]>; category: string | null }> = [];
  for (let index = 0; index < shape.papers; index += 1) {
    const id = String(index + 1);
    const year = yearFor(shape, next, index);
    const own: string[] = [];
    if (shape.themes === "one") own.push(themes[0]);
    else if (shape.themes === "unique") own.push(`Topic ${index + 1}A`, `Topic ${index + 1}B`);
    else {
      const count = 1 + Math.floor(next() * 3);
      while (own.length < count) {
        const pick = shape.themes === "flat" ? Math.floor(next() * Math.min(themes.length, 12)) : zipf(next, themes.length);
        if (!own.includes(themes[pick])) own.push(themes[pick]);
      }
    }
    const methods = shape.themes === "unique" ? [`Method ${index + 1}`] : [METHODS[zipf(next, METHODS.length, 0.8)]];
    if (shape.themes !== "unique" && next() < 0.35) {
      const second = METHODS[Math.floor(next() * METHODS.length)];
      if (!methods.includes(second)) methods.push(second);
    }
    const title =
      shape.labels === "long"
        ? `A longitudinal mixed-methods investigation of ${own[0].toLowerCase()} among Thai university students, with implications for curriculum design (${index + 1})`
        : shape.labels === "thai"
          ? `การศึกษาเรื่อง${own[0]} ฉบับที่ ${index + 1}`
          : `${own[0]} study ${index + 1}`;
    const category = shape.categories > 0 ? CATEGORIES[Math.min(shape.categories - 1, zipf(next, shape.categories, 0.9))] : null;
    made.push({ id, year, title, rows: [...own.map((theme) => [theme, "topic"] as [string, "topic"]), ...methods.map((method) => [method, "method"] as [string, "method"])], category });
    if (shape.profiles !== false) {
      profiles.set(id, {
        typology: TYPES[zipf(next, TYPES.length, 1.4)],
        aims: [AIMS[Math.floor(next() * AIMS.length)]],
        contributions: [CONTRIBUTIONS[zipf(next, CONTRIBUTIONS.length, 1)]],
        authorKeywords: [],
        yearConfidence: 0.95,
      });
    }
  }
  // Second uploads: the same title and year as an earlier paper.
  for (let copy = 0; copy < (shape.duplicates ?? 0) && copy < made.length; copy += 1) {
    const original = made[copy];
    made.push({ ...original, id: String(shape.papers + copy + 1) });
  }
  for (const paper of made) {
    titles.set(paper.id, paper.title);
    for (const [topic, kind] of paper.rows) add(paper.id, paper.year, paper.title, topic, kind);
    if (paper.category) {
      categories.push({
        paper_id: paper.id,
        year: paper.year,
        title: paper.title,
        category_key: paper.category.toLowerCase().replace(/[^a-z]+/g, "_"),
        category_label: paper.category,
        assignment_type: "single",
      });
    }
  }
  return { input: { trends, categoryAssignments: categories, classificationEnabled: shape.categories > 0 }, profiles, titles };
}

/** Every collection the tests run each view against. */
export const SHAPES: CorpusShape[] = [
  { name: "empty", papers: 0, themes: "skewed", years: "spread", categories: 3 },
  { name: "one paper", papers: 1, themes: "skewed", years: "spread", categories: 3 },
  { name: "two papers", papers: 2, themes: "skewed", years: "spread", categories: 3 },
  { name: "three papers", papers: 3, themes: "skewed", years: "spread", categories: 3 },
  { name: "five papers, flat", papers: 5, themes: "flat", years: "spread", categories: 2 },
  { name: "six papers (the EIL pipeline check)", papers: 6, themes: "skewed", years: "spread", categories: 3 },
  { name: "six papers, every theme unique", papers: 6, themes: "unique", years: "spread", categories: 3 },
  { name: "seven papers, one year", papers: 7, themes: "skewed", years: "one", categories: 3 },
  { name: "eight papers", papers: 8, themes: "skewed", years: "spread", categories: 3 },
  { name: "twelve papers, gapped years", papers: 12, themes: "skewed", years: "gapped", categories: 3 },
  { name: "twenty papers, one theme", papers: 20, themes: "one", years: "spread", categories: 3 },
  { name: "thirty-six papers (the test account)", papers: 36, themes: "skewed", years: "spread", categories: 3, duplicates: 5 },
  { name: "sixty papers, no research areas", papers: 60, themes: "skewed", years: "some_undated", categories: 0 },
  { name: "sixty papers, long names", papers: 60, themes: "skewed", years: "spread", categories: 3, labels: "long" },
  { name: "forty papers, Thai names", papers: 40, themes: "skewed", years: "spread", categories: 3, labels: "thai" },
  { name: "150 papers, flat", papers: 150, themes: "flat", years: "spread", categories: 5 },
  { name: "150 papers, undated", papers: 150, themes: "skewed", years: "none", categories: 4 },
  { name: "500 papers, many areas", papers: 500, themes: "skewed", years: "spread", categories: 11 },
  { name: "1,500 papers", papers: 1500, themes: "skewed", years: "spread", categories: 6, duplicates: 20 },
  { name: "5,000 papers", papers: 5000, themes: "skewed", years: "spread", categories: 8 },
];
