import base64
import json
from datetime import datetime, timedelta
from decimal import Decimal

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_scan import completion, rubric_answer

from rubriqly.config import Settings
from rubriqly.db import utcnow
from rubriqly.main import create_app
from rubriqly.models import RubricScanUsage, User
from rubriqly.scan import GatewayScanClient, MockScanClient, ScanError, ScanImage, ScanResult
from rubriqly.scan.client import DEMO_RUBRIC

PASSWORD = "maple river quiet lamp"
PNG = b"\x89PNG\r\n\x1a\n" + b"rubric-photo-bytes"
JPEG = b"\xff\xd8\xff\xe0" + b"page-two"


def encoded(data: bytes) -> dict[str, str]:
    return {"data": base64.b64encode(data).decode("ascii")}


def sign_up(client: TestClient, email: str = "test1@rubriqly.com") -> TestClient:
    response = client.post(
        "/api/auth/signup",
        json={
            "display_name": "Test Student One",
            "email": email,
            "password": PASSWORD,
            "confirms_age": True,
            "accepts_terms": True,
        },
    )
    assert response.status_code == 201
    return client


def scan(client: TestClient, *images: bytes):
    return client.post("/api/rubric-scans", json={"images": [encoded(i) for i in images or [PNG]]})


def error_code(response) -> str:
    return response.json()["detail"]["code"]


class ScriptedScanner:
    """Fails with the given error, or returns the demo rubric at a real-looking price."""

    def __init__(self, error: ScanError | None = None) -> None:
        self.error = error
        self.calls: list[list[ScanImage]] = []

    async def aclose(self) -> None:
        pass

    async def scan(self, images: list[ScanImage]) -> ScanResult:
        self.calls.append(list(images))
        if self.error:
            raise self.error
        return ScanResult(
            rubric=DEMO_RUBRIC,
            model="google/gemini-2.5-flash",
            input_tokens=2431,
            output_tokens=1430,
            cost_usd=Decimal("0.0043043"),
            market_cost_usd=Decimal("0.0043043"),
        )


def spent(kind: str, cost: str = "0.002") -> ScanError:
    error = ScanError(kind)  # type: ignore[arg-type]
    error.input_tokens, error.output_tokens, error.market_cost_usd = 2400, 30, Decimal(cost)
    return error


@pytest.fixture
def student(client: TestClient) -> TestClient:
    return sign_up(client)


@pytest.fixture
def scanner(student: TestClient) -> ScriptedScanner:
    fake = ScriptedScanner()
    student.app.state.scanner = fake  # type: ignore[attr-defined]
    return fake


def rows(db: Session) -> list[RubricScanUsage]:
    db.expire_all()
    return list(db.scalars(select(RubricScanUsage).order_by(RubricScanUsage.created_at)))


def add_rows(db: Session, status: str, count: int, days_ago: float = 0) -> None:
    user = db.scalars(select(User)).one()
    for _ in range(count):
        db.add(
            RubricScanUsage(
                user_id=user.id, status=status, created_at=utcnow() - timedelta(days=days_ago)
            )
        )
    db.commit()


# The happy path


def test_scan_returns_the_rubric_and_the_quota(
    student: TestClient, scanner: ScriptedScanner, db: Session
) -> None:
    response = scan(student, PNG, JPEG)
    assert response.status_code == 200
    body = response.json()
    assert body["rubric"]["title"] == DEMO_RUBRIC.title
    assert body["rubric"]["levels"] == DEMO_RUBRIC.levels
    assert body["rubric"]["criteria"][0]["suggested_tips"][0]
    assert body["model"] == "google/gemini-2.5-flash"
    assert body["quota"]["used"] == 1
    assert body["quota"]["limit"] == 5
    assert body["quota"]["next_free_at"] is not None

    assert [image.media_type for image in scanner.calls[0]] == ["image/png", "image/jpeg"]
    assert scanner.calls[0][0].data == PNG
    [row] = rows(db)
    assert (row.status, row.image_count) == ("ok", 2)
    assert (row.input_tokens, row.output_tokens) == (2431, 1430)
    assert row.cost_usd == Decimal("0.0043043")


def test_the_mock_scanner_is_the_default(student: TestClient) -> None:
    assert isinstance(student.app.state.scanner, MockScanClient)  # type: ignore[attr-defined]
    response = scan(student)
    assert response.status_code == 200
    assert response.json()["model"] == "mock"


def test_quota_starts_empty(student: TestClient) -> None:
    response = student.get("/api/rubric-scans/quota")
    assert response.status_code == 200
    assert response.json() == {"available": True, "used": 0, "limit": 5, "next_free_at": None}


