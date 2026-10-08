/*
 * The invented research collection the feature pages' demos are drawn from.
 *
 * It is the same "Coastal Adaptation Review" the product clips were recorded
 * with (scripts/marketing-mock/fixtures.json): 41 papers, 2011 to 2025, three
 * custom categories, and the Semarang paper the clips open. Keeping one world
 * means a reader who watches a clip and then plays with a demo sees the same
 * papers, themes and numbers. No real paper or person appears here.
 */

export const DEMO_REPOSITORY = "Coastal Adaptation Review";
export const DEMO_PAPER_COUNT = 41;

/** Papers per publication year in the collection (fixtures: 41 papers). */
export const DEMO_YEARS: Array<{ year: number; papers: number }> = [
  { year: 2011, papers: 1 },
  { year: 2012, papers: 2 },
  { year: 2013, papers: 1 },
  { year: 2014, papers: 0 },
  { year: 2015, papers: 0 },
  { year: 2016, papers: 0 },
  { year: 2017, papers: 3 },
  { year: 2018, papers: 2 },
  { year: 2019, papers: 2 },
  { year: 2020, papers: 3 },
  { year: 2021, papers: 3 },
  { year: 2022, papers: 10 },
  { year: 2023, papers: 5 },
  { year: 2024, papers: 5 },
  { year: 2025, papers: 4 },
];

/** The paper the clips open: its own words, as the analysis read them. */
export const DEMO_PAPER = {
  title: "Mangroves and seawalls: household choices in Semarang",
  journalLine: "Ocean & Coastal Management 214 (2022)",
  received: "Received 14 October 2021 · Accepted 2 May 2022",
  abstract:
    "Semarang is sinking faster than the sea is rising. This study asks how households choose between hard defences and restored mangroves, and what each choice costs them.",
  authorKeywords: ["mangrove restoration", "seawalls", "land subsidence", "household survey"],
  methods:
    "We surveyed 412 households in six coastal neighbourhoods between March and June 2021, and interviewed 24 residents, village officials and fishing groups.",
  result:
    "Households living within 500 metres of restored mangrove cover reported 38 percent less flood damage than those behind the seawall.",
  conclusion:
    "Mangroves and seawalls are not alternatives but partners: the wall buys time while the mangroves grow.",
  category: "Adaptation strategies",
  categoryReason: "Its main contribution compares two ways of adapting to flooding, shown in its survey design and findings.",
  researchType: "Empirical · mixed methods",
  topics: ["Mangrove restoration", "Seawall trade-offs", "Coastal land subsidence", "Household surveys"],
};

export interface DemoCitation {
  n: number;
  title: string;
  year: number;
  /** The sentence in the paper the claim rests on. */
  quote: string;
}

export const DEMO_QUESTION = "Do mangroves or seawalls reduce flood damage more?";

export const DEMO_CITATIONS: DemoCitation[] = [
  {
    n: 1,
    title: "Mangroves and seawalls: household choices in Semarang",
    year: 2022,
    quote:
      "Households living within 500 metres of restored mangrove cover reported 38 percent less flood damage than those behind the seawall.",
  },
  {
    n: 2,
    title: "Nature-based coastal defence: a study of Bangkok",
    year: 2022,
    quote:
      "In districts with no room for planting, the seawall was the only defence that held, though its upkeep cost the city more each year.",
  },
  {
    n: 3,
    title: "Rethinking coastal land subsidence in Colombo",
    year: 2013,
    quote:
      "Where groundwater extraction continued, both the wall and the mangrove belt protected less each year as the land beneath them sank.",
  },
];

/** The answer, sentence by sentence, each with the paper it rests on. */
export const DEMO_ANSWER: Array<{ text: string; cite: number }> = [
  { text: "Where there was room for them, restored mangroves cut flood damage more than seawalls: about 38 percent less in Semarang.", cite: 1 },
  { text: "In dense districts with no space for planting, seawalls gave the surest protection, at a higher upkeep cost.", cite: 2 },
  { text: "Where the land is sinking, both protect less each year unless groundwater pumping is controlled.", cite: 3 },
];

