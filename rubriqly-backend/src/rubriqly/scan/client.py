"""The rubric scanner: one interface, a free mock and the real Vercel AI Gateway version.

The scanner reads photos of a rubric and returns it as data. It never sees student drafts.
Photos are passed through and forgotten: they're never stored or logged.
"""

import asyncio
import base64
import json
import logging
import re
import time
from collections.abc import Awaitable, Callable, Sequence
from decimal import Decimal
from itertools import pairwise
from typing import Any, Literal, Protocol

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError

from rubriqly.config import Settings
from rubriqly.gateway import GatewayFailure, post_with_retries, to_decimal
from rubriqly.scan.models import (
    MAX_CHECKLIST,
    MAX_CRITERIA,
    MAX_LEVELS,
    MAX_NAME,
    MAX_TEXT,
    ScanImage,
    ScannedChecklistItem,
    ScannedCriterion,
    ScannedRubric,
    ScanResult,
    WordCount,
)
from rubriqly.scan.prompt import INSTRUCTIONS, RESPONSE_SCHEMA

logger = logging.getLogger(__name__)

ScanErrorKind = Literal[
    "unavailable",
    "rate_limited",
    "budget",
    "not_configured",
    "bad_request",
    "not_a_rubric",
    "unreadable",
    "too_big",
]

MESSAGES: dict[ScanErrorKind, str] = {
    "unavailable": "Reading rubric photos isn't working right now. Please try again in a minute.",
    "rate_limited": "Rubric scanning is busy right now. Please try again in a minute.",
    "budget": "Rubriqly has reached its budget for reading rubrics. Please try again later.",
    "not_configured": "Rubric scanning isn't set up correctly. Please let us know.",
    "bad_request": "These photos couldn't be read. Try JPG or PNG photos, or let us know.",
    "not_a_rubric": (
        "These photos don't look like a grading rubric. Try a clear photo of the rubric table."
    ),
    "unreadable": (
        "We couldn't read this rubric clearly. Try a sharper, straight-on photo with the whole "
        "table in view."
    ),
    "too_big": (
        f"This rubric is bigger than Rubriqly can use (up to {MAX_LEVELS} levels, "
        f"{MAX_CRITERIA} criteria and {MAX_CHECKLIST} checklist items)."
    ),
}


class ScanError(Exception):
    """Scanning failed. `message` is safe to show to students; details only go to the logs."""

    def __init__(self, kind: ScanErrorKind, detail: str = "") -> None:
        super().__init__(f"{kind}: {detail}" if detail else kind)
        self.kind: ScanErrorKind = kind
        self.message = MESSAGES[kind]
        # What the attempt used, when the model answered but the answer couldn't be used.
        self.input_tokens = 0
        self.output_tokens = 0
        self.market_cost_usd = Decimal(0)


class ScanClient(Protocol):
    async def scan(self, images: Sequence[ScanImage]) -> ScanResult: ...

    async def aclose(self) -> None: ...


# The model's raw answer, checked loosely first so each problem gets the right error kind.


class _Raw(BaseModel):
    model_config = ConfigDict(extra="ignore")


class _RawLevel(_Raw):
    name: str
    points: str = ""


class _RawCriterion(_Raw):
    name: str
    descriptors: list[str]
    suggested_question: str = ""
    suggested_tips: list[str] = []


class _RawChecklistItem(_Raw):
    name: str
    suggested_question: str = ""


class _RawRubric(_Raw):
    is_rubric: bool
    title: str = ""
    levels: list[_RawLevel] = []
    criteria: list[_RawCriterion] = []
    checklist: list[_RawChecklistItem] = []
    word_count_min: int = 0
    word_count_max: int = 0
    notes: str = ""


def _first_number(text: str) -> float | None:
    match = re.search(r"\d+(?:\.\d+)?", text)
    return float(match.group()) if match else None


def _highest_first(levels: list[_RawLevel]) -> bool:
    """True when every level has points and they go down: the model forgot to reverse them."""
    points = [p for level in levels if (p := _first_number(level.points)) is not None]
    if len(points) != len(levels):
        return False
    return all(a > b for a, b in pairwise(points))


def _clip(text: str, limit: int = MAX_TEXT) -> str:
    return text.strip()[:limit]


