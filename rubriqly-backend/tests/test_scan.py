import asyncio
import base64
import json
import logging
from decimal import Decimal
from typing import Any

import httpx
import pytest

from rubriqly.config import Settings
from rubriqly.scan import (
    GatewayScanClient,
    MockScanClient,
    ScanError,
    ScanImage,
    make_scan_client,
    sniff_media_type,
)

API_KEY = "test-gateway-key-do-not-log"
PNG = b"\x89PNG\r\n\x1a\n" + b"rubric-photo-bytes"
IMAGE = ScanImage(media_type="image/png", data=PNG)


def rubric_answer(**changes: Any) -> dict[str, Any]:
    """What the model sends back for a 3-level rubric shown best level first (it forgot to flip)."""
    answer: dict[str, Any] = {
        "is_rubric": True,
        "title": "Informal Essay Rubric",
        "levels": [
            {"name": "Expert", "points": "3"},
            {"name": "Capable", "points": "2"},
            {"name": "Beginner", "points": "1"},
        ],
        "criteria": [
            {
                "name": "Quality of Writing",
                "descriptors": ["Extraordinary style", "Little style", "No style"],
                "suggested_question": "How strong are the style, voice and organization?",
                "suggested_tips": ["Keep it up.", "Add voice.", "Pick a style."],
            }
        ],
        "checklist": [{"name": "Has a title", "suggested_question": "Is there a title?"}],
        "word_count_min": 500,
        "word_count_max": 0,
        "notes": "",
    }
    answer.update(changes)
    return answer


def completion(answer: object, **changes: Any) -> dict[str, Any]:
    content = answer if isinstance(answer, str) else json.dumps(answer)
    body: dict[str, Any] = {
        "id": "gen_scan_1",
        "object": "chat.completion",
        "model": "google/gemini-2.5-flash",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        # Where the gateway really reports cost (first real scan, 26 September 2026).
        "usage": {
            "prompt_tokens": 1800,
            "completion_tokens": 900,
            "total_tokens": 2700,
            "cost": 0.0042,
            "market_cost": 0.0042,
            "gateway_cost": 0.0042,
            "completion_tokens_details": {"reasoning_tokens": 400},
        },
    }
    body.update(changes)
    return body


def settings(**changes: Any) -> Settings:
    return Settings(_env_file=None, scan_mode="live", ai_gateway_api_key=API_KEY, **changes)


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


def scan_with(*replies: httpx.Response | Exception, images: list[ScanImage] | None = None) -> Any:
    gateway = FakeGateway(*replies)

    async def no_wait(_seconds: float) -> None:
        pass

    http = httpx.AsyncClient(transport=httpx.MockTransport(gateway))
    client = GatewayScanClient(settings(), http=http, sleep=no_wait)
    return asyncio.run(client.scan(images or [IMAGE])), gateway


def scan_error(*replies: httpx.Response | Exception) -> ScanError:
    with pytest.raises(ScanError) as caught:
        scan_with(*replies)
    return caught.value


def ok(answer: object = None, **changes: Any) -> httpx.Response:
    return httpx.Response(200, json=completion(answer or rubric_answer(), **changes))


# Requests


def test_request_uses_chat_completions_with_images_and_no_training() -> None:
    second = ScanImage(media_type="image/jpeg", data=b"\xff\xd8\xffpage-two")
    _, gateway = scan_with(ok(), images=[IMAGE, second])

    request = gateway.requests[0]
    assert str(request.url) == "https://ai-gateway.vercel.sh/v1/chat/completions"
    assert request.headers["authorization"] == f"Bearer {API_KEY}"
    body = json.loads(request.content)
    assert body["model"] == "google/gemini-2.5-flash"
    assert body["providerOptions"] == {"gateway": {"disallowPromptTraining": True}}
    assert body["response_format"]["type"] == "json_schema"
    assert body["response_format"]["json_schema"]["strict"] is True
    assert "temperature" not in body
    parts = body["messages"][1]["content"]
    assert "2 photos" in parts[0]["text"]
    assert parts[1]["image_url"]["url"] == "data:image/png;base64," + base64.b64encode(PNG).decode(
        "ascii"
    )
    assert parts[2]["image_url"]["url"].startswith("data:image/jpeg;base64,")