def test_nothing_is_stored_but_the_usage_row(
    student: TestClient, scanner: ScriptedScanner, db: Session
) -> None:
    scan(student)
    [row] = rows(db)
    stored = " ".join(str(getattr(row, c.key)) for c in RubricScanUsage.__table__.columns)
    assert "rubric-photo-bytes" not in stored
    assert DEMO_RUBRIC.criteria[0].descriptors[0] not in stored


# Signing in and photo checks


def test_scanning_needs_an_account(client: TestClient) -> None:
    assert scan(client).status_code == 401
    assert client.get("/api/rubric-scans/quota").status_code == 401


@pytest.mark.parametrize(
    ("images", "status", "code"),
    [
        ([{"data": "not base64!"}], 400, "bad_image"),
        ([encoded(b"GIF89a-not-allowed")], 400, "bad_image"),
        ([encoded(b"%PDF-1.7")], 400, "bad_image"),
        ([encoded(PNG + b"x" * 2_500_000)], 413, "image_too_big"),
    ],
)
def test_bad_photos_are_refused_before_scanning(
    student: TestClient,
    scanner: ScriptedScanner,
    db: Session,
    images: list,
    status: int,
    code: str,
) -> None:
    response = student.post("/api/rubric-scans", json={"images": images})
    assert response.status_code == status
    assert error_code(response) == code
    assert scanner.calls == []
    assert rows(db) == []


@pytest.mark.parametrize("count", [0, 4])
def test_one_to_three_photos(student: TestClient, scanner: ScriptedScanner, count: int) -> None:
    response = student.post("/api/rubric-scans", json={"images": [encoded(PNG)] * count})
    assert response.status_code == 422
    assert scanner.calls == []


def test_says_which_photo_is_wrong(student: TestClient, scanner: ScriptedScanner) -> None:
    response = scan(student, PNG, b"GIF89a")
    assert response.json()["detail"]["message"] == "Photo 2 isn't a JPG, PNG or WebP image."


# The weekly limit


def test_five_scans_a_week_then_a_friendly_refusal(
    student: TestClient, scanner: ScriptedScanner, db: Session
) -> None:
    for _ in range(5):
        assert scan(student).status_code == 200
    response = scan(student)
    assert response.status_code == 429
    assert error_code(response) == "weekly_scan_limit"
    assert "5 rubric scans" in response.json()["detail"]["message"]
    assert len(scanner.calls) == 5
    assert [r.status for r in rows(db)] == ["ok"] * 5 + ["rate_limited"]

    quota = student.get("/api/rubric-scans/quota").json()
    assert (quota["used"], quota["limit"]) == (5, 5)


def test_the_week_rolls(student: TestClient, scanner: ScriptedScanner, db: Session) -> None:
    add_rows(db, "ok", 4, days_ago=8)  # outside the 7 days: don't count
    add_rows(db, "ok", 4, days_ago=6)
    add_rows(db, "ok", 1, days_ago=1)
    quota = student.get("/api/rubric-scans/quota").json()
    assert quota["used"] == 5
    assert scan(student).status_code == 429

    # The oldest counted scan (6 days ago) frees up a day from now.
    next_free = datetime.fromisoformat(quota["next_free_at"])
    assert timedelta(hours=23) < next_free - utcnow() < timedelta(hours=25)


def test_not_a_rubric_counts_but_failures_dont(
    student: TestClient, scanner: ScriptedScanner, db: Session
) -> None:
    add_rows(db, "not_a_rubric", 2)
    add_rows(db, "unreadable", 3)
    add_rows(db, "too_big", 3)
    add_rows(db, "failed", 3)
    add_rows(db, "rate_limited", 3)
    assert student.get("/api/rubric-scans/quota").json()["used"] == 2


def test_the_limit_comes_from_settings(engine, settings: Settings) -> None:
    client = sign_up(
        TestClient(create_app(settings.model_copy(update={"rubric_scans_per_user_per_week": 1})))
    )
    assert scan(client).status_code == 200
    assert error_code(scan(client)) == "weekly_scan_limit"


def test_the_site_wide_daily_limit(engine, settings: Settings, db: Session) -> None:
    client = sign_up(
        TestClient(create_app(settings.model_copy(update={"rubric_scans_per_day": 2})))
    )
    sign_up(TestClient(client.app), "test2@rubriqly.com")
    other = db.scalars(select(User).where(User.email == "test2@rubriqly.com")).one()
    # Everything that reached the model counts, even failures; refusals don't.
    db.add_all(
        [
            RubricScanUsage(user_id=other.id, status="failed"),
            RubricScanUsage(user_id=other.id, status="rate_limited"),
        ]
    )
    db.commit()
    assert scan(client).status_code == 200
    response = scan(client)
    assert response.status_code == 429
    assert error_code(response) == "daily_scan_limit_site"


