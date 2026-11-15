import asyncio
import copy
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from samples import RUBRIC
from sqlalchemy import select
from sqlalchemy.orm import Session

from rubriqly.config import Settings
from rubriqly.jev import (
    BooleanAnswer,
    BooleanQuestion,
    EvaluateResult,
    JevError,
    MockJevClient,
    ScoreAnswer,
    State,
)
from rubriqly.main import create_app
from rubriqly.models import CheckUsage

DRAFT = """Why the Printing Press Changed Europe

This is an example draft. The printing press changed Europe because books became cheaper.

For example, book prices fell sharply after 1450, which shows that ideas could spread faster.

In conclusion, cheaper books changed who could read and argue about ideas."""


def sign_up(client: TestClient, email: str = "test1@rubriqly.com") -> TestClient:
    response = client.post(
        "/api/auth/signup",
        json={
            "display_name": "Test Student One",
            "email": email,
            "password": "maple river quiet lamp",
            "confirms_age": True,
            "accepts_terms": True,
        },
    )
    assert response.status_code == 201
    return client


def check(client: TestClient, **overrides: Any):
    body = {"rubric": RUBRIC, "prompt": "Did the printing press change Europe?", "text": DRAFT}
    return client.post("/api/checks", json={**body, **overrides})


def error_code(response) -> str:
    return response.json()["detail"]["code"]


class ScriptedJev:
    """Fixed answers, a real list price, optional failures and a concurrency counter."""

    def __init__(self, fail_paragraphs: bool = False) -> None:
        self.fail_paragraphs = fail_paragraphs
        self.running = 0
        self.most_at_once = 0

    async def aclose(self) -> None:
        pass

    async def evaluate(self, state: State, questions: dict) -> EvaluateResult:
        self.running += 1
        self.most_at_once = max(self.most_at_once, self.running)
        try:
            await asyncio.sleep(0.01)
            if self.fail_paragraphs and isinstance(state, dict) and "paragraph" in state:
                raise JevError("rate_limited", "429 from gateway")
            answers: dict = {}
            for key, question in questions.items():
                if isinstance(question, BooleanQuestion):
                    answers[key] = BooleanAnswer(
                        type="boolean", probability=0.3 if key == "analysis" else 0.8
                    )
                else:
                    answers[key] = ScoreAnswer(
                        type="score",
                        score=2.65,
                        probabilities={"0": 0, "1": 0.02, "2": 0.3, "3": 0.68},
                        confidence=0.65,
                    )
            return EvaluateResult(
                model="typesafe-ai/jev",
                answers=answers,
                input_tokens=100,
                cost_usd=Decimal(0),
                market_cost_usd=Decimal("0.0000042"),
            )
        finally:
            self.running -= 1


@pytest.fixture
def student(client: TestClient) -> TestClient:
    return sign_up(client)


@pytest.fixture
def client_with(engine, settings: Settings):
    def make(**changes: Any) -> TestClient:
        return sign_up(TestClient(create_app(settings.model_copy(update=changes))))

    return make


def usage_rows(db: Session) -> list[CheckUsage]:
    db.expire_all()
    return list(db.scalars(select(CheckUsage).order_by(CheckUsage.created_at)))


# The happy path


def test_check_returns_scores_for_the_browser(student: TestClient, db: Session) -> None:
    response = check(student)
    assert response.status_code == 200
    result = response.json()

    assert result["model"] == "mock"
    assert result["title"] == "Why the Printing Press Changed Europe"
    assert result["word_count"] == len(DRAFT.split())
    [thesis] = result["criteria"]
    assert thesis["id"] == "thesis"
    assert 1 <= thesis["level"] <= 4
    assert 0 <= thesis["confidence"] <= 1
    assert len(thesis["probabilities"]) == 4
    assert [item["id"] for item in result["checklist"]] == ["has-title"]

    paragraphs = result["paragraphs"]
    assert [p["n"] for p in paragraphs] == [1, 2, 3]  # counted after the title, like the browser
    assert [p["is_intro"] for p in paragraphs] == [True, False, False]
    assert [p["is_conclusion"] for p in paragraphs] == [False, False, True]
    assert [t["label"] for t in paragraphs[0]["tags"]] == ["Claim", "Context"]
    assert [t["label"] for t in paragraphs[1]["tags"]] == ["Claim", "Evidence", "Analysis"]
    assert [t["label"] for t in paragraphs[2]["tags"]] == ["Claim", "Significance"]

    [row] = usage_rows(db)
    assert row.status == "ok"


