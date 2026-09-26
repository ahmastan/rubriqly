"""Calling Vercel AI Gateway: retries and error kinds shared by the Jev client and the scanner."""

import logging
from collections.abc import Awaitable, Callable
from decimal import Decimal, InvalidOperation
from typing import Literal

import httpx

logger = logging.getLogger(__name__)

FailureKind = Literal["unavailable", "rate_limited", "budget", "not_configured", "bad_request"]

RETRY_STATUSES = frozenset({408, 409, 425, 429, 500, 502, 503, 504})


class GatewayFailure(Exception):
    """A request that failed for good. `detail` is for the logs only, never for students."""

    def __init__(self, kind: FailureKind, detail: str) -> None:
        super().__init__(f"{kind}: {detail}")
        self.kind: FailureKind = kind
        self.detail = detail


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
    """Retries timeouts, network errors, 429 and 5xx before giving up with a GatewayFailure."""
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
    text = response.text.lower()
    if status in (401, 403):
        return GatewayFailure("not_configured", detail)
    if status == 402 or "budget" in text or "insufficient" in text or "credit" in text:
        return GatewayFailure("budget", detail)
    if status == 429:
        return GatewayFailure("rate_limited", detail)
    if 400 <= status < 500:
        return GatewayFailure("bad_request", detail)
    return GatewayFailure("unavailable", detail)


def to_decimal(value: object) -> Decimal:
    try:
        return Decimal(str(value)) if value is not None else Decimal(0)
    except InvalidOperation:
        return Decimal(0)