def test_model_comes_from_settings() -> None:
    gateway = FakeGateway(ok())
    http = httpx.AsyncClient(transport=httpx.MockTransport(gateway))
    client = GatewayScanClient(settings(scan_model="google/other-flash"), http=http)
    asyncio.run(client.scan([IMAGE]))
    assert json.loads(gateway.requests[0].content)["model"] == "google/other-flash"


# Responses


def test_reads_the_rubric_lowest_level_first() -> None:
    result, _ = scan_with(ok())
    rubric = result.rubric
    assert rubric.title == "Informal Essay Rubric"
    # The points went down (3, 2, 1), so everything is flipped to lowest first.
    assert rubric.levels == ["Beginner", "Capable", "Expert"]
    assert rubric.criteria[0].descriptors == ["No style", "Little style", "Extraordinary style"]
    assert rubric.criteria[0].suggested_tips == ["Pick a style.", "Add voice.", "Keep it up."]
    assert rubric.checklist[0].name == "Has a title"
    assert rubric.word_count is not None
    assert (rubric.word_count.min, rubric.word_count.max) == (500, None)
    assert result.input_tokens == 1800
    assert result.output_tokens == 900
    assert result.market_cost_usd == Decimal("0.0042")
    assert result.cost_usd == Decimal("0.0042")
    assert result.generation_id == "gen_scan_1"


def test_levels_already_lowest_first_are_kept() -> None:
    levels = [{"name": "One", "points": "1"}, {"name": "Two", "points": "2"}]
    criteria = [
        {
            "name": "Focus",
            "descriptors": ["low", "high"],
            "suggested_question": "?",
            "suggested_tips": [],
        }
    ]
    result, _ = scan_with(ok(rubric_answer(levels=levels, criteria=criteria)))
    assert result.rubric.levels == ["One", "Two"]
    assert result.rubric.criteria[0].descriptors == ["low", "high"]
    # Missing suggestions are padded, never invented.
    assert result.rubric.criteria[0].suggested_tips == ["", ""]


def test_levels_without_points_keep_the_models_order() -> None:
    levels = [{"name": "Low", "points": ""}, {"name": "High", "points": ""}]
    criteria = [
        {
            "name": "Focus",
            "descriptors": ["a", "b"],
            "suggested_question": "?",
            "suggested_tips": [],
        }
    ]
    result, _ = scan_with(ok(rubric_answer(levels=levels, criteria=criteria)))
    assert result.rubric.levels == ["Low", "High"]


def test_empty_cells_stay_empty() -> None:
    criteria = [
        {
            "name": "Quality of Writing",
            "descriptors": ["", "Little style", "No style"],
            "suggested_question": "?",
            "suggested_tips": ["a", "b", "c"],
        }
    ]
    result, _ = scan_with(ok(rubric_answer(criteria=criteria)))
    assert result.rubric.criteria[0].descriptors == ["No style", "Little style", ""]


def test_a_photo_that_isnt_a_rubric_is_refused() -> None:
    error = scan_error(ok(rubric_answer(is_rubric=False, levels=[], criteria=[])))
    assert error.kind == "not_a_rubric"


