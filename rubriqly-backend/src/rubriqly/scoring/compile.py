"""Turning a rubric and a draft into Jev questions.

The rubric arrives with each check (rubrics live in the browser). Only what Jev needs is
accepted: tips, weights and summaries are ignored if sent, so tips can never reach Jev.
"""

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from rubriqly.jev import BooleanQuestion, Question, ScoreQuestion

Id = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_:-]{1,64}$")]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=600)]


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore")


class CriterionIn(_Model):
    id: Id
    name: Name
    question: Text
    # One per level, lowest first.
    descriptors: Annotated[list[Text], Field(min_length=2, max_length=8)]


class ChecklistItemIn(_Model):
    id: Id
    name: Name
    question: Text


class RubricIn(_Model):
    id: Id
    version: Annotated[int, Field(ge=1)]
    title: Name
    levels: Annotated[list[Name], Field(min_length=2, max_length=8)]
    criteria: Annotated[list[CriterionIn], Field(min_length=1, max_length=12)]
    checklist: Annotated[list[ChecklistItemIn], Field(max_length=15)] = []

    @model_validator(mode="after")
    def check_consistent(self) -> Self:
        for criterion in self.criteria:
            if len(criterion.descriptors) != len(self.levels):
                raise ValueError(
                    f"criterion {criterion.id!r} needs one descriptor per level "
                    f"({len(self.levels)}), not {len(criterion.descriptors)}"
                )
        ids = [c.id for c in self.criteria] + [i.id for i in self.checklist]
        if len(ids) != len(set(ids)):
            raise ValueError("criterion and checklist ids must be unique")
        return self


# Jev question keys are Rubriqly's own (`criterion_0`, ...), so rubric ids never need escaping.
def criterion_key(index: int) -> str:
    return f"criterion_{index}"


def checklist_key(index: int) -> str:
    return f"check_{index}"


def draft_state(prompt: str, text: str) -> dict[str, str]:
    state = {"draft": text}
    if prompt.strip():
        state["assignment_prompt"] = prompt.strip()
    return state


def rubric_questions(rubric: RubricIn) -> dict[str, Question]:
    """Criteria become score questions, checklist items yes/no questions. Never tips."""
    questions: dict[str, Question] = {}
    for index, criterion in enumerate(rubric.criteria):
        questions[criterion_key(index)] = ScoreQuestion(
            instructions=criterion.question, criteria=list(criterion.descriptors)
        )
    for index, item in enumerate(rubric.checklist):
        questions[checklist_key(index)] = BooleanQuestion(instructions=item.question)
    return questions


# Paragraph tags, matching the labels the frontend shows.
INTRO_QUESTIONS: dict[str, str] = {
    "Claim": "Does this introduction state the essay's main claim or thesis?",
    "Context": "Does this introduction give the reader background or context on the topic?",
}
BODY_QUESTIONS: dict[str, str] = {
    "Claim": "Does this paragraph make a clear point or claim, for example in a topic sentence?",
    "Evidence": (
        "Does this paragraph include specific evidence, such as a quotation, fact, statistic, "
        "example or cited source?"
    ),
    "Analysis": (
        "Does this paragraph explain how its evidence supports its point, "
        "rather than only stating the evidence?"
    ),
}


CONCLUSION_QUESTIONS: dict[str, str] = {
    "Claim": "Does this conclusion return to the essay's main claim or thesis?",
    "Significance": (
        "Does this conclusion explain why the argument matters or what follows from it, "
        "rather than only repeating earlier points?"
    ),
}

Role = Literal["introduction", "body paragraph", "conclusion"]
_QUESTIONS_BY_ROLE: dict[str, dict[str, str]] = {
    "introduction": INTRO_QUESTIONS,
    "body paragraph": BODY_QUESTIONS,
    "conclusion": CONCLUSION_QUESTIONS,
}


def paragraph_role(index: int, count: int) -> Role:
    """First paragraph is the introduction; with 3 or more, the last one is the conclusion."""
    if index == 0:
        return "introduction"
    if count >= 3 and index == count - 1:
        return "conclusion"
    return "body paragraph"


def paragraph_labels(role: Role) -> dict[str, str]:
    """Question key -> tag label, in the order they're asked, e.g. {"claim": "Claim", ...}."""
    return {label.lower(): label for label in _QUESTIONS_BY_ROLE[role]}


def paragraph_request(text: str, role: Role) -> tuple[dict[str, str], dict[str, Question]]:
    state = {"role": role, "paragraph": text}
    questions: dict[str, Question] = {
        label.lower(): BooleanQuestion(instructions=instructions)
        for label, instructions in _QUESTIONS_BY_ROLE[role].items()
    }
    return state, questions
