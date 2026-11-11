"""Calling Vercel AI Gateway: retries and error kinds shared by the Jev client and the scanner."""

import logging
from collections.abc import Awaitable, Callable
from decimal import Decimal, InvalidOperation
from typing import Literal

import httpx
from pydantic import ValidationError

logger = logging.getLogger(__name__)

FailureKind = Literal["unavailable", "rate_limited", "budget", "not_configured", "bad_request"]

RETRY_STATUSES = frozenset({408, 409, 425, 429, 500, 502, 503, 504})


# Error replies safe to log: they're about the account (key, budget, rate), so they can't repeat
# the request. Other replies, a 400 for example, may quote what was sent: a draft or a rubric.
_LOGGABLE_REPLIES = frozenset({401, 402, 403, 429})


class GatewayFailure(Exception):
    """A request that failed for good. `detail` is never shown to students.

    `log_detail` is what may be logged: never the request, and only replies that can't quote it.
    """

    def __init__(self, kind: FailureKind, detail: str, log_detail: str | None = None) -> None:
        super().__init__(f"{kind}: {detail}")
        self.kind: FailureKind = kind
        self.detail = detail
        self.log_detail = detail if log_detail is None else log_detail


async def post_with_retries(
    http: httpx.AsyncClient,
    url: str,
    payload: dict,
    headers: dict[str, str],
    sleep: Callable[[float], Awaitable[None]],
    *,
    attempts: int,
    name: str,
) -> httpx.Response:
    """Retries timeouts, network errors, 429 and 5xx before giving up with a GatewayFailure.

    Giving up is logged (kind and status, never the payload), so outages can be diagnosed.
    """
    try:
        return await _post(http, url, payload, headers, sleep, attempts=attempts, name=name)
    except GatewayFailure as failure:
        logger.warning("%s failed (%s): %s", name, failure.kind, failure.log_detail)
        raise


async def _post(
    http: httpx.AsyncClient,
    url: str,
    payload: dict,
    headers: dict[str, str],
    sleep: Callable[[float], Awaitable[None]],
    *,
    attempts: int,
    name: str,
) -> httpx.Response:
    for attempt in range(1, attempts + 1):
        last_try = attempt == attempts
        failed: httpx.Response | None = None
        try:
            response = await http.post(url, json=payload, headers=headers)
        except httpx.TimeoutException as error:
            if last_try:
                raise GatewayFailure("unavailable", "timed out") from error
            logger.warning("%s attempt %d timed out, retrying", name, attempt)
        except httpx.TransportError as error:
            if last_try:
                raise GatewayFailure("unavailable", f"network error: {error!r}") from error
            logger.warning("%s attempt %d network error, retrying", name, attempt)
        else:
            if response.is_success:
                return response
            if response.status_code not in RETRY_STATUSES or last_try:
                raise failure_for(response)
            logger.warning("%s attempt %d got %d, retrying", name, attempt, response.status_code)
            failed = response
        await sleep(retry_delay(attempt, failed))
    raise AssertionError("unreachable")


def retry_delay(attempt: int, response: httpx.Response | None) -> float:
    if response is not None:
        try:
            return min(float(response.headers.get("retry-after", "")), 5.0)
        except ValueError:
            pass
    return 0.5 * 3 ** (attempt - 1)  # 0.5 s, then 1.5 s


def failure_for(response: httpx.Response) -> GatewayFailure:
    status = response.status_code
    detail = f"HTTP {status}: {response.text[:500]}"
    if status in _LOGGABLE_REPLIES:
        log_detail = f"HTTP {status}: {' '.join(response.text.split())[:300]}"
    else:
        log_detail = f"HTTP {status} (reply not logged: it may quote the request)"
    text = response.text.lower()
    if status in (401, 403):
        kind: FailureKind = "not_configured"
    elif status == 402 or "budget" in text or "insufficient" in text or "credit" in text:
        kind = "budget"
    elif status == 429:
        kind = "rate_limited"
    elif 400 <= status < 500:
        kind = "bad_request"
    else:
        kind = "unavailable"
    return GatewayFailure(kind, detail, log_detail)


def problem_places(error: ValidationError) -> str:
    """Where a reply failed validation, e.g. `answers.criterion_0.score`. Never the values."""
    places = {".".join(str(part) for part in problem["loc"]) for problem in error.errors()}
    return ", ".join(sorted(places)[:10])


def to_decimal(value: object) -> Decimal:
    try:
        return Decimal(str(value)) if value is not None else Decimal(0)
    except InvalidOperation:
        return Decimal(0)