@pytest.mark.parametrize(
    ("changes", "kind"),
    [
        ({"levels": [{"name": "Only", "points": ""}]}, "unreadable"),
        ({"criteria": []}, "unreadable"),
        (
            {
                "criteria": [
                    {
                        "name": "X",
                        "descriptors": ["a"],
                        "suggested_question": "",
                        "suggested_tips": [],
                    }
                ]
            },
            "unreadable",
        ),
        ({"levels": [{"name": f"L{i}", "points": ""} for i in range(9)]}, "too_big"),
        (
            {
                "criteria": [
                    {
                        "name": f"C{i}",
                        "descriptors": ["a", "b", "c"],
                        "suggested_question": "",
                        "suggested_tips": [],
                    }
                    for i in range(13)
                ]
            },
            "too_big",
        ),
    ],
)
def test_rubrics_that_cant_be_used_get_a_clear_kind(changes: dict, kind: str) -> None:
    assert scan_error(ok(rubric_answer(**changes))).kind == kind


@pytest.mark.parametrize("content", ["not json", "[]", json.dumps({"title": "missing is_rubric"})])
def test_malformed_answers_are_refused_not_guessed(content: str) -> None:
    assert scan_error(ok(content)).kind == "unavailable"


def test_a_cut_off_answer_is_refused() -> None:
    body = completion(rubric_answer())
    body["choices"][0]["finish_reason"] = "length"
    assert scan_error(httpx.Response(200, json=body)).kind == "unreadable"


def test_cost_can_also_come_from_gateway_metadata() -> None:
    body = completion(rubric_answer())
    body["usage"] = {"prompt_tokens": 10, "completion_tokens": 5}
    body["providerMetadata"] = {"gateway": {"cost": "0", "marketCost": "0.003"}}
    result, _ = scan_with(httpx.Response(200, json=body))
    assert (result.cost_usd, result.market_cost_usd) == (Decimal(0), Decimal("0.003"))


def test_fenced_json_is_accepted() -> None:
    result, _ = scan_with(ok("```json\n" + json.dumps(rubric_answer()) + "\n```"))
    assert result.rubric.title == "Informal Essay Rubric"


# Failures


def test_retries_once_when_busy_then_succeeds() -> None:
    result, gateway = scan_with(httpx.Response(503, text="busy"), ok())
    assert len(gateway.requests) == 2
    assert result.rubric.levels[0] == "Beginner"


def test_gives_up_after_two_attempts() -> None:
    error = scan_error(httpx.Response(503), httpx.Response(503))
    assert error.kind == "unavailable"


@pytest.mark.parametrize(
    ("status", "kind"),
    [(401, "not_configured"), (402, "budget"), (400, "bad_request")],
)
def test_errors_get_a_kind_and_a_safe_message(status: int, kind: str) -> None:
    error = scan_error(httpx.Response(status, text="secret upstream detail"))
    assert error.kind == kind
    assert "secret upstream detail" not in error.message


def test_logs_never_contain_the_photo_the_rubric_or_the_key(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    scan_with(ok())
    logged = caplog.text
    assert "scan ok" in logged
    assert API_KEY not in logged
    assert base64.b64encode(PNG).decode("ascii") not in logged
    assert "Extraordinary style" not in logged


# Mock and settings


def test_mock_returns_a_labelled_demo_without_reading_photos() -> None:
    mock = MockScanClient()
    result = asyncio.run(mock.scan([IMAGE, IMAGE]))
    assert mock.calls == [2]
    assert result.model == "mock"
    assert result.rubric.title.startswith("Demo scan")
    assert "not your photo" in result.rubric.notes


def test_mode_picks_the_client() -> None:
    assert isinstance(make_scan_client(Settings(_env_file=None)), MockScanClient)
    assert isinstance(make_scan_client(settings()), GatewayScanClient)


def test_live_scanning_needs_a_key() -> None:
    with pytest.raises(ValueError, match="SCAN_MODE=live"):
        Settings(_env_file=None, scan_mode="live")


def test_image_types_come_from_the_bytes() -> None:
    assert sniff_media_type(PNG) == "image/png"
    assert sniff_media_type(b"\xff\xd8\xff\xe0rest") == "image/jpeg"
    assert sniff_media_type(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "image/webp"
    assert sniff_media_type(b"GIF89a") is None
    assert sniff_media_type(b"%PDF-1.7") is None
