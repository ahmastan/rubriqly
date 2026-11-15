"""Scoring one draft: the rubric request and the paragraph requests, run together."""

import asyncio
import logging
import math
from collections.abc import Awaitable, Mapping
from dataclasses import dataclass, field
from decimal import Decimal

from pydantic import BaseModel

from rubriqly.jev import (
    BooleanAnswer,
    EvaluateResult,
    JevClient,
    JevError,
    Question,
    ScoreAnswer,
    State,
)
from rubriqly.scoring.compile import (
    Role,
    RubricIn,
    checklist_key,
    criterion_key,
    draft_state,
    paragraph_labels,
    paragraph_request,
    paragraph_role,
    rubric_questions,
)
from rubriqly.scoring.text import count_words, extract_title, split_paragraphs

logger = logging.getLogger(__name__)

# A tag counts as present when Jev thinks "yes" is at least this likely.
TAG_THRESHOLD = 0.5


class CriterionOut(BaseModel):
    id: str
    # 1-based and not yet rounded, e.g. 3.65 (the browser rounds and clamps it).
    level: float
    confidence: float
    # Probability of each level, lowest first.
    probabilities: list[float]


class ChecklistOut(BaseModel):
    id: str
    probability: float


class TagOut(BaseModel):
    label: str
    present: bool
    probability: float


class ParagraphOut(BaseModel):
    # 1-based, counted after the title, like the browser's ¶n.
    n: int
    is_intro: bool
    is_conclusion: bool
    tags: list[TagOut]
    # A body paragraph missing evidence or analysis, highlighted for revision. The introduction
    # and conclusion are never weak: they aren't expected to carry evidence.
    weak: bool


class CheckOut(BaseModel):
    """Scores only. The browser adds tips and the overall estimate (lib/scoring.ts)."""

    model: str
    word_count: int
    title: str | None
    criteria: list[CriterionOut]
    checklist: list[ChecklistOut]
    paragraphs: list[ParagraphOut]


@dataclass
class Spend:
    input_tokens: int = 0
    # Jev's list price, so usage shows real consumption even while the free credit pays.
    cost_usd: Decimal = field(default_factory=Decimal)

    def add(self, result: EvaluateResult) -> None:
        self.input_tokens += result.input_tokens
        self.cost_usd += result.market_cost_usd


class ScoringFailed(Exception):
    """Jev failed. Carries what was spent before the failure, for the usage record."""

    def __init__(self, error: JevError, spend: Spend) -> None:
        super().__init__(str(error))
        self.error = error
        self.spend = spend


def concentration(probabilities: Mapping[str, float], levels: int) -> float:
    """0 when spread evenly across levels, 1 when all on one: 1 - normalized entropy."""
    values = [p for p in probabilities.values() if p > 0]
    total = sum(values)
    if total <= 0 or levels < 2:
        return 0.0
    entropy = -sum((p / total) * math.log(p / total) for p in values)
    return round(max(0.0, 1 - entropy / math.log(levels)), 2)


def criterion_out(criterion_id: str, answer: ScoreAnswer, levels: int) -> CriterionOut:
    confidence = answer.confidence
    if confidence is None:
        confidence = concentration(answer.probabilities, levels)
    return CriterionOut(
        id=criterion_id,
        level=round(answer.score + 1, 2),
        confidence=confidence,
        probabilities=[answer.probabilities.get(str(i), 0.0) for i in range(levels)],
    )


def paragraph_out(n: int, role: Role, result: EvaluateResult) -> ParagraphOut:
    # In the order the questions were asked, ignoring any extra answers in the reply (every
    # question's answer was already checked by the client).
    tags: list[TagOut] = []
    for key, label in paragraph_labels(role).items():
        answer = result.answers[key]
        assert isinstance(answer, BooleanAnswer)
        tags.append(
            TagOut(
                label=label,
                present=answer.probability >= TAG_THRESHOLD,
                probability=answer.probability,
            )
        )
    present = {tag.label for tag in tags if tag.present}
    weak = role == "body paragraph" and not {"Evidence", "Analysis"} <= present
    return ParagraphOut(
        n=n,
        is_intro=role == "introduction",
        is_conclusion=role == "conclusion",
        tags=tags,
        weak=weak,
    )


async def score_draft(
    jev: JevClient, rubric: RubricIn, prompt: str, text: str, max_parallel: int
) -> tuple[CheckOut, Spend]:
    """Raises ScoringFailed if any Jev request fails: never a partial or guessed result."""
    draft = extract_title(split_paragraphs(text))
    limit = asyncio.Semaphore(max_parallel)

    async def ask(state: State, questions: dict[str, Question]) -> EvaluateResult:
        async with limit:
            return await jev.evaluate(state, questions)

    requests: list[Awaitable[EvaluateResult]] = [
        ask(draft_state(prompt, text), rubric_questions(rubric))
    ]
    count = len(draft.paragraphs)
    for index, paragraph in enumerate(draft.paragraphs):
        requests.append(ask(*paragraph_request(paragraph, paragraph_role(index, count))))

    outcomes = await asyncio.gather(*requests, return_exceptions=True)

    spend = Spend()
    failure: JevError | None = None
    for outcome in outcomes:
        if isinstance(outcome, EvaluateResult):
            spend.add(outcome)
        elif isinstance(outcome, JevError):
            failure = failure or outcome
        elif isinstance(outcome, BaseException):
            logger.error("unexpected scoring error", exc_info=outcome)
            failure = failure or JevError("unavailable", repr(outcome))
    if failure is not None:
        raise ScoringFailed(failure, spend)

    rubric_result, *paragraph_results = outcomes
    assert isinstance(rubric_result, EvaluateResult)
    levels = len(rubric.levels)
    criteria = []
    for index, criterion in enumerate(rubric.criteria):
        answer = rubric_result.answers[criterion_key(index)]
        assert isinstance(answer, ScoreAnswer)
        criteria.append(criterion_out(criterion.id, answer, levels))
    checklist = []
    for index, item in enumerate(rubric.checklist):
        answer = rubric_result.answers[checklist_key(index)]
        assert isinstance(answer, BooleanAnswer)
        checklist.append(ChecklistOut(id=item.id, probability=answer.probability))
    paragraphs = [
        paragraph_out(index + 1, paragraph_role(index, count), result)
        for index, result in enumerate(paragraph_results)
        if isinstance(result, EvaluateResult)
    ]

    check = CheckOut(
        model=rubric_result.model,
        word_count=count_words(text),
        title=draft.title,
        criteria=criteria,
        checklist=checklist,
        paragraphs=paragraphs,
    )
    return check, spend