def test_one_rubric_request_and_one_per_paragraph_without_tips(
    student: TestClient,
) -> None:
    check(student)
    mock: MockJevClient = student.app.state.jev
    assert len(mock.calls) == 1 + 3

    rubric_state, rubric_questions = mock.calls[0]
    assert rubric_state == {
        "draft": DRAFT,
        "assignment_prompt": "Did the printing press change Europe?",
    }
    assert set(rubric_questions) == {"criterion_0", "check_0"}
    sent = json.dumps(
        [(state, {k: q.model_dump() for k, q in qs.items()}) for state, qs in mock.calls]
    )
    assert "SECRET TIP" not in sent


def test_scores_and_list_price_are_recorded(student: TestClient, db: Session) -> None:
    student.app.state.jev = ScriptedJev()
    result = check(student).json()

    assert result["model"] == "typesafe-ai/jev"
    assert result["criteria"][0]["level"] == 3.65
    assert result["criteria"][0]["confidence"] == 0.65
    assert result["paragraphs"][1]["weak"] is True  # analysis answered 0.3

    [row] = usage_rows(db)
    assert row.status == "ok"
    assert row.input_tokens == 4 * 100
    # The list price, even though Vercel charged $0 (the free credit).
    assert row.cost_usd == Decimal("0.0000168")


def test_requests_run_a_few_at_a_time(client_with) -> None:
    client = client_with(jev_max_parallel=2)
    jev = ScriptedJev()
    client.app.state.jev = jev
    many = "\n\n".join(f"Paragraph {i} has a point." for i in range(8))
    assert check(client, text=many).status_code == 200
    assert jev.most_at_once == 2


# Refusals before scoring


def test_signed_out_students_cannot_check(client: TestClient) -> None:
    response = check(client)
    assert response.status_code == 401
    assert error_code(response) == "not_signed_in"


def test_empty_draft(student: TestClient, db: Session) -> None:
    response = check(student, text="  \n\n ")
    assert error_code(response) == "empty_draft"
    assert usage_rows(db) == []


def test_word_limit(client_with, db: Session) -> None:
    client = client_with(max_words=20)
    response = check(client)
    assert response.status_code == 400
    assert error_code(response) == "draft_too_long"
    assert "up to 20 words" in response.json()["detail"]["message"]
    assert usage_rows(db) == []


def test_paragraph_limit(client_with) -> None:
    client = client_with(max_paragraphs=2)
    response = check(client)
    assert error_code(response) == "too_many_paragraphs"


def test_invalid_rubric_is_refused(student: TestClient) -> None:
    rubric = copy.deepcopy(RUBRIC)
    rubric["criteria"][0]["descriptors"] = ["only", "three", "levels"]
    assert check(student, rubric=rubric).status_code == 422


# Daily limits


def test_daily_limit_per_student(client_with, db: Session) -> None:
    client = client_with(checks_per_user_per_day=2)
    assert check(client).status_code == 200
    assert check(client).status_code == 200
    response = check(client)
    assert response.status_code == 429
    assert error_code(response) == "daily_limit_user"
    assert [row.status for row in usage_rows(db)] == ["ok", "ok", "rate_limited"]


def test_failed_checks_dont_use_up_a_students_limit(client_with) -> None:
    client = client_with(checks_per_user_per_day=1)
    client.app.state.jev = ScriptedJev(fail_paragraphs=True)
    assert check(client).status_code == 503
    client.app.state.jev = ScriptedJev()
    assert check(client).status_code == 200


