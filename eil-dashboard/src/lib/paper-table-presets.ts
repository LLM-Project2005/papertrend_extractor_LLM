/*
 * The paper table's ready-made columns (docs/42), grouped as a review reads a
 * study: its design, who took part, where, what was done, how it was measured,
 * what it found and where it was published. The reader ticks the ones to show,
 * as in an analytics dashboard's column picker; each is an ordinary column once
 * added, so its name and instruction can be changed.
 *
 * Kinds: "number" is checked against the sentence it comes with; "category" is
 * a short label (one to four words, the same wording across papers) that the
 * chart above the table can count; "text" is anything longer.
 */
import type { ColumnKind } from "@/lib/paper-table";

export interface ColumnPreset {
  /** Stored on the column, so the picker knows which ready-made columns a table has. */
  key: string;
  name: string;
  instruction: string;
  kind: ColumnKind;
}

export interface ColumnPresetGroup {
  id: string;
  label: string;
  columns: ColumnPreset[];
}

export const COLUMN_PRESET_GROUPS: ColumnPresetGroup[] = [
  {
    id: "design",
    label: "Study design",
    columns: [
      { key: "aim", name: "Aim", instruction: "The study's aim or main research question, in one sentence.", kind: "text" },
      { key: "research-questions", name: "Research questions", instruction: "The research questions or hypotheses, briefly.", kind: "text" },
      { key: "methodology", name: "Methodology", instruction: "Quantitative, qualitative or mixed methods.", kind: "category" },
      {
        key: "research-design",
        name: "Research design",
        instruction: "The design in a few words, e.g. quasi-experimental, experimental, case study, survey, action research, corpus study, correlational.",
        kind: "category",
      },
      { key: "theory", name: "Theoretical framework", instruction: "The theory or framework the study draws on.", kind: "text" },
      { key: "variables", name: "Variables", instruction: "The independent and dependent variables, if the study has them.", kind: "text" },
    ],
  },
  {
    id: "participants",
    label: "Participants",
    columns: [
      { key: "participants", name: "Participants", instruction: "Who took part and how many in all, e.g. '60 Thai EFL undergraduates'.", kind: "text" },
      { key: "sample-size", name: "Sample size", instruction: "The total number of participants in the study.", kind: "number" },
      {
        key: "education-level",
        name: "Education level",
        instruction: "The participants' level: primary, secondary, undergraduate, graduate, teachers or adults.",
        kind: "category",
      },
      { key: "age", name: "Age", instruction: "The participants' age or age range.", kind: "text" },
      { key: "proficiency", name: "Proficiency level", instruction: "The participants' language proficiency, and how it was measured.", kind: "text" },
      { key: "first-language", name: "First language", instruction: "The participants' first language.", kind: "category" },
      { key: "gender", name: "Gender", instruction: "How many participants were female and how many male.", kind: "text" },
      { key: "sampling", name: "Sampling method", instruction: "How the participants were chosen, e.g. purposive, random, convenience, stratified.", kind: "category" },
      { key: "groups", name: "Groups", instruction: "The groups compared and how many were in each.", kind: "text" },
    ],
  },
  {
    id: "setting",
    label: "Setting",
    columns: [
      { key: "country", name: "Country", instruction: "The country where the study took place, by its common English name.", kind: "category" },
      {
        key: "institution",
        name: "Institution type",
        instruction: "The kind of institution, e.g. public university, private university, secondary school, primary school, language institute.",
        kind: "category",
      },
      { key: "setting", name: "Setting", instruction: "The country and the kind of school or university where the study took place.", kind: "text" },
      { key: "learning-context", name: "Learning context", instruction: "EFL, ESL, EMI, CLIL or another language learning context.", kind: "category" },
      { key: "target-language", name: "Target language", instruction: "The language being learned or studied.", kind: "category" },
      { key: "course", name: "Course or subject", instruction: "The course, subject or programme the study was part of.", kind: "text" },
    ],
  },
  {
    id: "intervention",
    label: "Intervention",
    columns: [
      { key: "intervention", name: "Intervention", instruction: "The teaching approach, treatment or programme tested.", kind: "text" },
      { key: "comparison", name: "Comparison group", instruction: "What the intervention was compared with, e.g. a control group taught as usual.", kind: "text" },
      { key: "duration", name: "Duration", instruction: "How long the study or its intervention lasted.", kind: "text" },
      { key: "sessions", name: "Number of sessions", instruction: "How many sessions or lessons the intervention had.", kind: "number" },
      { key: "materials", name: "Materials and technology", instruction: "The materials, tools or technology used in the teaching.", kind: "text" },
      { key: "skill", name: "Skill focus", instruction: "The language skill or area studied, e.g. reading, writing, speaking, listening, vocabulary, grammar, pronunciation.", kind: "category" },
    ],
  },
  {
    id: "data",
    label: "Data and analysis",
    columns: [
      { key: "instruments", name: "Instruments", instruction: "The tests, questionnaires, interviews or other instruments used to collect data.", kind: "text" },
      { key: "data-collection", name: "Data collection", instruction: "How the data were collected, e.g. tests, questionnaires, interviews, observation, recordings.", kind: "text" },
      { key: "data-analysis", name: "Data analysis", instruction: "How the data were analysed, e.g. t-test, ANOVA, regression, thematic analysis.", kind: "text" },
      { key: "statistical-tests", name: "Statistical tests", instruction: "The statistical tests used, by name.", kind: "text" },
      { key: "reliability", name: "Reliability and validity", instruction: "How the instruments' reliability or validity was checked, with any coefficient (e.g. Cronbach's alpha = .85).", kind: "text" },
      { key: "software", name: "Software", instruction: "The software used for the analysis, e.g. SPSS, NVivo, R, AntConc, Praat.", kind: "category" },
      { key: "corpus-size", name: "Corpus or text size", instruction: "The size of the corpus or the texts analysed, in words or texts.", kind: "text" },
    ],
  },
  {
    id: "results",
    label: "Results",
    columns: [
      { key: "main-finding", name: "Main finding", instruction: "The study's main finding, in one sentence.", kind: "text" },
      { key: "key-statistics", name: "Key statistics", instruction: "The statistics of the main result, e.g. means, t or F values and p values.", kind: "text" },
      { key: "effect-size", name: "Effect size", instruction: "The effect size reported for the main result, with its measure (e.g. d = 0.82, η2 = .14).", kind: "text" },
      {
        key: "outcome",
        name: "Outcome",
        instruction: "Whether the intervention or main factor helped: improved, no significant difference, mixed, or worse. 'Not applicable' for a study with no intervention.",
        kind: "category",
      },
      { key: "attitudes", name: "Attitudes and perceptions", instruction: "What the participants thought or felt about the teaching or the topic.", kind: "text" },
      { key: "limitations", name: "Limitations", instruction: "The limitations the authors state.", kind: "text" },
      { key: "implications", name: "Implications", instruction: "The implications for teaching or practice the authors draw.", kind: "text" },
      { key: "future-research", name: "Future research", instruction: "The further research the authors suggest.", kind: "text" },
    ],
  },
  {
    id: "publication",
    label: "Publication",
    columns: [
      { key: "publication-type", name: "Publication type", instruction: "Journal article, thesis, conference paper or book chapter.", kind: "category" },
      { key: "venue", name: "Journal or venue", instruction: "The journal, conference or university where it was published.", kind: "text" },
      { key: "authors", name: "Authors", instruction: "The authors' names, as printed.", kind: "text" },
      { key: "affiliation", name: "Affiliation", instruction: "The authors' universities or institutions.", kind: "text" },
      { key: "funding", name: "Funding", instruction: "Who funded the study, if the paper says.", kind: "text" },
    ],
  },
];

export const COLUMN_PRESETS: ColumnPreset[] = COLUMN_PRESET_GROUPS.flatMap((group) => group.columns);

/** Ready-made sets a new table can start from. */
export const STARTER_SETS: Array<{ id: string; label: string; description: string; keys: string[] }> = [
  {
    id: "overview",
    label: "Study overview",
    description: "Participants, sample size, setting, design and the main finding.",
    keys: ["participants", "sample-size", "setting", "research-design", "main-finding"],
  },
  {
    id: "methods",
    label: "Methods",
    description: "Methodology, design, sampling, instruments, data collection and analysis.",
    keys: ["methodology", "research-design", "sampling", "instruments", "data-collection", "data-analysis"],
  },
  {
    id: "intervention",
    label: "Intervention studies",
    description: "Intervention, comparison group, duration, sample size, outcome and effect size.",
    keys: ["intervention", "comparison", "duration", "sample-size", "outcome", "effect-size"],
  },
  {
    id: "results",
    label: "Results and implications",
    description: "Main finding, key statistics, effect size, limitations and implications.",
    keys: ["main-finding", "key-statistics", "effect-size", "limitations", "implications"],
  },
  { id: "empty", label: "Empty", description: "No columns yet; choose them after.", keys: [] },
];
