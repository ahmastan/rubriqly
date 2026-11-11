import asyncio
import json
import logging
from decimal import Decimal
from typing import Any

import httpx
import pytest

from rubriqly.config import Settings
from rubriqly.jev import (
    BooleanAnswer,
    BooleanQuestion,
    GatewayJevClient,
    JevError,
    MockJevClient,
    ScoreAnswer,
    ScoreQuestion,
    make_jev_client,
)
from rubriqly.main import create_app

API_KEY = "test-gateway-key-do-not-log"

QUESTIONS = {
    "thesis": ScoreQuestion(
        instructions="How clear and arguable is the main claim?",
        criteria=[
            "No clear claim",
            "A claim that only restates the prompt",
            "A clear claim with some reasoning",
            "A clear, specific, arguable claim that previews the reasoning",
        ],
    ),
    "uses_evidence": BooleanQuestion(
        instructions="Does the draft support its claim with specific evidence?"
    ),
}

# The real response from the first Jev call (23 September 2026).
REAL_RESPONSE: dict[str, Any] = {
    "model": "typesafe-ai/jev",
    "answers": {
        "thesis": {
            "type": "score",
            "score": 2.65,
            "probabilities": {"0": 0, "1": 0.02, "2": 0.3, "3": 0.68},
            "confidence": 0.65,
        },
        "uses_evidence": {"type": "boolean", "probability": 0.77},
    },
    "usage": {"inputTokens": 395, "outputTokens": 37},
    "providerMetadata": {
        "typesafe": {"confidence": {"thesis": 0.65}},
        "gateway": {
            "routing": {"finalProvider": "typesafe-ai", "modelAttemptCount": 1},
            "cost": "0",
            "marketCost": "0.00001659",
            "surchargeCost": "0",
            "gatewayCost": "0",
            "generationId": "gen_01M37K86V4VFM5VAKTYNYVQZH8",
        },
    },
}


def settings(**changes: Any) -> Settings:
    return Settings(_env_file=None, jev_mode="live", ai_gateway_api_key=API_KEY, **changes)


class FakeGateway:
    """Plays back responses in order and records each request."""

    def __init__(self, *replies: httpx.Response | Exception) -> None:
        self.replies = list(replies)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def client_for(gateway: FakeGateway, **changes: Any) -> tuple[GatewayJevClient, list[float]]:
    slept: list[float] = []

    async def no_wait(seconds: float) -> None:
        slept.append(seconds)

    http = httpx.AsyncClient(transport=httpx.MockTransport(gateway))
    return GatewayJevClient(settings(**changes), http=http, sleep=no_wait), slept


def evaluate(client: GatewayJevClient | MockJevClient, state: Any = "Example draft.") -> Any:
    return asyncio.run(client.evaluate(state, QUESTIONS))


# Requests


def test_request_matches_the_vercel_api() -> None:
    gateway = FakeGateway(httpx.Response(200, json=REAL_RESPONSE))
    client, _ = client_for(gateway)
    evaluate(client, {"prompt": "Did the printing press change Europe?", "draft": "..."})

    request = gateway.requests[0]
    assert str(request.url) == "https://ai-gateway.vercel.sh/v1/evaluate"
    assert request.headers["authorization"] == f"Bearer {API_KEY}"
    body = json.loads(request.content)
    assert body["model"] == "typesafe-ai/jev"
    assert body["state"]["prompt"] == "Did the printing press change Europe?"
    assert body["questions"]["thesis"]["type"] == "score"
    assert body["questions"]["thesis"]["criteria"][0] == "No clear claim"
    assert body["questions"]["uses_evidence"] == {
        "type": "boolean",
        "instructions": "Does the draft support its claim with specific evidence?",
    }
    assert body["providerOptions"] == {"gateway": {"disallowPromptTraining": True}}


def test_base_url_and_model_come_from_settings() -> None:
    gateway = FakeGateway(httpx.Response(200, json=REAL_RESPONSE))
    client, _ = client_for(
        gateway, jev_base_url="https://gateway.test/v1/", jev_model="typesafe-ai/jev-2"
    )
    evaluate(client)
    assert str(gateway.requests[0].url) == "https://gateway.test/v1/evaluate"
    assert json.loads(gateway.requests[0].content)["model"] == "typesafe-ai/jev-2"


