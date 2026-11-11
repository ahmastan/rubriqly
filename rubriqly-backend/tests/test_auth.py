from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from rubriqly.auth.passwords import password_problem
from rubriqly.auth.sessions import COOKIE_NAME, hash_token
from rubriqly.config import Settings
from rubriqly.db import utcnow
from rubriqly.main import create_app
from rubriqly.models import AuthSession, CheckUsage, User

PASSWORD = "maple river quiet lamp"


def signup(client: TestClient, **overrides: Any):
    body = {
        "display_name": "Test Student One",
        "email": "test1@rubriqly.com",
        "password": PASSWORD,
        "confirms_age": True,
        "accepts_terms": True,
        **overrides,
    }
    return client.post("/api/auth/signup", json=body)


def login(client: TestClient, email: str = "test1@rubriqly.com", password: str = PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def error_code(response) -> str:
    return response.json()["detail"]["code"]


@pytest.fixture
def client_with(engine: Engine, settings: Settings):
    """A client for an app with some settings changed, on the migrated test database."""

    def make(**changes: Any) -> TestClient:
        return TestClient(create_app(settings.model_copy(update=changes)))

    return make


# Sign-up


def test_signup_creates_account_and_signs_in(client: TestClient, db: Session) -> None:
    response = signup(client, email="Test1@Rubriqly.com")
    assert response.status_code == 201
    assert response.json()["email"] == "test1@rubriqly.com"

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["display_name"] == "Test Student One"

    user = db.scalars(select(User)).one()
    assert user.password_hash.startswith("$argon2id$")
    assert PASSWORD not in user.password_hash
    assert user.email_verified is False


def test_session_token_is_stored_only_as_a_hash(client: TestClient, db: Session) -> None:
    signup(client)
    token = client.cookies[COOKIE_NAME]
    stored = db.scalars(select(AuthSession.token_hash)).one()
    assert stored == hash_token(token)
    assert token not in stored


def test_session_cookie_is_protected(client: TestClient) -> None:
    cookie = signup(client).headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "samesite=lax" in cookie
    assert "path=/api" in cookie
    assert "secure" not in cookie  # plain http is fine outside production


def test_production_cookie_is_https_only() -> None:
    settings = Settings(
        _env_file=None,
        environment="production",
        secret_key="x" * 48,
        database_url="postgresql://user:pw@host/db",
    )
    assert settings.cookie_secure is True


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"confirms_age": False}, "must_confirm_age"),
        ({"accepts_terms": False}, "must_accept_terms"),
        ({"password": "short pass"}, "weak_password"),
    ],
)
def test_signup_requirements(client: TestClient, overrides: dict, code: str) -> None:
    response = signup(client, **overrides)
    assert response.status_code == 400
    assert error_code(response) == code


def test_age_message_uses_the_minimum_age(client_with) -> None:
    client = client_with(min_age=16)
    response = signup(client, confirms_age=False)
    assert "16 or older" in response.json()["detail"]["message"]


def test_signup_rejects_invalid_email_and_blank_name(client: TestClient) -> None:
    assert signup(client, email="not-an-email").status_code == 422
    assert signup(client, display_name="   ").status_code == 422


def test_email_can_only_be_used_once_ignoring_case(client: TestClient) -> None:
    assert signup(client).status_code == 201
    response = signup(TestClient(client.app), email="TEST1@rubriqly.com")
    assert response.status_code == 409
    assert error_code(response) == "email_taken"


def test_signups_per_network_limit(client_with) -> None:
    client = client_with(signups_per_network_per_day=2)
    assert signup(client, email="a@rubriqly.com").status_code == 201
    assert signup(client, email="b@rubriqly.com").status_code == 201
    response = signup(client, email="c@rubriqly.com")
    assert response.status_code == 429
    assert error_code(response) == "signup_limit_network"


def test_site_wide_signup_limit(client_with) -> None:
    client = client_with(signups_per_day=1)
    assert signup(client, email="a@rubriqly.com").status_code == 201
    response = signup(client, email="b@rubriqly.com")
    assert error_code(response) == "signup_limit_site"


def test_network_address_is_only_stored_hashed(client: TestClient, db: Session) -> None:
    signup(client)
    stored = db.scalars(select(User.signup_ip_hash)).one()
    assert stored is not None and len(stored) == 64
    assert "testclient" not in stored


# Passwords


@pytest.mark.parametrize(
    "password",
    ["password1234", "123456789012", "aaaaaaaaaaaaaaaa", "abababababab", "abcdefghijklmn"],
)
def test_common_passwords_are_refused(password: str) -> None:
    assert password_problem(password) is not None


def test_password_containing_email_name_is_refused() -> None:
    assert password_problem("student-mail-2026!", "student@rubriqly.com") is not None


def test_good_passwords_are_accepted() -> None:
    assert password_problem(PASSWORD, "test1@rubriqly.com") is None
    assert password_problem("k7Qp-mR2x-Wd9v-Lf4n") is None


# Sign-in


def test_login_and_logout(client: TestClient) -> None:
    signup(client)
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401

    response = login(client, email="  TEST1@rubriqly.com ")
    assert response.status_code == 200
    assert client.get("/api/auth/me").status_code == 200


def test_wrong_email_and_wrong_password_look_the_same(client: TestClient) -> None:
    signup(client)
    wrong_password = login(client, password="not the right one")
    wrong_email = login(client, email="nobody@rubriqly.com")
    assert wrong_password.status_code == wrong_email.status_code == 401
    assert wrong_password.json() == wrong_email.json()