def test_site_wide_daily_limit(client_with) -> None:
    client = client_with(checks_per_day=1)
    assert check(client).status_code == 200
    other = sign_up(TestClient(client.app), email="test2@rubriqly.com")
    response = check(other)
    assert response.status_code == 429
    assert error_code(response) == "daily_limit_site"


# Failures


def test_failure_gives_an_error_never_a_partial_result(student: TestClient, db: Session) -> None:
    student.app.state.jev = ScriptedJev(fail_paragraphs=True)
    response = check(student)

    assert response.status_code == 503
    assert error_code(response) == "scoring_rate_limited"
    assert "try again" in response.json()["detail"]["message"]
    assert "criteria" not in response.json()

    [row] = usage_rows(db)
    assert row.status == "failed"
    assert row.input_tokens == 100  # the rubric request succeeded and still cost something
    assert row.cost_usd == Decimal("0.0000042")


# Checks sent at the same moment


class SlowJev(ScriptedJev):
    """Takes a moment, like the real Jev, so requests overlap."""

    async def evaluate(self, state: State, questions: dict) -> EvaluateResult:
        await asyncio.sleep(0.2)
        return await super().evaluate(state, questions)


def all_at_once(clients: list[TestClient]) -> list[int]:
    with ThreadPoolExecutor(len(clients)) as pool:
        return sorted(pool.map(lambda c: check(c).status_code, clients))


def test_checks_sent_at_once_cant_get_past_a_students_limit(client_with, db: Session) -> None:
    client = client_with(checks_per_user_per_day=2)
    client.app.state.jev = SlowJev()
    assert all_at_once([client] * 6) == [200, 200, 429, 429, 429, 429]
    assert sorted(row.status for row in usage_rows(db)) == ["ok"] * 2 + ["rate_limited"] * 4


def test_checks_sent_at_once_cant_get_past_the_site_limit(client_with) -> None:
    client = client_with(checks_per_day=2)
    client.app.state.jev = SlowJev()
    students = [client] + [
        sign_up(TestClient(client.app), email=f"test{n}@rubriqly.com") for n in (2, 3, 4)
    ]
    assert all_at_once(students) == [200, 200, 429, 429]


def test_finished_and_failed_checks_free_their_place(client_with) -> None:
    client = client_with(checks_per_user_per_day=2)
    client.app.state.jev = ScriptedJev(fail_paragraphs=True)
    assert check(client).status_code == 503
    client.app.state.jev = ScriptedJev()
    assert check(client).status_code == 200
    assert check(client).status_code == 200
    assert check(client).status_code == 429
    in_flight = client.app.state.checks_in_flight
    with in_flight.admit("anyone", lambda user, site: (user, site)) as running:
        assert running == (0, 0)


# Odd replies from Jev


class ExtraAnswersJev(ScriptedJev):
    """Answers every question in reverse order, plus one nobody asked for."""

    async def evaluate(self, state: State, questions: dict) -> EvaluateResult:
        result = await super().evaluate(state, questions)
        answers = dict(reversed(result.answers.items()))
        answers["surprise"] = ScoreAnswer(type="score", score=1, probabilities={"1": 1})
        return result.model_copy(update={"answers": answers})


def test_extra_or_reordered_answers_dont_change_the_tags(student: TestClient) -> None:
    student.app.state.jev = ExtraAnswersJev()
    response = check(student)
    assert response.status_code == 200
    paragraphs = response.json()["paragraphs"]
    assert [t["label"] for t in paragraphs[0]["tags"]] == ["Claim", "Context"]
    assert [t["label"] for t in paragraphs[1]["tags"]] == ["Claim", "Evidence", "Analysis"]


def test_failures_are_logged_without_the_draft(
    student: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    student.app.state.jev = ScriptedJev(fail_paragraphs=True)
    check(student)
    assert "check failed: rate_limited" in caplog.text
    assert "printing press" not in caplog.text.lower()