def to_scanned_rubric(raw: _RawRubric) -> ScannedRubric:
    """Checks the model's answer and puts it in Rubriqly's order. Never fills in rubric text."""
    if not raw.is_rubric:
        raise ScanError("not_a_rubric")
    levels = raw.levels
    criteria = raw.criteria
    if len(levels) > MAX_LEVELS or len(criteria) > MAX_CRITERIA:
        raise ScanError("too_big", f"{len(levels)} levels, {len(criteria)} criteria")
    if len(raw.checklist) > MAX_CHECKLIST:
        raise ScanError("too_big", f"{len(raw.checklist)} checklist items")
    if len(levels) < 2 or not criteria:
        raise ScanError("unreadable", f"{len(levels)} levels, {len(criteria)} criteria")

    n = len(levels)
    for criterion in criteria:
        if len(criterion.descriptors) != n:
            raise ScanError(
                "unreadable",
                f"a criterion has {len(criterion.descriptors)} descriptions for {n} levels",
            )
    texts = [c.name for c in criteria] + [level.name for level in levels]
    texts += [item.name for item in raw.checklist]
    if any(len(t.strip()) > MAX_NAME for t in texts) or any(
        len(d.strip()) > MAX_TEXT for c in criteria for d in c.descriptors
    ):
        raise ScanError("too_big", "a name or description is too long")
    if any(not c.name.strip() for c in criteria):
        raise ScanError("unreadable", "a criterion has no name")

    reverse = _highest_first(levels)

    def ordered(values: list[str]) -> list[str]:
        return values[::-1] if reverse else values

    def tips(values: list[str]) -> list[str]:
        # Suggestions only, so a wrong count is padded or trimmed rather than refused.
        fitted = [_clip(t) for t in values[:n]] + [""] * max(0, n - len(values))
        return ordered(fitted)

    names = [level.name.strip() or f"Level {i + 1}" for i, level in enumerate(levels)]
    low, high = raw.word_count_min, raw.word_count_max
    word_count = WordCount(min=low if low > 0 else None, max=high if high > 0 else None)
    return ScannedRubric(
        title=_clip(raw.title, MAX_NAME) or "Scanned rubric",
        levels=ordered(names),
        criteria=[
            ScannedCriterion(
                name=c.name.strip(),
                descriptors=ordered([d.strip() for d in c.descriptors]),
                suggested_question=_clip(c.suggested_question),
                suggested_tips=tips(c.suggested_tips),
            )
            for c in criteria
        ],
        checklist=[
            ScannedChecklistItem(
                name=item.name.strip(), suggested_question=_clip(item.suggested_question)
            )
            for item in raw.checklist
            if item.name.strip()
        ],
        word_count=word_count if (word_count.min or word_count.max) else None,
        notes=_clip(raw.notes),
    )


def _gateway_costs(body: dict[str, Any]) -> tuple[Decimal, Decimal, str | None]:
    """Cost and generation id, wherever this response puts them."""
    usage = body.get("usage") or {}
    metadata = body.get("providerMetadata") or body.get("provider_metadata") or {}
    gateway = metadata.get("gateway") or {}
    cost = gateway.get("cost", usage.get("cost"))
    market = gateway.get("marketCost", usage.get("market_cost", cost))
    generation_id = gateway.get("generationId") or body.get("id")
    return to_decimal(cost), to_decimal(market), generation_id


def parse_scan_response(body: object) -> ScanResult:
    """Turns a Chat Completions response into a ScanResult, or raises ScanError."""
    if not isinstance(body, dict):
        raise ScanError("unavailable", "the response isn't an object")
    usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
    input_tokens = int(usage.get("prompt_tokens") or 0)
    output_tokens = int(usage.get("completion_tokens") or 0)
    cost, market, generation_id = _gateway_costs(body)
    try:
        choice = body["choices"][0]
        content = choice["message"]["content"]
        if choice.get("finish_reason") == "length":
            raise ScanError("unreadable", "the answer was cut off")
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip())
        rubric = to_scanned_rubric(_RawRubric.model_validate(json.loads(text)))
    except ScanError as error:
        error.input_tokens, error.output_tokens = input_tokens, output_tokens
        error.market_cost_usd = market
        raise
    except (KeyError, IndexError, TypeError, AttributeError, ValueError, ValidationError) as error:
        failed = ScanError("unavailable", f"unexpected response: {error!r}"[:500])
        failed.input_tokens, failed.output_tokens = input_tokens, output_tokens
        failed.market_cost_usd = market
        raise failed from error

    return ScanResult(
        rubric=rubric,
        model=str(body.get("model", "")),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=cost,
        market_cost_usd=market,
        generation_id=generation_id,
    )


