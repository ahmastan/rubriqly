"""Limits on sign-in attempts and sign-ups (docs/architecture.md, "Limits")."""

import hashlib
import hmac
import threading
from collections import Counter
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from rubriqly.config import Settings
from rubriqly.db import utcnow
from rubriqly.models import User


def start_of_utc_day(now: datetime) -> datetime:
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


@dataclass
class _Failures:
    count: int
    first_at: datetime
    locked_until: datetime | None = None


class LoginThrottle:
    """Locks an email after too many wrong passwords.

    Kept in memory: Rubriqly runs as a single server, and a restart only forgets the lock early.
    """

    def __init__(
        self, max_failures: int, lock_minutes: int, clock: Callable[[], datetime] = utcnow
    ) -> None:
        self.max_failures = max_failures
        self.window = timedelta(minutes=lock_minutes)
        self.clock = clock
        self._failures: dict[str, _Failures] = {}
        self._lock = threading.Lock()

    def is_locked(self, email: str) -> bool:
        with self._lock:
            entry = self._current(email)
            return entry is not None and entry.locked_until is not None

    def record_failure(self, email: str) -> None:
        now = self.clock()
        with self._lock:
            entry = self._current(email)
            if entry is None:
                entry = self._failures[email] = _Failures(count=0, first_at=now)
            entry.count += 1
            if entry.count >= self.max_failures:
                entry.locked_until = now + self.window

    def clear(self, email: str) -> None:
        with self._lock:
            self._failures.pop(email, None)

    def _current(self, email: str) -> _Failures | None:
        """The entry for this email, dropping it once its lock or counting window has passed."""
        entry = self._failures.get(email)
        if entry is None:
            return None
        now = self.clock()
        expired = (
            entry.locked_until <= now
            if entry.locked_until is not None
            else entry.first_at + self.window <= now
        )
        if expired:
            del self._failures[email]
            return None
        return entry


class InFlight:
    """Checks (or scans) that are still running, so the limits count them too.

    A check's usage row is only written once Jev has answered, seconds later. Without this,
    requests sent at the same moment would all pass the limits before any of them was recorded.
    Kept in memory, like LoginThrottle: Rubriqly runs as a single server.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._by_user: Counter[str] = Counter()
        self._total = 0

    @contextmanager
    def admit[T](self, user_id: str, refusal: Callable[[int, int], T | None]) -> Iterator[T | None]:
        """Yields `refusal(running for this user, running site-wide)`; None means admitted.

        The limits are checked and the slot taken in one step, so two requests can't both take
        the last one. Keep the request inside the `with` until its usage row is committed.
        """
        with self._lock:
            refused = refusal(self._by_user[user_id], self._total)
            if refused is None:
                self._by_user[user_id] += 1
                self._total += 1
        try:
            yield refused
        finally:
            if refused is None:
                with self._lock:
                    self._by_user[user_id] -= 1
                    if self._by_user[user_id] <= 0:
                        del self._by_user[user_id]
                    self._total -= 1


def network_hash(request: Request, settings: Settings) -> str | None:
    """A keyed hash of the visitor's address. The address itself is never stored."""
    address = None
    if settings.client_ip_header:
        value = request.headers.get(settings.client_ip_header, "")
        address = value.split(",")[0].strip() or None
    if address is None and request.client is not None:
        address = request.client.host
    if not address:
        return None
    key = settings.secret_key.get_secret_value().encode()
    return hmac.new(key, address.encode(), hashlib.sha256).hexdigest()


def signup_limit_reached(db: Session, settings: Settings, network: str | None) -> str | None:
    """Which daily sign-up limit is reached ('network' or 'site'), if any."""
    today = start_of_utc_day(utcnow())
    if network is not None:
        from_network = db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.signup_ip_hash == network, User.created_at >= today)
        )
        if (from_network or 0) >= settings.signups_per_network_per_day:
            return "network"
    site = db.scalar(select(func.count()).select_from(User).where(User.created_at >= today))
    if (site or 0) >= settings.signups_per_day:
        return "site"
    return None
