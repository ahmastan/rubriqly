"""The shapes of a rubric scan: the photos going in, and the rubric coming out.

The limits match what a check accepts (`scoring/compile.py`, `RubricIn`), so every scan can be
used for checking once the student has filled in anything left empty.
"""

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict

MediaType = Literal["image/jpeg", "image/png", "image/webp"]

MAX_LEVELS = 8
MAX_CRITERIA = 12
MAX_CHECKLIST = 15
MAX_NAME = 120
MAX_TEXT = 600


def sniff_media_type(data: bytes) -> MediaType | None:
    """The image type from the file's first bytes (never trust the name or the browser's label)."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


class ScanImage(BaseModel):
    media_type: MediaType
    data: bytes


class ScannedCriterion(BaseModel):
    name: str
    # One per level, lowest first, copied from the rubric. Empty when the cell was empty.
    descriptors: list[str]
    # Written by the model, not on the rubric: the student checks these in the builder.
    suggested_question: str
    suggested_tips: list[str]


class ScannedChecklistItem(BaseModel):
    name: str
    suggested_question: str


class WordCount(BaseModel):
    min: int | None = None
    max: int | None = None


class ScannedRubric(BaseModel):
    """A rubric read from photos. Levels, descriptors and tips are ordered lowest level first."""

    title: str
    levels: list[str]
    criteria: list[ScannedCriterion]
    checklist: list[ScannedChecklistItem] = []
    word_count: WordCount | None = None
    # Anything the model couldn't read or wasn't sure about, shown to the student.
    notes: str = ""


class ScanResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    rubric: ScannedRubric
    model: str
    input_tokens: int
    output_tokens: int
    # What Vercel charged (0 while free credit covers it) and the list price.
    cost_usd: Decimal
    market_cost_usd: Decimal
    generation_id: str | None = None
