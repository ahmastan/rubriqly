"""Application settings, read from environment variables (and an optional .env file)."""

from functools import lru_cache
from typing import Annotated, Literal, Self

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

DEV_SECRET_KEY = "dev-only-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: Literal["development", "production", "test"] = "development"
    # Neon's connection string can be pasted as-is; the psycopg driver name is added below.
    database_url: str = "sqlite:///./rubriqly.db"
    secret_key: SecretStr = SecretStr(DEV_SECRET_KEY)
    # Comma-separated in the environment, e.g. ALLOWED_ORIGINS=http://localhost:5173,https://example.org
    allowed_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173"]
    )

    # Jev through Vercel AI Gateway. `mock` never makes a network call; `live` costs money.
    jev_mode: Literal["mock", "live"] = "mock"
    ai_gateway_api_key: SecretStr = SecretStr("")
    jev_model: str = "typesafe-ai/jev"
    jev_base_url: str = "https://ai-gateway.vercel.sh/v1"
    jev_timeout_seconds: float = Field(default=30.0, gt=0)

    # Reading rubric photos: a vision model through the same gateway (JEV_BASE_URL) and key.
    # It only ever sees rubric photos, never drafts. `mock` is free; `live` costs money.
    scan_mode: Literal["mock", "live"] = "mock"
    # Newer Gemini models (e.g. google/gemini-3.8-flash) need paid gateway credits.
    scan_model: str = "google/gemini-2.5-flash"
    scan_timeout_seconds: float = Field(default=60.0, gt=0)

    # Accounts
    session_days: int = Field(default=30, gt=0)
    login_failures_before_lock: int = Field(default=5, gt=0)
    login_lock_minutes: int = Field(default=15, gt=0)
    # Sign-up asks people to confirm they are at least this old (self-declared, not verified).
    min_age: int = Field(default=13, gt=0)
    # Header holding the visitor's address behind Render's proxy (confirmed in phase H).
    # Empty = use the direct connection's address.
    client_ip_header: str = ""

    # Limits that protect the Jev budget (docs/architecture.md, "Limits"). Days are UTC days.
    max_words: int = Field(default=10_000, gt=0)
    # Each paragraph is one small Jev request for its tags; this many run at the same time.
    max_paragraphs: int = Field(default=60, gt=0)
    jev_max_parallel: int = Field(default=4, gt=0)
    signups_per_network_per_day: int = Field(default=5, gt=0)
    signups_per_day: int = Field(default=100, gt=0)
    checks_per_user_per_day: int = Field(default=30, gt=0)
    checks_per_day: int = Field(default=500, gt=0)
    # Rubric photo scans: per student over any 7 days (a paid plan will raise this), and site-wide
    # per UTC day. See api/rubric_scans.py for what counts.
    rubric_scans_per_user_per_week: int = Field(default=5, gt=0)
    rubric_scans_per_day: int = Field(default=200, gt=0)

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("database_url")
    @classmethod
    def use_psycopg_driver(cls, value: str) -> str:
        value = value.strip()
        for prefix in ("postgresql://", "postgres://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value.removeprefix(prefix)
        return value

    @property
    def cookie_secure(self) -> bool:
        """Cookies are HTTPS-only in production; local development runs on plain http."""
        return self.environment == "production"

    @model_validator(mode="after")
    def check_required_secrets(self) -> Self:
        if self.jev_mode == "live" and not self.ai_gateway_api_key.get_secret_value():
            raise ValueError("JEV_MODE=live needs AI_GATEWAY_API_KEY to be set")
        if self.scan_mode == "live" and not self.ai_gateway_api_key.get_secret_value():
            raise ValueError("SCAN_MODE=live needs AI_GATEWAY_API_KEY to be set")
        if self.environment == "production" and (
            self.secret_key.get_secret_value() == DEV_SECRET_KEY
        ):
            raise ValueError("SECRET_KEY must be set to a long random value in production")
        # A missing DATABASE_URL would fall back to a SQLite file, which Render wipes on every
        # deploy and restart: accounts would silently disappear. Refuse to start instead.
        if self.environment == "production" and not self.database_url.startswith("postgresql"):
            raise ValueError("DATABASE_URL must be the Neon production connection string")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