def test_email_is_locked_after_too_many_wrong_passwords(client: TestClient) -> None:
    signup(client)
    for _ in range(5):
        assert login(client, password="wrong password!").status_code == 401

    locked = login(client)  # even the right password is refused while locked
    assert locked.status_code == 429
    assert error_code(locked) == "too_many_attempts"

    throttle = client.app.state.login_throttle
    later = utcnow() + timedelta(minutes=16)
    throttle.clock = lambda: later
    assert login(client).status_code == 200


def test_successful_login_resets_the_failure_count(client: TestClient) -> None:
    signup(client)
    for _ in range(4):
        login(client, password="wrong password!")
    assert login(client).status_code == 200
    for _ in range(4):
        login(client, password="wrong password!")
    assert login(client).status_code == 200


def test_blocked_user_cannot_sign_in_or_use_old_session(client: TestClient, db: Session) -> None:
    signup(client)
    user = db.scalars(select(User)).one()
    user.is_active = False
    db.commit()

    assert client.get("/api/auth/me").status_code == 401
    response = login(TestClient(client.app))
    assert response.status_code == 403
    assert error_code(response) == "account_disabled"


def test_expired_session_is_refused(client: TestClient, db: Session) -> None:
    signup(client)
    session = db.scalars(select(AuthSession)).one()
    session.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    response = client.get("/api/auth/me")
    assert response.status_code == 401
    assert error_code(response) == "not_signed_in"


def test_session_is_extended_while_in_use(client: TestClient, db: Session) -> None:
    signup(client)
    session = db.scalars(select(AuthSession)).one()
    session.last_seen_at = utcnow() - timedelta(days=10)
    session.expires_at = utcnow() + timedelta(days=20)
    db.commit()

    response = client.get("/api/auth/me")
    assert COOKIE_NAME in response.headers.get("set-cookie", "")
    db.expire_all()
    assert db.scalars(select(AuthSession)).one().expires_at > utcnow() + timedelta(days=29)


# Account settings


def test_update_display_name(client: TestClient) -> None:
    signup(client)
    response = client.patch("/api/auth/me", json={"display_name": "  New Name "})
    assert response.json()["display_name"] == "New Name"


def test_change_password_signs_out_other_browsers(client: TestClient) -> None:
    signup(client)
    other = TestClient(client.app)
    login(other)

    wrong = client.post(
        "/api/auth/password",
        json={"current_password": "nope nope nope", "new_password": "a brand new passphrase"},
    )
    assert error_code(wrong) == "wrong_password"

    ok = client.post(
        "/api/auth/password",
        json={"current_password": PASSWORD, "new_password": "a brand new passphrase"},
    )
    assert ok.status_code == 204
    assert client.get("/api/auth/me").status_code == 200  # this browser stays signed in
    assert other.get("/api/auth/me").status_code == 401  # the other one is signed out
    assert login(TestClient(client.app), password="a brand new passphrase").status_code == 200


def test_delete_account_removes_everything(client: TestClient, db: Session) -> None:
    signup(client)
    user = db.scalars(select(User)).one()
    db.add(CheckUsage(user_id=user.id, status="ok"))
    db.commit()

    wrong = client.request("DELETE", "/api/auth/me", json={"password": "wrong password!"})
    assert error_code(wrong) == "wrong_password"

    response = client.request("DELETE", "/api/auth/me", json={"password": PASSWORD})
    assert response.status_code == 204
    db.expire_all()
    assert db.scalars(select(User)).all() == []
    assert db.scalars(select(AuthSession)).all() == []
    assert db.scalars(select(CheckUsage)).all() == []
    assert client.get("/api/auth/me").status_code == 401


def test_account_endpoints_require_sign_in(client: TestClient) -> None:
    assert client.get("/api/auth/me").status_code == 401
    assert client.patch("/api/auth/me", json={"display_name": "x"}).status_code == 401
    assert client.request("DELETE", "/api/auth/me", json={"password": "x"}).status_code == 401


def test_password_guesses_while_signed_in_are_limited_too(client: TestClient) -> None:
    signup(client)
    for _ in range(3):
        wrong = client.post(
            "/api/auth/password",
            json={"current_password": "nope nope nope", "new_password": "a brand new passphrase"},
        )
        assert error_code(wrong) == "wrong_password"
    for _ in range(2):
        wrong = client.request("DELETE", "/api/auth/me", json={"password": "wrong password!"})
        assert error_code(wrong) == "wrong_password"

    # Locked now, even with the right password, here and at sign-in.
    locked = client.request("DELETE", "/api/auth/me", json={"password": PASSWORD})
    assert locked.status_code == 429
    assert error_code(locked) == "too_many_attempts"
    assert login(TestClient(client.app)).status_code == 429
    assert client.get("/api/auth/me").status_code == 200  # still signed in, nothing deleted


def test_right_password_while_signed_in_resets_the_count(client: TestClient) -> None:
    signup(client)
    body = {"current_password": "nope nope nope", "new_password": "a brand new passphrase"}
    for _ in range(4):
        client.post("/api/auth/password", json=body)
    body["current_password"] = PASSWORD
    assert client.post("/api/auth/password", json=body).status_code == 204
    for _ in range(4):
        login(TestClient(client.app), password="wrong password!")
    assert login(TestClient(client.app), password="a brand new passphrase").status_code == 200
