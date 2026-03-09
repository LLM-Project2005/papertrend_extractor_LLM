/* ────────────────────────────────────────────────────────────────
   Mock-data generator — mirrors the Python generate_mock_data()
   ──────────────────────────────────────────────────────────────── */

import { TrendRow, TrackRow, DashboardData } from "@/types/database";

// ─── Simple seeded PRNG (mulberry32) ───────────────────────────
class Rand {
  private s: number;
  constructor(seed = 42) {
    this.s = seed;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number) {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  choice<T>(a: T[]): T {
    return a[Math.floor(this.next() * a.length)];
  }
  sample<T>(a: T[], n: number): T[] {
    const s = [...a];
    for (let i = s.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [s[i], s[j]] = [s[j], s[i]];
    }
    return s.slice(0, Math.min(n, s.length));
  }
  weighted<T>(items: T[], weights: number[]): T {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }
}

// ─── Data pools ────────────────────────────────────────────────
const YEARS = Array.from({ length: 11 }, (_, i) => String(2015 + i));

const TOPICS = [
  "Translanguaging Pedagogy",
  "L2 Writing Assessment",
  "Intercultural Communication",
  "English as a Lingua Franca",
  "Critical Discourse Analysis",
  "Computer-Assisted Language Learning",
  "World Englishes Attitudes",
  "Pragmatic Competence",
  "Teacher Identity Development",
  "Corpus-Based Analysis",
  "Multilingual Education",
  "Language Policy",
  "Learner Autonomy",
  "Sociolinguistic Variation",
  "Vocabulary Acquisition Strategies",
];

const KEYWORDS = [
  "Translanguaging",
  "Communicative Competence",
  "L2 Motivation",
  "Discourse Analysis",
  "ELF",
  "Writing Proficiency",
  "Washback Effect",
  "Code-Switching",
  "Language Attitudes",
  "Pragmatic Transfer",
  "Self-Regulated Learning",
  "CEFR",
  "Task-Based Learning",
  "Formative Assessment",
  "Peer Feedback",
  "Reading Comprehension",
  "Intelligibility",
  "World Englishes",
  "Classroom Interaction",
  "Digital Literacy",
  "Language Ideology",
  "Speech Acts",
  "Corrective Feedback",
  "Test Validity",
  "Multimodal Communication",
  "Language Socialization",
  "Content and Language Integrated Learning",
  "Oral Proficiency",
  "Genre Analysis",
  "Native-Speakerism",
];

const TITLES = [
  "Translanguaging Practices in Thai EFL Classrooms",
  "Assessing L2 Writing: A Mixed-Methods Approach",
  "The Impact of Peer Feedback on Writing Proficiency",
  "Investigating Teacher Identity in Multilingual Contexts",
  "A Corpus-Based Study of Lexical Bundles in Academic Writing",
  "ELF Communication Strategies Among ASEAN University Students",
  "Washback Effects of Standardized Testing on Thai EFL Instruction",
  "Digital Literacy and Language Learning in Higher Education",
  "Pragmatic Competence Development in Study Abroad Contexts",
  "Critical Discourse Analysis of Language Policy Documents",
  "World Englishes Attitudes Among Thai Pre-Service Teachers",
  "Code-Switching Patterns in Bilingual Classroom Discourse",
  "Task-Based Language Teaching in the Thai University Context",
  "Formative Assessment Practices in EFL Writing Courses",
  "L2 Motivation and Self-Regulated Learning Strategies",
  "Intercultural Communication in International Business Settings",
  "Computer-Assisted Pronunciation Training Effectiveness",
  "Language Socialization in Multilingual Academic Communities",
  "Validating a New Rubric for Oral Presentation Assessment",
  "Vocabulary Acquisition Through Extensive Reading Programs",
  "Sociolinguistic Variation in Thai English Varieties",
  "Genre Analysis of Research Article Introductions",
  "Corrective Feedback Preferences in Online Learning",
  "Multimodal Communication in ELF Academic Settings",
  "Native-Speakerism and Its Impact on Teacher Hiring",
  "Speech Act Realization Across Cultures: A Comparative Study",
  "Language Attitudes Toward Non-Native English Teachers",
  "Reading Comprehension Strategy Instruction in EFL",
  "Content and Language Integrated Learning in Thai Schools",
  "Learner Autonomy in Online Language Learning Environments",
];

// ─── Generator ─────────────────────────────────────────────────
export function generateMockData(): DashboardData {
  const rng = new Rand(42);

  // 1. Build trends (keyword-level rows)
  const trends: TrendRow[] = [];
  let paperId = 1;

  for (const year of YEARS) {
    const nPapers = rng.int(2, 6);
    const titles = rng.sample(TITLES, nPapers);

    for (const title of titles) {
      const nKws = rng.int(3, 6);
      const paperTopics = rng.sample(TOPICS, rng.int(1, 3));
      const paperKws = rng.sample(KEYWORDS, nKws);

      for (const kw of paperKws) {
        trends.push({
          paper_id: paperId,
          year,
          title,
          topic: rng.choice(paperTopics),
          keyword: kw,
          keyword_frequency: rng.int(1, 12),
          evidence: `The study examines ${kw.toLowerCase()} in the context of language education.`,
        });
      }
      paperId++;
    }
  }

  // 2. Build single-choice track rows
  const uniquePaperIds = [...new Set(trends.map((r) => r.paper_id))];
  const tracksSingle: TrackRow[] = [];

  for (const pid of uniquePaperIds) {
    const row = trends.find((r) => r.paper_id === pid)!;
    const choice = rng.weighted(
      ["EL", "ELI", "LAE", "Other"],
      [25, 40, 25, 10]
    );
    tracksSingle.push({
      paper_id: pid,
      year: row.year,
      title: row.title,
      el: choice === "EL" ? 1 : 0,
      eli: choice === "ELI" ? 1 : 0,
      lae: choice === "LAE" ? 1 : 0,
      other: choice === "Other" ? 1 : 0,
    });
  }

  // 3. Build multi-label track rows (copy single + randomly add extra)
  const tracksMulti: TrackRow[] = tracksSingle.map((r) => {
    const row = { ...r };
    if (rng.next() < 0.3) {
      const off = (["el", "eli", "lae"] as const).filter(
        (t) => row[t] === 0
      );
      if (off.length > 0) row[rng.choice(off)] = 1;
    }
    return row;
  });

  return { trends, tracksSingle, tracksMulti, useMock: true };
}
