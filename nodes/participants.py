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


def is_participant_descriptor(phrase: str) -> bool:
    """Whether ``phrase`` only names a group of people."""

    text = re.sub(r"['’]s?\b", "", str(phrase or "").casefold())
    tokens = _TOKEN.findall(text)
    if not tokens or str(phrase or "").rstrip().endswith(("'", "’")):
        return False
    return _singular(tokens[-1]) in PERSON_NOUNS
