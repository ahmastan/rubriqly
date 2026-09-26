import re

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from rubriqly.auth.passwords import verify_password
from rubriqly.cli import main
from rubriqly.config import Settings
from rubriqly.models import AuthSession, CheckUsage, RubricScanUsage, User


@pytest.fixture
def run(engine: Engine, settings: Settings, capsys: pytest.CaptureFixture[str]):
    def run(*argv: str) -> tuple[int, str, str]:
        code = main(list(argv), settings=settings)
        captured = capsys.readouterr()
        return code, captured.out, captured.err

    return run


def printed_password(output: str) -> str:
    match = re.search(r"(\w{4}-\w{4}-\w{4}-\w{4})", output)
    assert match, output
    return match.group(1)


def test_create_user_prints_a_working_password_once(run, db: Session) -> None:
    code, out, _ = run("create-user", "--email", "Test1@Rubriqly.com", "--name", "Test Student One")
    assert code == 0
    assert out.startswith("Database: ")

    user = db.scalars(select(User)).one()
    assert user.email == "test1@rubriqly.com"
    assert user.signup_ip_hash is None
    assert verify_password(printed_password(out), user.password_hash)[0]


def test_create_user_refuses_duplicates_and_bad_input(run) -> None:
    run("create-user", "--email", "test1@rubriqly.com", "--name", "One")
    code, _, err = run("create-user", "--email", "TEST1@rubriqly.com", "--name", "Again")
    assert code == 1 and "already has an account" in err
    assert run("create-user", "--email", "nope", "--name", "X")[0] == 1
    assert run("create-user", "--email", "x@rubriqly.com", "--name", "   ")[0] == 1


def test_reset_password_signs_the_user_out(run, db: Session) -> None:
    _, created, _ = run("create-user", "--email", "test1@rubriqly.com", "--name", "One")
    user = db.scalars(select(User)).one()
    db.add(AuthSession(user_id=user.id, token_hash="b" * 64, expires_at=user.created_at))
    db.commit()

    code, out, _ = run("reset-password", "--email", "test1@rubriqly.com")
    assert code == 0
    db.expire_all()
    new_password = printed_password(out)
    assert new_password != printed_password(created)
    assert verify_password(new_password, db.scalars(select(User)).one().password_hash)[0]
    assert db.scalars(select(AuthSession)).all() == []


def test_deactivate_and_activate(run, db: Session) -> None:
    run("create-user", "--email", "test1@rubriqly.com", "--name", "One")
    assert run("deactivate-user", "--email", "test1@rubriqly.com")[0] == 0
    db.expire_all()
    assert db.scalars(select(User.is_active)).one() is False
    assert run("activate-user", "--email", "test1@rubriqly.com")[0] == 0
    db.expire_all()
    assert db.scalars(select(User.is_active)).one() is True
    assert run("activate-user", "--email", "nobody@rubriqly.com")[0] == 1


def test_list_users_and_usage(run, db: Session) -> None:
    run("create-user", "--email", "test1@rubriqly.com", "--name", "Test Student One")
    run("create-user", "--email", "test2@rubriqly.com", "--name", "Test Student Two")
    user = db.scalars(select(User).where(User.email == "test1@rubriqly.com")).one()
    db.add(CheckUsage(user_id=user.id, status="ok", input_tokens=395, cost_usd="0.00001659"))
    db.add(RubricScanUsage(user_id=user.id, status="ok", image_count=1, cost_usd="0.0043043"))
    db.add(RubricScanUsage(user_id=user.id, status="not_a_rubric", cost_usd="0.002"))
    db.commit()

    code, out, _ = run("list-users")
    assert code == 0 and "test2@rubriqly.com" in out and "2 user(s)" in out

    code, out, _ = run("usage")
    assert code == 0
    assert "sign-ups:      2" in out
    assert "checks ok:     1" in out
    assert "input tokens:  395" in out
    assert "$0.000017" in out
    assert "scans ok:      1" in out
    assert "not a rubric:  1" in out
    assert "scans failed" not in out
    assert "scan cost:     $0.006304" in out
