"""create rubric_scan_usage

Revision ID: 4b8e2d61c9a3
Revises: cfc5b5204ff6
Create Date: 2026-09-26 16:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import rubriqly.db

# revision identifiers, used by Alembic.
revision: str = "4b8e2d61c9a3"
down_revision: str | Sequence[str] | None = "cfc5b5204ff6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "rubric_scan_usage",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("user_id", sa.String(length=40), nullable=False),
        sa.Column("created_at", rubriqly.db.UTCDateTime(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("image_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("input_tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("output_tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "cost_usd", sa.Numeric(precision=12, scale=8), server_default="0", nullable=False
        ),
        sa.CheckConstraint(
            "status IN ('ok', 'not_a_rubric', 'unreadable', 'too_big', 'failed', 'rate_limited')",
            name=op.f("ck_rubric_scan_usage_status_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_rubric_scan_usage_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_rubric_scan_usage")),
    )
    op.create_index(op.f("ix_rubric_scan_usage_created_at"), "rubric_scan_usage", ["created_at"])
    op.create_index(
        "ix_rubric_scan_usage_user_id_created_at", "rubric_scan_usage", ["user_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_table("rubric_scan_usage")
