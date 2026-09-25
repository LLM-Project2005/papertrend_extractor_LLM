/**
 * Who took part in a study, as opposed to what it studied.
 *
 * Papers analysed before the keyword step stopped extracting participant
 * groups carry keywords like "Thai EFL undergraduate students". Grouped into
 * themes they formed "EFL Learner Characteristics and Demographics", covering
 * 29 of testtest's 39 papers and saying nothing about any of them. They are
 * left out when topics are built, so stored papers read correctly without
 * being analysed again.
 *
 * A phrase is a participant descriptor when its head noun - the last word in
 * English - names people: "learner autonomy" and "EFL learners' writing" are
 * subjects, "Thai EFL learners" is not. The same list lives in
 * nodes/participants.py; a test keeps the two equal.
 */
export const PERSON_NOUNS = new Set([
  "adolescent",
  "adult",
  "child",
  "children",
  "examinee",
  "freshman",
  "freshmen",
  "graduate",
  "instructor",
  "learner",
  "lecturer",
  "participant",
  "people",
  "pupil",
  "respondent",
  "speaker",
  "student",
  "teacher",
  "test-taker",
  "trainee",
  "undergraduate",
  "writer",
]);

const POSSESSIVE = /['’]s?\b/g;
const TOKEN = /[a-z0-9]+(?:-[a-z0-9]+)*/g;

function singular(token: string): string {
  return token.length > 3 && token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token;
}

export function isParticipantDescriptor(phrase: string | null | undefined): boolean {
  const raw = String(phrase ?? "");
  if (/['’]\s*$/.test(raw)) return false;
  const tokens = raw.toLowerCase().replace(POSSESSIVE, "").match(TOKEN) ?? [];
  if (tokens.length === 0) return false;
  return PERSON_NOUNS.has(singular(tokens[tokens.length - 1]));
}
