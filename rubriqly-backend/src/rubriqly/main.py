"""FastAPI application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import sessionmaker

from rubriqly.api import auth, checks, health, rubric_scans
from rubriqly.auth.limits import LoginThrottle
from rubriqly.config import Settings, get_settings
from rubriqly.db import make_engine
from rubriqly.jev import make_jev_client
from rubriqly.scan import make_scan_client


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = make_engine(settings.database_url)
    jev = make_jev_client(settings)
    scanner = make_scan_client(settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield
        await jev.aclose()
        await scanner.aclose()
        engine.dispose()

    app = FastAPI(title="Rubriqly", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.engine = engine
    app.state.jev = jev
    app.state.scanner = scanner
    app.state.sessionmaker = sessionmaker(engine, expire_on_commit=False)
    app.state.login_throttle = LoginThrottle(
        settings.login_failures_before_lock, settings.login_lock_minutes
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router, prefix="/api")
    app.include_router(auth.router, prefix="/api")
    app.include_router(checks.router, prefix="/api")
    app.include_router(rubric_scans.router, prefix="/api")
    return app


app = create_app()