def test_production_never_serves_the_demo_scanner(engine, settings: Settings, db: Session) -> None:
    production = settings.model_copy(
        update={
            "environment": "production",
            "secret_key": SecretStr("a-long-random-production-secret"),
        }
    )
    # Production cookies are HTTPS-only.
    client = sign_up(TestClient(create_app(production), base_url="https://testserver"))
    assert client.get("/api/rubric-scans/quota").json()["available"] is False
    response = scan(client)
    assert response.status_code == 503
    assert error_code(response) == "scan_not_configured"
    assert rows(db) == []


# When scanning fails


@pytest.mark.parametrize("kind", ["not_a_rubric", "unreadable", "too_big"])
def test_photo_problems_ask_for_a_better_photo(
    student: TestClient, scanner: ScriptedScanner, db: Session, kind: str
) -> None:
    scanner.error = spent(kind)
    response = scan(student)
    assert response.status_code == 422
    assert error_code(response) == f"scan_{kind}"
    assert response.json()["detail"]["message"] == ScanError(kind).message  # type: ignore[arg-type]
    [row] = rows(db)
    assert row.status == kind
    assert (row.input_tokens, row.output_tokens, row.cost_usd) == (2400, 30, Decimal("0.002"))


@pytest.mark.parametrize("kind", ["unavailable", "rate_limited", "budget", "not_configured"])
def test_outages_are_503_and_dont_count(
    student: TestClient, scanner: ScriptedScanner, db: Session, kind: str
) -> None:
    scanner.error = ScanError(kind)  # type: ignore[arg-type]
    response = scan(student)
    assert response.status_code == 503
    assert error_code(response) == f"scan_{kind}"
    assert rows(db)[0].status == "failed"
    assert student.get("/api/rubric-scans/quota").json()["used"] == 0


def test_deleting_the_account_deletes_its_scan_rows(
    student: TestClient, scanner: ScriptedScanner, db: Session
) -> None:
    scan(student)
    response = student.request("DELETE", "/api/auth/me", json={"password": PASSWORD})
    assert response.status_code in (200, 204)
    assert rows(db) == []


# The whole path: the API with the real gateway client, only Vercel's replies faked


def gateway_scanner(*replies: httpx.Response) -> tuple[GatewayScanClient, list[httpx.Request]]:
    sent: list[httpx.Request] = []

    def reply(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return replies[len(sent) - 1]

    async def no_wait(_seconds: float) -> None:
        pass

    live = Settings(_env_file=None, scan_mode="live", ai_gateway_api_key="test-gateway-key")
    http = httpx.AsyncClient(transport=httpx.MockTransport(reply))
    return GatewayScanClient(live, http=http, sleep=no_wait), sent


def test_a_real_scan_through_the_api(student: TestClient, db: Session) -> None:
    scanner, sent = gateway_scanner(httpx.Response(200, json=completion(rubric_answer())))
    student.app.state.scanner = scanner  # type: ignore[attr-defined]

    response = scan(student, PNG)
    assert response.status_code == 200
    body = response.json()
    assert body["rubric"]["levels"] == ["Starting", "Developing", "Advanced"]
    assert body["model"] == "google/gemini-2.5-flash"
    assert body["quota"]["used"] == 1

    request = json.loads(sent[0].content)
    assert request["messages"][1]["content"][1]["image_url"]["url"].startswith(
        "data:image/png;base64,"
    )
    [row] = rows(db)
    assert (row.status, row.input_tokens, row.output_tokens) == ("ok", 1800, 900)
    assert row.cost_usd == Decimal("0.0042")


def test_a_model_the_gateway_refuses_is_a_setup_problem(student: TestClient, db: Session) -> None:
    # How the gateway refuses a model the account can't use.
    refused = httpx.Response(
        403,
        json={
            "error": {
                "message": "Free tier users do not have access to this model.",
                "type": "no_providers_available",
            }
        },
    )
    scanner, _ = gateway_scanner(refused)
    student.app.state.scanner = scanner  # type: ignore[attr-defined]

    response = scan(student)
    assert response.status_code == 503
    assert error_code(response) == "scan_not_configured"
    assert "Free tier" not in response.json()["detail"]["message"]
    assert rows(db)[0].status == "failed"
    assert student.get("/api/rubric-scans/quota").json()["used"] == 0
