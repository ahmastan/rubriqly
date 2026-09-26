"""What the vision model is told, and the JSON shape it must answer in.

The model copies the rubric; it never grades or sees student work. Everything it writes itself
(the questions and tips) goes in `suggested_*` fields so the builder can mark it for checking.
"""

INSTRUCTIONS = """\
You copy a teacher's grading rubric from photos into structured data for Rubriqly, an app that \
helps students check their own drafts against a rubric. The photos may be several pages of one \
rubric, in order.

Copy exactly:
- Copy every criterion name, level name and cell description word for word. Fix nothing, \
summarize nothing, add nothing. Join text that wraps across lines. Drop bullet symbols but keep \
all the words, joining bullet points with "; ".
- A rubric may be laid out with criteria as rows and levels as columns, or the other way round. \
Work out which is which.
- List levels from LOWEST to HIGHEST, even when the page shows the best level first. \
Put each level's number or points exactly as shown in "points" (empty if none).
- If a level has a name and a number (for example "4 Expert"), use the name ("Expert"). If it only \
has a number, use the number ("4").
- Every criterion needs exactly one description per level, in the same order as "levels". \
Use "" for an empty cell. Never invent a description.
- Ignore watermarks, page numbers, logos, and names of teachers or students.
- Only put items in "checklist" if the rubric itself lists yes/no requirements (for example \
"Uses MLA format", "Includes a works cited page"). Don't turn criteria into checklist items.
- Set word_count_min / word_count_max only if the rubric states a word range; otherwise 0.
- Use "notes" to say briefly what you couldn't read or weren't sure about. Otherwise "".
- If the photos don't show a grading rubric, set is_rubric to false and leave the rest empty.

Suggest (these are clearly marked as suggestions for the student to check):
- suggested_question: for each criterion, one question starting with "How" that an AI grader \
could answer with a level by reading a draft, covering the whole criterion, for example "How \
clear and arguable is the thesis, and does it answer the prompt?". Never a yes/no question. For \
checklist items, a yes/no question, for example "Does the essay include a works cited page?".
- suggested_tips: one short tip per level (same order as "levels", at most 25 words each) telling \
a student at that level what to do next to improve. For the highest level, say what to keep \
doing. Give general advice only: never write sentences for the student's essay.
"""

_STRING = {"type": "string"}

RESPONSE_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "is_rubric": {"type": "boolean"},
        "title": _STRING,
        "levels": {
            "type": "array",
            "description": "Lowest level first.",
            "items": {
                "type": "object",
                "properties": {"name": _STRING, "points": _STRING},
                "required": ["name", "points"],
                "additionalProperties": False,
            },
        },
        "criteria": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": _STRING,
                    "descriptors": {"type": "array", "items": _STRING},
                    "suggested_question": _STRING,
                    "suggested_tips": {"type": "array", "items": _STRING},
                },
                "required": ["name", "descriptors", "suggested_question", "suggested_tips"],
                "additionalProperties": False,
            },
        },
        "checklist": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"name": _STRING, "suggested_question": _STRING},
                "required": ["name", "suggested_question"],
                "additionalProperties": False,
            },
        },
        "word_count_min": {"type": "integer"},
        "word_count_max": {"type": "integer"},
        "notes": _STRING,
    },
    "required": [
        "is_rubric",
        "title",
        "levels",
        "criteria",
        "checklist",
        "word_count_min",
        "word_count_max",
        "notes",
    ],
    "additionalProperties": False,
}
