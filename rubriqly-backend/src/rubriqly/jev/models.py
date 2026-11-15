"""Shapes of Jev requests and answers on Vercel AI Gateway's `POST /v1/evaluate`.

Checked against a real response (23 September 2026; see docs/architecture.md, "Jev"):
`score` is 0-based, score answers carry `confidence` inline (and in
providerMetadata.typesafe.confidence), and boolean answers carry only `probability`.
"""

from decimal import Decimal, InvalidOperation
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Probability = Annotated[float, Field(ge=0, le=1)]


class ScoreQuestion(BaseModel):
    type: Literal["score"] = "score"
    instructions: str
    # Level descriptions, lowest first.
    criteria: Annotated[list[str], Field(min_length=2)]


class BooleanQuestion(BaseModel):
    type: Literal["boolean"] = "boolean"
    instructions: str


Question = Annotated[ScoreQuestion | BooleanQuestion, Field(discriminator="type")]
# Jev accepts a string, an object or a list as the thing being judged.
State = str | dict[str, Any] | list[Any]


class ScoreAnswer(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: Literal["score"]
    # 0 = the first (lowest) criterion. Interpolated, e.g. 2.65.
    score: Annotated[float, Field(ge=0)]
    probabilities: dict[str, Probability]
    confidence: Probability | None = None


class BooleanAnswer(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: Literal["boolean"]
    probability: Probability


Answer = Annotated[ScoreAnswer | BooleanAnswer, Field(discriminator="type")]


class _Usage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    inputTokens: int = 0  # Vercel's field names
    outputTokens: int = 0


class _Response(BaseModel):
    """The raw response body. Only the parts Rubriqly uses are checked."""

    model_config = ConfigDict(extra="ignore")

    model: str
    answers: dict[str, Answer]
    usage: _Usage = _Usage()
    providerMetadata: dict[str, Any] = {}


class EvaluateResult(BaseModel):
    """A validated Jev response, in Rubriqly's own names."""

    model: str
    answers: dict[str, ScoreAnswer | BooleanAnswer]
    input_tokens: int
    # What Vercel charged (0 while the free credit covers it) and the list price.
    cost_usd: Decimal
    market_cost_usd: Decimal
    generation_id: str | None = None


def _decimal(value: object) -> Decimal:
    try:
        return Decimal(str(value)) if value is not None else Decimal(0)
    except InvalidOperation:
        return Decimal(0)


def parse_response(body: object) -> EvaluateResult:
    """Validate a response body. Raises pydantic.ValidationError if it isn't what we expect."""
    raw = _Response.model_validate(body)
    typesafe = raw.providerMetadata.get("typesafe") or {}
    gateway = raw.providerMetadata.get("gateway") or {}
    fallback_confidence = typesafe.get("confidence") or {}

    answers: dict[str, ScoreAnswer | BooleanAnswer] = {}
    for key, answer in raw.answers.items():
        if isinstance(answer, ScoreAnswer) and answer.confidence is None:
            confidence = fallback_confidence.get(key)
            # Only a real probability; anything else is left out (the scorer then works it out).
            if isinstance(confidence, int | float) and 0 <= confidence <= 1:
                answer = answer.model_copy(update={"confidence": float(confidence)})
        answers[key] = answer

    return EvaluateResult(
        model=raw.model,
        answers=answers,
        input_tokens=raw.usage.inputTokens,
        cost_usd=_decimal(gateway.get("cost")),
        market_cost_usd=_decimal(gateway.get("marketCost", gateway.get("cost"))),
        generation_id=gateway.get("generationId"),
    )
