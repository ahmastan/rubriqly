"""The database tables (docs/architecture.md, "Data"). Draft text is never stored here."""

import secrets
from datetime import datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, ForeignKey, Index, Numeric, String, false, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from rubriqly.db import Base, UTCDateTime, utcnow

CHECK_STATUSES = ("ok", "failed", "rate_limited")
# `ok` and `not_a_rubric` count towards a student's weekly scans; see api/rubric_scans.py.
SCAN_STATUSES = ("ok", "not_a_rubric", "unreadable", "too_big", "failed", "rate_limited")


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(16)}"


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("email = lower(email)", name="email_lowercase"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("usr"))
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(60))
    # Unused until email confirmation is added.
    email_verified: Mapped[bool] = mapped_column(default=False, server_default=false())
    is_active: Mapped[bool] = mapped_column(default=True, server_default=true())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # Keyed hash of the sign-up network address, for the sign-ups-per-network limit.
    signup_ip_hash: Mapped[str | None] = mapped_column(String(64), index=True)

    sessions: Mapped[list["AuthSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    check_usage: Mapped[list["CheckUsage"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    rubric_scan_usage: Mapped[list["RubricScanUsage"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )


class AuthSession(Base):
    """One signed-in browser. Only a hash of the cookie's token is stored."""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("ses"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    user: Mapped[User] = relationship(back_populates="sessions")


class CheckUsage(Base):
    """One row per check, for the daily limits and cost tracking. No draft text."""

    __tablename__ = "check_usage"
    __table_args__ = (
        CheckConstraint(
            "status IN ({})".format(", ".join(f"'{s}'" for s in CHECK_STATUSES)),
            name="status_valid",
        ),
        Index("ix_check_usage_user_id_created_at", "user_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("use"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    status: Mapped[str] = mapped_column(String(20))
    input_tokens: Mapped[int] = mapped_column(default=0, server_default="0")
    cost_usd: Mapped[Decimal] = mapped_column(
        Numeric(12, 8), default=Decimal(0), server_default="0"
    )

    user: Mapped[User] = relationship(back_populates="check_usage")


class RubricScanUsage(Base):
    """One row per rubric-photo scan, for the weekly limit and cost tracking. No photos, no text."""

    __tablename__ = "rubric_scan_usage"
    __table_args__ = (
        CheckConstraint(
            "status IN ({})".format(", ".join(f"'{s}'" for s in SCAN_STATUSES)),
            name="status_valid",
        ),
        Index("ix_rubric_scan_usage_user_id_created_at", "user_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("scn"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    status: Mapped[str] = mapped_column(String(20))
    image_count: Mapped[int] = mapped_column(default=0, server_default="0")
    input_tokens: Mapped[int] = mapped_column(default=0, server_default="0")
    output_tokens: Mapped[int] = mapped_column(default=0, server_default="0")
    # List price, like check_usage.cost_usd, so usage shows real consumption on free credit too.
    cost_usd: Mapped[Decimal] = mapped_column(
        Numeric(12, 8), default=Decimal(0), server_default="0"
    )

    user: Mapped[User] = relationship(back_populates="rubric_scan_usage")
