"""Who took part in a study, as opposed to what it studied.

"Thai EFL undergraduate students" describes a paper's participants, not its
subject. Extracted as a concept, nearly every paper in an EIL repository got
a "who was studied" topic, and the dashboard merged them into one theme that
covered 29 of 39 papers and said nothing.

A phrase is a participant descriptor when its head noun - the last word in
English - names people. "learner autonomy" and "EFL learners' writing" are
subjects; "Thai EFL learners" is not. The same list lives in
eil-dashboard/src/lib/participant-terms.ts; a test keeps the two equal.
"""

import re

PERSON_NOUNS = frozenset(
    {
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
    }
)

_TOKEN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


def _singular(token: str) -> str:
    if len(token) > 3 and token.endswith("s") and not token.endswith("ss"):
        return token[:-1]
    return token


# Thai names the head first: "ผู้เรียน..." (learners ...), "นักศึกษา..." (students ...).
THAI_PERSON_PREFIXES = ("ผู้เรียน", "นักเรียน", "นักศึกษา", "ครู", "ผู้สอน", "ผู้เข้าร่วม")
# ... except where the group qualifies a construct: "ผู้เรียนเป็นศูนย์กลาง" (learner-centred).
THAI_CONSTRUCT_MARKERS = ("เป็นศูนย์กลาง",)


def is_participant_descriptor(phrase: str) -> bool:
    """Whether ``phrase`` only names a group of people."""

    raw = str(phrase or "").strip()
    if raw.startswith(THAI_PERSON_PREFIXES):
        return not any(marker in raw for marker in THAI_CONSTRUCT_MARKERS)
    text = re.sub(r"['’]s?\b", "", raw.casefold())
    tokens = _TOKEN.findall(text)
    if not tokens or raw.endswith(("'", "’")):
        return False
    # "learners of English": the head comes before "of".
    head = tokens[tokens.index("of", 1) - 1] if "of" in tokens[1:] else tokens[-1]
    return _singular(head) in PERSON_NOUNS
