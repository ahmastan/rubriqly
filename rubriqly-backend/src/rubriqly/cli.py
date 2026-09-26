"""The `rubriqly` admin command (docs/self-hosting.md, "Everyday tasks").

Uses DATABASE_URL, like the app: the Neon `dev` branch from .env on your Mac, or whatever
DATABASE_URL is set in front of the command.
"""

import argparse
import sys
from collections.abc import Callable, Sequence
from datetime import timedelta
from decimal import Decimal

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import delete, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from rubriqly.auth.limits import start_of_utc_day
from rubriqly.auth.passwords import generate_password, hash_password
from rubriqly.config import Settings
from rubriqly.db import make_engine, utcnow
from rubriqly.models import AuthSession, CheckUsage, RubricScanUsage, User


def describe_database(url: str) -> str:
    parsed = make_url(url)
    if parsed.drivername.startswith("sqlite"):
        return f"SQLite file {parsed.database}"
    return f"{parsed.host}/{parsed.database}"


def find_user(db: Session, email: str) -> User | None:
    return db.scalars(select(User).where(User.email == email.strip().lower())).one_or_none()


def create_user(db: Session, args: argparse.Namespace) -> int:
    try:
        email = validate_email(args.email, check_deliverability=False).normalized.lower()
    except EmailNotValidError as error:
        print(f"Not a valid email: {error}", file=sys.stderr)
        return 1
    name = args.name.strip()
    if not 1 <= len(name) <= 60:
        print("The name must be 1 to 60 characters.", file=sys.stderr)
        return 1
    if find_user(db, email):
        print(f"{email} already has an account. Use reset-password instead.", file=sys.stderr)
        return 1
    password = generate_password()
    db.add(User(email=email, password_hash=hash_password(password), display_name=name))
    db.commit()
    print(f"Created user {email}")
    print(f"Password (shown once, save it now): {password}")
    return 0


def reset_password(db: Session, args: argparse.Namespace) -> int:
    user = find_user(db, args.email)
    if user is None:
        print(f"No account for {args.email}.", file=sys.stderr)
        return 1
    password = generate_password()
    user.password_hash = hash_password(password)
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    db.commit()
    print(f"New password for {user.email} (they've been signed out everywhere): {password}")
    return 0


def set_active(active: bool) -> Callable[[Session, argparse.Namespace], int]:
    def command(db: Session, args: argparse.Namespace) -> int:
        user = find_user(db, args.email)
        if user is None:
            print(f"No account for {args.email}.", file=sys.stderr)
            return 1
        user.is_active = active
        if not active:
            db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
        db.commit()
        state = "active" if active else "blocked and signed out everywhere"
        print(f"{user.email} is now {state}.")
        return 0

    return command


def list_users(db: Session, _args: argparse.Namespace) -> int:
    users = db.scalars(select(User).order_by(User.created_at)).all()
    for user in users:
        status = "" if user.is_active else "  [blocked]"
        created = user.created_at.strftime("%Y-%m-%d")
        print(f"{created}  {user.email:<40} {user.display_name}{status}")
    print(f"{len(users)} user(s)")
    return 0


def usage(db: Session, _args: argparse.Namespace) -> int:
    now = utcnow()
    today = start_of_utc_day(now)
    month = now - timedelta(days=30)

    def count(model: type, *where: object) -> int:
        return db.scalar(select(func.count()).select_from(model).where(*where)) or 0

    def cost_since(since: object, model: type = CheckUsage) -> Decimal:
        total = db.scalar(select(func.sum(model.cost_usd)).where(model.created_at >= since))
        return Decimal(total or 0)

    tokens = db.scalar(
        select(func.sum(CheckUsage.input_tokens)).where(CheckUsage.created_at >= today)
    )
    print(f"Today (UTC, since {today:%Y-%m-%d %H:%M})")
    print(f"  sign-ups:      {count(User, User.created_at >= today)}")
    for status, label in (
        ("ok", "checks ok:"),
        ("failed", "failed:"),
        ("rate_limited", "over limit:"),
    ):
        checks = count(CheckUsage, CheckUsage.created_at >= today, CheckUsage.status == status)
        print(f"  {label:<15}{checks}")
    print(f"  input tokens:  {tokens or 0}")
    print(f"  Jev cost:      ${cost_since(today):.6f}")
    for status, label in (
        ("ok", "scans ok:"),
        ("not_a_rubric", "not a rubric:"),
        ("unreadable", "unreadable:"),
        ("too_big", "too big:"),
        ("failed", "scans failed:"),
        ("rate_limited", "scans over:"),
    ):
        scans = count(
            RubricScanUsage,
            RubricScanUsage.created_at >= today,
            RubricScanUsage.status == status,
        )
        if scans or status == "ok":
            print(f"  {label:<15}{scans}")
    print(f"  scan cost:     ${cost_since(today, RubricScanUsage):.6f}")
    print("All time")
    print(f"  users:         {count(User)}")
    print(f"  live sessions: {count(AuthSession, AuthSession.expires_at > now)}")
    print(f"  Jev cost, last 30 days:  ${cost_since(month):.6f}")
    print(f"  scan cost, last 30 days: ${cost_since(month, RubricScanUsage):.6f}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="rubriqly", description="Rubriqly admin commands.")
    commands = parser.add_subparsers(dest="command", required=True)

    create = commands.add_parser("create-user", help="create an account with a random password")
    create.add_argument("--email", required=True)
    create.add_argument("--name", required=True, help="display name")
    create.set_defaults(run=create_user)

    for name, run, help_text in (
        ("reset-password", reset_password, "give a user a new random password"),
        ("deactivate-user", set_active(False), "block a user and sign them out"),
        ("activate-user", set_active(True), "unblock a user"),
    ):
        sub = commands.add_parser(name, help=help_text)
        sub.add_argument("--email", required=True)
        sub.set_defaults(run=run)

    commands.add_parser("list-users", help="list all accounts").set_defaults(run=list_users)
    commands.add_parser("usage", help="today's sign-ups, checks, scans and cost").set_defaults(
        run=usage
    )
    return parser


def main(argv: Sequence[str] | None = None, settings: Settings | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = settings or Settings()
    print(f"Database: {describe_database(settings.database_url)}")
    engine = make_engine(settings.database_url)
    try:
        with Session(engine) as db:
            return args.run(db, args)
    finally:
        engine.dispose()


def run() -> None:
    raise SystemExit(main())
