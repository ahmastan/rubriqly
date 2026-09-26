"""`/api/rubric-scans`: turn photos of a rubric into a rubric the student checks in the builder.

The photos are read and forgotten: they're never stored or logged, and the scanned rubric lives
in the browser like every other rubric. Each attempt leaves one `rubric_scan_usage` row (status,
photo count, tokens, list-price cost) for the limits and `rubriqly usage`.

Limits: each student gets `RUBRIC_SCANS_PER_USER_PER_WEEK` scans in any 7 days. Scans that read a
rubric (`ok`) or showed something that isn't one (`not_a_rubric`, to stop free junk uploads)
count. Blurry or oversized rubrics and outages don't: they aren't the student's fault. The
site-wide `RUBRIC_SCANS_PER_DAY` counts everything that reached the model.
"""

import base64
import binascii
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Annotated

import anyio.from_thread
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import func, select

from rubriqly.api.errors import api_error
from rubriqly.auth.deps import AppSettings, CurrentUser, DbSession
from rubriqly.auth.limits import start_of_utc_day
from rubriqly.config import Settings
from rubriqly.db import utcnow
from rubriqly.models import RubricScanUsage, User
from rubriqly.scan import ScanClient, ScanError, ScanImage, ScannedRubric, sniff_media_type

router = APIRouter(tags=["rubric scans"])

MAX_IMAGES = 3
MAX_IMAGE_BYTES = 2_500_000
WEEK = timedelta(days=7)
COUNTED = ("ok", "not_a_rubric")
# Problems with the photo get a 422 so the page can ask for a better one; the rest are outages.
PHOTO_PROBLEMS = frozenset({"not_a_rubric", "unreadable", "too_big"})


class ImageIn(BaseModel):
    # Base64 of the image file. Room for twice the real limit, which is checked after decoding
    # so a photo that's a little too big gets a friendly message.
    data: Annotated[str, StringConstraints(max_length=4 * (2 * MAX_IMAGE_BYTES) // 3)]


class ScanIn(BaseModel):
    images: Annotated[list[ImageIn], Field(min_length=1, max_length=MAX_IMAGES)]


class QuotaOut(BaseModel):
    # False when this server can't really read photos (see `scanning_available`).
    available: bool
    used: int
    limit: int
    # When the oldest counted scan leaves the 7-day window, if any are in it.
    next_free_at: datetime | None


class ScanOut(BaseModel):
    rubric: ScannedRubric
    model: str
    quota: QuotaOut


def scan_limit_for(_user: User, settings: Settings) -> int:
    """How many scans a student gets per 7 days. The one place a paid plan will change."""
    return settings.rubric_scans_per_user_per_week


def scanning_available(settings: Settings) -> bool:
    """The free mock returns a fixed demo rubric: fine for development, never for real students."""
    return not (settings.environment == "production" and settings.scan_mode == "mock")


def quota_for(db: DbSession, user: User, settings: Settings) -> QuotaOut:
    since = utcnow() - WEEK
    times = db.scalars(
        select(RubricScanUsage.created_at)
        .where(
            RubricScanUsage.user_id == user.id,
            RubricScanUsage.status.in_(COUNTED),
            RubricScanUsage.created_at > since,
        )
        .order_by(RubricScanUsage.created_at)
    ).all()
    return QuotaOut(
        available=scanning_available(settings),
        used=len(times),
        limit=scan_limit_for(user, settings),
        next_free_at=times[0] + WEEK if times else None,
    )


def scans_today(db: DbSession) -> int:
    query = select(func.count()).select_from(RubricScanUsage)
    query = query.where(
        RubricScanUsage.created_at >= start_of_utc_day(utcnow()),
        RubricScanUsage.status != "rate_limited",
    )
    return db.scalar(query) or 0


def record(
    db: DbSession,
    user_id: str,
    status: str,
    image_count: int,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cost_usd: Decimal = Decimal(0),
) -> None:
    db.add(
        RubricScanUsage(
            user_id=user_id,
            status=status,
            image_count=image_count,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost_usd,
        )
    )
    db.commit()


def decode_images(body: ScanIn) -> list[ScanImage]:
    images = []
    for number, image in enumerate(body.images, start=1):
        try:
            data = base64.b64decode(image.data, validate=True)
        except (binascii.Error, ValueError):
            raise api_error(400, "bad_image", f"Photo {number} couldn't be read.") from None
        if len(data) > MAX_IMAGE_BYTES:
            raise api_error(
                413,
                "image_too_big",
                f"Photo {number} is too big. Photos can be up to "
                f"{MAX_IMAGE_BYTES / 1_000_000:.1f} MB.",
            )
        media_type = sniff_media_type(data)
        if media_type is None:
            raise api_error(400, "bad_image", f"Photo {number} isn't a JPG, PNG or WebP image.")
        images.append(ScanImage(media_type=media_type, data=data))
    return images


@router.get("/rubric-scans/quota")
def get_quota(current: CurrentUser, db: DbSession, settings: AppSettings) -> QuotaOut:
    return quota_for(db, current.user, settings)


@router.post("/rubric-scans")
def create_scan(
    body: ScanIn, request: Request, current: CurrentUser, db: DbSession, settings: AppSettings
) -> ScanOut:
    if not scanning_available(settings):
        raise api_error(503, "scan_not_configured", ScanError("not_configured").message)
    # Cheap checks first, before any limit is used or any money is spent.
    images = decode_images(body)
    user = current.user

    quota = quota_for(db, user, settings)
    if quota.used >= quota.limit:
        record(db, user.id, "rate_limited", len(images))
        raise api_error(
            429,
            "weekly_scan_limit",
            f"You've used your {quota.limit} rubric scans for this week.",
        )
    if scans_today(db) >= settings.rubric_scans_per_day:
        record(db, user.id, "rate_limited", len(images))
        raise api_error(
            429,
            "daily_scan_limit_site",
            "Rubriqly has reached today's rubric scanning limit. Please try again tomorrow.",
        )

    scanner: ScanClient = request.app.state.scanner
    try:
        result = anyio.from_thread.run(scanner.scan, images)
    except ScanError as error:
        status = error.kind if error.kind in PHOTO_PROBLEMS else "failed"
        record(
            db,
            user.id,
            status,
            len(images),
            error.input_tokens,
            error.output_tokens,
            error.market_cost_usd,
        )
        code = 422 if error.kind in PHOTO_PROBLEMS else 503
        raise api_error(code, f"scan_{error.kind}", error.message) from None

    record(
        db,
        user.id,
        "ok",
        len(images),
        result.input_tokens,
        result.output_tokens,
        result.market_cost_usd,
    )
    return ScanOut(rubric=result.rubric, model=result.model, quota=quota_for(db, user, settings))