/** Themes with the different names papers gave them, for the grouping demo. */
export const DEMO_THEMES: Array<{ theme: string; papers: number; spellings: string[] }> = [
  {
    theme: "Mangrove restoration",
    papers: 7,
    spellings: ["mangrove replanting", "restored mangrove belts", "community mangrove management"],
  },
  {
    theme: "Coastal flood risk mapping",
    papers: 7,
    spellings: ["inundation mapping", "flood exposure maps", "coastal flood risk"],
  },
  {
    theme: "Managed retreat",
    papers: 6,
    spellings: ["planned relocation", "managed retreat", "resettlement from the coast"],
  },
];

export const DEMO_CATEGORIES = [
  { key: "adaptation", label: "Adaptation strategies" },
  { key: "governance", label: "Governance and finance" },
  { key: "hazards", label: "Hazards and risk" },
] as const;

/** The sample papers by year, for the drilldown demo; counts match DEMO_YEARS. */
export const DEMO_PAPERS_BY_YEAR: Record<number, string[]> = {
  2011: ["Storm surge records and early warning in Ho Chi Minh City"],
  2012: ["Rethinking estuary sediment dynamics in the Bay of Bengal", "Salinity intrusion and rice farming in Hoi An"],
  2013: ["Green infrastructure under rising seas in the Mekong Delta"],
  2017: [
    "Blue carbon under rising seas in Mombasa",
    "Coastal squeeze and wetland loss in Durban",
    "Who benefits from managed retreat? Lessons from the Mekong Delta",
  ],
  2018: ["Adaptation policy evaluation: a study of Rotterdam", "Sea-level rise projections for Kochi"],
  2019: ["Measuring household flood losses across Chittagong", "Measuring urban drainage design across Miami"],
  2020: [
    "How green infrastructure shapes managed retreat: evidence from Kochi",
    "Mangrove restoration and household choices in Suva",
    "Measuring coastal flood risk mapping across Suva",
  ],
  2021: [
    "Informal settlements and flooding: a study of Semarang",
    "Managed retreat and household choices in Bangkok",
    "Rethinking transboundary river deltas in Mombasa",
  ],
  2022: [
    "Mangroves and seawalls: household choices in Semarang",
    "Critical infrastructure risk: a study of Jakarta",
    "Mangrove restoration: a study of Durban",
    "Coastal tourism resilience and household choices in Hoi An",
    "Measuring coastal tourism resilience across Venice",
    "Nature-based coastal defence: a study of Bangkok",
    "Nature-based coastal defence and flood risk mapping in Jakarta",
    "Urban heat islands under rising seas in Guayaquil",
    "Urban heat islands under rising seas in Manila",
    "Who benefits from early warning systems? Lessons from Chittagong",
  ],
  2023: [
    "Climate justice in cities: a study of Rotterdam",
    "Nature-based coastal defence: a study of Ho Chi Minh City",
    "Rethinking coastal flood risk mapping in Dhaka",
    "Who benefits from mangrove restoration? Lessons from Lagos",
    "Who benefits from stormwater management? Lessons from Manila",
  ],
  2024: [
    "Heat-health action plans under rising seas in Dhaka",
    "Managed retreat and household choices in Miami",
    "Measuring blue carbon across Lagos",
    "Port and harbour adaptation and mangrove restoration in Bangkok",
    "Port and harbour adaptation: a study of Dar es Salaam",
  ],
  2025: [
    "Green infrastructure and managed retreat in the Pearl River Delta",
    "Heat-health action plans and household choices in New Orleans",
    "Urban heat islands: a study of Colombo",
    "Who benefits from urban tree canopy? Lessons from Alexandria",
  ],
};