def test_score_questions_need_at_least_two_levels() -> None:
    with pytest.raises(ValueError):
        ScoreQuestion(instructions="?", criteria=["only one"])


# Responses


def test_parses_the_real_response() -> None:
    client, _ = client_for(FakeGateway(httpx.Response(200, json=REAL_RESPONSE)))
    result = evaluate(client)

    thesis = result.answers["thesis"]
    assert isinstance(thesis, ScoreAnswer)
    assert thesis.score == 2.65
    assert thesis.confidence == 0.65
    assert thesis.probabilities["3"] == 0.68
    evidence = result.answers["uses_evidence"]
    assert isinstance(evidence, BooleanAnswer)
    assert evidence.probability == 0.77
    assert result.input_tokens == 395
    assert result.cost_usd == Decimal("0")
    assert result.market_cost_usd == Decimal("0.00001659")
    assert result.generation_id == "gen_01M37K86V4VFM5VAKTYNYVQZH8"


def test_confidence_falls_back_to_provider_metadata() -> None:
    body = json.loads(json.dumps(REAL_RESPONSE))
    del body["answers"]["thesis"]["confidence"]
    client, _ = client_for(FakeGateway(httpx.Response(200, json=body)))
    assert evaluate(client).answers["thesis"].confidence == 0.65


@pytest.mark.parametrize(
    "broken",
    [
        {"answers": {"uses_evidence": {"type": "boolean", "probability": 0.5}}},  # missing
        {"answers": {**REAL_RESPONSE["answers"], "thesis": {"type": "boolean", "probability": 1}}},
        {
            "answers": {
                **REAL_RESPONSE["answers"],
                "thesis": {"type": "score", "score": 7, "probabilities": {}},  # off the scale
            }
        },
        {"answers": {**REAL_RESPONSE["answers"], "uses_evidence": {"type": "boolean"}}},
    ],
)
def test_unexpected_answers_are_refused_not_guessed(broken: dict) -> None:
    body = {**REAL_RESPONSE, **broken}
    client, _ = client_for(FakeGateway(httpx.Response(200, json=body)))
    with pytest.raises(JevError) as error:
        evaluate(client)
    assert error.value.kind == "unavailable"


def test_non_json_response_is_an_error() -> None:
    client, _ = client_for(FakeGateway(httpx.Response(200, text="<html>oops</html>")))
    with pytest.raises(JevError, match="unavailable"):
        evaluate(client)


# Errors and retries


def test_retries_when_busy_then_succeeds() -> None:
    gateway = FakeGateway(
        httpx.Response(429, headers={"retry-after": "2"}),
        httpx.Response(503),
        httpx.Response(200, json=REAL_RESPONSE),
    )
    client, slept = client_for(gateway)
    assert evaluate(client).answers["thesis"].score == 2.65
    assert len(gateway.requests) == 3
    assert slept == [2.0, 1.5]  # Retry-After is honoured, otherwise it backs off


def test_retries_network_errors_and_timeouts() -> None:
    gateway = FakeGateway(
        httpx.ConnectError("no route"),
        httpx.ReadTimeout("slow"),
        httpx.Response(200, json=REAL_RESPONSE),
    )
    client, _ = client_for(gateway)
    assert evaluate(client).input_tokens == 395


def test_gives_up_after_three_attempts() -> None:
    gateway = FakeGateway(httpx.Response(429), httpx.Response(429), httpx.Response(429))
    client, _ = client_for(gateway)
    with pytest.raises(JevError) as error:
        evaluate(client)
    assert error.value.kind == "rate_limited"
    assert len(gateway.requests) == 3


def test_timeouts_every_time_mean_unavailable() -> None:
    gateway = FakeGateway(*(httpx.ReadTimeout("slow") for _ in range(3)))
    client, _ = client_for(gateway)
    with pytest.raises(JevError) as error:
        evaluate(client)
    assert error.value.kind == "unavailable"
    assert "try again" in error.value.message


@pytest.mark.parametrize(
    ("status", "body", "kind"),
    [
        (401, {"error": "Invalid API key"}, "not_configured"),
        (403, {"error": "Forbidden"}, "not_configured"),
        (402, {"error": "Payment required"}, "budget"),
        (400, {"error": "Budget exceeded for this key", "type": "budget_exceeded"}, "budget"),
        (400, {"error": "questions.x.type: expected boolean"}, "bad_request"),
    ],
)
def test_errors_are_not_retried_and_get_a_kind(status: int, body: dict, kind: str) -> None:
    gateway = FakeGateway(httpx.Response(status, json=body))
    client, _ = client_for(gateway)
    with pytest.raises(JevError) as error:
        evaluate(client)
    assert error.value.kind == kind
    assert len(gateway.requests) == 1