def build_payload(settings: Settings, images: Sequence[ScanImage]) -> dict[str, Any]:
    pages = "one photo" if len(images) == 1 else f"{len(images)} photos, pages in order"
    content: list[dict[str, Any]] = [
        {"type": "text", "text": f"Copy the rubric in these photos ({pages})."}
    ]
    for image in images:
        encoded = base64.b64encode(image.data).decode("ascii")
        content.append(
            {"type": "image_url", "image_url": {"url": f"data:{image.media_type};base64,{encoded}"}}
        )
    return {
        "model": settings.scan_model,
        "messages": [
            {"role": "system", "content": INSTRUCTIONS},
            {"role": "user", "content": content},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "rubric", "strict": True, "schema": RESPONSE_SCHEMA},
        },
        # No temperature: Gemini 3 models are meant to run at their default and can loop below it.
        # Copying a table needs little thinking, and thinking tokens cost money.
        "reasoning": {"effort": "low"},
        "max_tokens": 16_000,
        "stream": False,
        # Only providers that don't train on the data.
        "providerOptions": {"gateway": {"disallowPromptTraining": True}},
    }


class GatewayScanClient:
    """Real, paid scans through Vercel AI Gateway's Chat Completions API."""

    # Scans are slow; one retry keeps the wait reasonable for the student.
    MAX_ATTEMPTS = 2

    def __init__(
        self,
        settings: Settings,
        http: httpx.AsyncClient | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.settings = settings
        self.url = settings.jev_base_url.rstrip("/") + "/chat/completions"
        self.http = http or httpx.AsyncClient(timeout=settings.scan_timeout_seconds)
        self.sleep = sleep

    async def aclose(self) -> None:
        await self.http.aclose()

    async def scan(self, images: Sequence[ScanImage]) -> ScanResult:
        payload = build_payload(self.settings, images)
        headers = {"Authorization": f"Bearer {self.settings.ai_gateway_api_key.get_secret_value()}"}
        started = time.monotonic()
        try:
            response = await post_with_retries(
                self.http,
                self.url,
                payload,
                headers,
                self.sleep,
                attempts=self.MAX_ATTEMPTS,
                name="scan",
            )
        except GatewayFailure as failure:
            raise ScanError(failure.kind, failure.detail) from failure
        try:
            body = response.json()
        except ValueError as error:
            raise ScanError("unavailable", "the response isn't JSON") from error
        result = parse_scan_response(body)

        # Never log the photos or the rubric text.
        logger.info(
            "scan ok: %d images, %d input + %d output tokens, cost $%s (list $%s), %.0f ms, %s",
            len(images),
            result.input_tokens,
            result.output_tokens,
            result.cost_usd,
            result.market_cost_usd,
            (time.monotonic() - started) * 1000,
            result.generation_id,
        )
        return result


# Original example content, labelled as a demo so it can't be mistaken for a real scan.
DEMO_RUBRIC = ScannedRubric(
    title="Demo scan: essay rubric",
    levels=["Beginning", "Developing", "Proficient", "Excellent"],
    criteria=[
        ScannedCriterion(
            name="Main idea",
            descriptors=[
                "No clear main idea",
                "A main idea that is vague or drifts",
                "A clear main idea kept through the essay",
                "A sharp, specific main idea that shapes every paragraph",
            ],
            suggested_question="How clear and focused is the essay's main idea?",
            suggested_tips=[
                "Write one sentence that says what your essay is about.",
                "Make your main idea more specific and check each paragraph supports it.",
                "Sharpen the main idea so it previews your reasons.",
                "Keep it up: make sure the conclusion returns to your main idea.",
            ],
        ),
        ScannedCriterion(
            name="Support",
            descriptors=[
                "Little or no support",
                "Some support, mostly general",
                "Specific support in most paragraphs",
                "Well-chosen, specific support throughout",
            ],
            suggested_question="How specific and relevant is the support for the main idea?",
            suggested_tips=[
                "Add one specific example or fact to each body paragraph.",
                "Swap a general statement for a specific detail.",
                "Find your weakest paragraph and strengthen its support.",
                "Keep it up: check every example clearly connects to your point.",
            ],
        ),
    ],
    checklist=[
        ScannedChecklistItem(name="Has a title", suggested_question="Does the essay have a title?")
    ],
    notes="Demo scan: SCAN_MODE is mock, so this is a fixed example, not your photo.",
)


class MockScanClient:
    """Free, fixed answers for tests, CI and development. It doesn't read the photos."""

    def __init__(self) -> None:
        self.calls: list[int] = []

    async def aclose(self) -> None:
        pass

    async def scan(self, images: Sequence[ScanImage]) -> ScanResult:
        self.calls.append(len(images))
        return ScanResult(
            rubric=DEMO_RUBRIC,
            model="mock",
            input_tokens=0,
            output_tokens=0,
            cost_usd=Decimal(0),
            market_cost_usd=Decimal(0),
        )


def make_scan_client(settings: Settings) -> ScanClient:
    if settings.scan_mode == "live":
        return GatewayScanClient(settings)
    return MockScanClient()
