"""The Jev client: one interface, a free mock and the real Vercel AI Gateway version."""

import asyncio
import hashlib
import json
import logging
import time
from collections.abc import Awaitable, Callable, Mapping
from decimal import Decimal
from typing import Literal, Protocol

import httpx
from pydantic import ValidationError

from rubriqly.config import Settings
from rubriqly.gateway import GatewayFailure, post_with_retries
from rubriqly.jev.models import (
    BooleanAnswer,
    BooleanQuestion,
    EvaluateResult,
    Question,
    ScoreAnswer,
    ScoreQuestion,
    State,
    parse_response,
)

logger = logging.getLogger(__name__)

ErrorKind = Literal["unavailable", "rate_limited", "budget", "not_configured", "bad_request"]

MESSAGES: dict[ErrorKind, str] = {
    "unavailable": "Scoring is unavailable right now. Please try again in a minute.",
    "rate_limited": "Scoring is busy right now. Please try again in a minute.",
    "budget": "Rubriqly has reached its scoring budget. Please try again later.",
    "not_configured": "Scoring isn't set up correctly. Please let us know.",
    "bad_request": "This draft couldn't be scored. Please let us know.",
}


class JevError(Exception):
    """Scoring failed. `message` is safe to show to students; details only go to the logs."""

    def __init__(self, kind: ErrorKind, detail: str = "") -> None:
        super().__init__(f"{kind}: {detail}" if detail else kind)
        self.kind = kind
        self.message = MESSAGES[kind]


class JevClient(Protocol):
    async def evaluate(self, state: State, questions: Mapping[str, Question]) -> EvaluateResult: ...

    async def aclose(self) -> None: ...


def check_answers(questions: Mapping[str, Question], result: EvaluateResult) -> None:
    """Every question must come back, with the right type and a score inside its scale."""
    for key, question in questions.items():
        answer = result.answers.get(key)
        if isinstance(question, ScoreQuestion):
            top = len(question.criteria) - 1
            if not isinstance(answer, ScoreAnswer) or answer.score > top + 1e-6:
                raise JevError("unavailable", f"bad or missing score answer for {key!r}")
        elif not isinstance(answer, BooleanAnswer):
            raise JevError("unavailable", f"bad or missing boolean answer for {key!r}")


class GatewayJevClient:
    """Real, paid Jev calls through Vercel AI Gateway."""

    MAX_ATTEMPTS = 3

    def __init__(
        self,
        settings: Settings,
        http: httpx.AsyncClient | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.settings = settings
        self.url = settings.jev_base_url.rstrip("/") + "/evaluate"
        self.http = http or httpx.AsyncClient(timeout=settings.jev_timeout_seconds)
        self.sleep = sleep

    async def aclose(self) -> None:
        await self.http.aclose()

    async def evaluate(self, state: State, questions: Mapping[str, Question]) -> EvaluateResult:
        payload = {
            "model": self.settings.jev_model,
            "state": state,
            "questions": {key: q.model_dump() for key, q in questions.items()},
            # Student essays: only providers that don't train on the data.
            "providerOptions": {"gateway": {"disallowPromptTraining": True}},
        }
        headers = {"Authorization": f"Bearer {self.settings.ai_gateway_api_key.get_secret_value()}"}
        started = time.monotonic()
        response = await self._post_with_retries(payload, headers)

        try:
            result = parse_response(response.json())
        except (ValueError, ValidationError) as error:
            raise JevError("unavailable", f"unexpected response: {error}") from error
        check_answers(questions, result)

        # Never log the state: it's the student's text.
        logger.info(
            "jev ok: %d questions, %d input tokens, cost $%s (list $%s), %.0f ms, %s",
            len(questions),
            result.input_tokens,
            result.cost_usd,
            result.market_cost_usd,
            (time.monotonic() - started) * 1000,
            result.generation_id,
        )
        return result

    async def _post_with_retries(self, payload: dict, headers: dict[str, str]) -> httpx.Response:
        """Retries timeouts, network errors, 429 and 5xx a couple of times before giving up."""
        try:
            return await post_with_retries(
                self.http,
                self.url,
                payload,
                headers,
                self.sleep,
                attempts=self.MAX_ATTEMPTS,
                name="jev",
            )
        except GatewayFailure as failure:
            raise JevError(failure.kind, failure.detail) from failure


def _unit(*parts: str) -> float:
    """A repeatable number in [0, 1) from some text."""
    digest = hashlib.sha256("\x1f".join(parts).encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


class MockJevClient:
    """Free, repeatable fake answers for tests, CI and development. Not a scorer."""

    def __init__(self) -> None:
        self.calls: list[tuple[State, dict[str, Question]]] = []

    async def aclose(self) -> None:
        pass

    async def evaluate(self, state: State, questions: Mapping[str, Question]) -> EvaluateResult:
        self.calls.append((state, dict(questions)))
        text = state if isinstance(state, str) else json.dumps(state, sort_keys=True)
        answers: dict[str, ScoreAnswer | BooleanAnswer] = {}
        for key, question in questions.items():
            if isinstance(question, BooleanQuestion):
                answers[key] = BooleanAnswer(type="boolean", probability=round(_unit(key, text), 2))
                continue
            top = len(question.criteria) - 1
            score = round(_unit(key, text) * top, 2)
            low = int(score)
            high = min(low + 1, top)
            share = round(score - low, 2)
            probabilities = {str(i): 0.0 for i in range(top + 1)}
            probabilities[str(low)] = round(1 - share, 2) if high != low else 1.0
            if high != low:
                probabilities[str(high)] = share
            answers[key] = ScoreAnswer(
                type="score",
                score=score,
                probabilities=probabilities,
                confidence=round(0.45 + 0.5 * _unit("confidence", key, text), 2),
            )
        return EvaluateResult(
            model="mock",
            answers=answers,
            input_tokens=len(text) // 4,
            cost_usd=Decimal(0),
            market_cost_usd=Decimal(0),
        )


def make_jev_client(settings: Settings) -> JevClient:
    if settings.jev_mode == "live":
        return GatewayJevClient(settings)
    return MockJevClient()