def test_messages_for_students_never_contain_details() -> None:
    gateway = FakeGateway(httpx.Response(401, json={"error": "Invalid API key sk-123"}))
    client, _ = client_for(gateway)
    with pytest.raises(JevError) as error:
        evaluate(client)
    assert "sk-123" not in error.value.message
    assert "sk-123" in str(error.value)  # kept for the logs


def test_logs_never_contain_the_draft_or_the_key(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    client, _ = client_for(FakeGateway(httpx.Response(200, json=REAL_RESPONSE)))
    evaluate(client, "A very private student sentence.")
    logged = caplog.text
    assert "395 input tokens" in logged
    assert "private student sentence" not in logged
    assert API_KEY not in logged


# The mock and choosing a client


def test_mock_is_repeatable_and_realistic() -> None:
    mock = MockJevClient()
    first = evaluate(mock, "Some draft text.")
    again = evaluate(mock, "Some draft text.")
    other = evaluate(mock, "Different draft text.")

    assert first == again
    assert first != other
    thesis = first.answers["thesis"]
    assert isinstance(thesis, ScoreAnswer)
    assert 0 <= thesis.score <= 3
    assert thesis.confidence is not None and 0 <= thesis.confidence <= 1
    assert abs(sum(thesis.probabilities.values()) - 1) < 0.02
    assert 0 <= first.answers["uses_evidence"].probability <= 1
    assert first.cost_usd == 0
    assert len(mock.calls) == 3


def test_mode_picks_the_client() -> None:
    assert isinstance(make_jev_client(Settings(_env_file=None)), MockJevClient)
    assert isinstance(make_jev_client(settings()), GatewayJevClient)


def test_app_uses_mock_unless_live() -> None:
    assert isinstance(create_app(Settings(_env_file=None)).state.jev, MockJevClient)


# What failures leave in the logs


def test_account_problems_are_logged_with_the_gateways_reason(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    client, _ = client_for(FakeGateway(httpx.Response(401, json={"error": "Invalid API key"})))
    with pytest.raises(JevError):
        evaluate(client)
    assert "jev failed (not_configured): HTTP 401" in caplog.text
    assert "Invalid API key" in caplog.text
    assert API_KEY not in caplog.text


def test_refused_requests_are_logged_without_the_reply(caplog: pytest.LogCaptureFixture) -> None:
    # A 400 reply can quote what was sent: the student's draft.
    caplog.set_level(logging.INFO)
    reply = httpx.Response(400, json={"error": "bad state: 'A very private student sentence.'"})
    client, _ = client_for(FakeGateway(reply))
    with pytest.raises(JevError):
        evaluate(client, "A very private student sentence.")
    assert "jev failed (bad_request): HTTP 400" in caplog.text
    assert "private student sentence" not in caplog.text


def test_giving_up_after_retries_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)
    client, _ = client_for(FakeGateway(*[httpx.Response(503)] * 3))
    with pytest.raises(JevError):
        evaluate(client)
    assert "jev failed (unavailable): HTTP 503" in caplog.text


def test_unusable_replies_are_logged_by_place_not_content(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    body = json.loads(json.dumps(REAL_RESPONSE))
    body["answers"]["thesis"]["score"] = "a very private value"
    client, _ = client_for(FakeGateway(httpx.Response(200, json=body)))
    with pytest.raises(JevError):
        evaluate(client)
    assert "answers.thesis" in caplog.text
    assert "very private value" not in caplog.text


@pytest.mark.parametrize("confidence", [1.5, -0.2, "high"])
def test_a_confidence_that_isnt_a_probability_is_ignored(confidence: object) -> None:
    body = json.loads(json.dumps(REAL_RESPONSE))
    del body["answers"]["thesis"]["confidence"]
    body["providerMetadata"]["typesafe"]["confidence"]["thesis"] = confidence
    client, _ = client_for(FakeGateway(httpx.Response(200, json=body)))
    assert evaluate(client).answers["thesis"].confidence is None
