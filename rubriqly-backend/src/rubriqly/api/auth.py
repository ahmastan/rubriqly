"""Sign up, sign in, sign out and account settings (docs/architecture.md, "Accounts")."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from rubriqly.api.errors import api_error
from rubriqly.auth.deps import (
    AppSettings,
    CurrentUser,
    DbSession,
    clear_session_cookie,
    set_session_cookie,
)
from rubriqly.auth.limits import LoginThrottle, network_hash, signup_limit_reached
from rubriqly.auth.passwords import (
    burn_equal_time,
    hash_password,
    password_problem,
    verify_password,
)
from rubriqly.auth.sessions import COOKIE_NAME, create_session, end_all_sessions, end_session
from rubriqly.config import Settings
from rubriqly.db import utcnow
from rubriqly.models import User

router = APIRouter(prefix="/auth", tags=["auth"])

DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
# Long enough for any allowed password; the real rules are in password_problem.
Password = Annotated[str, Field(max_length=1024)]

INVALID_CREDENTIALS = "Email or password is incorrect."


class SignupIn(BaseModel):
    display_name: DisplayName
    email: EmailStr
    password: Password
    confirms_age: bool
    accepts_terms: bool


class LoginIn(BaseModel):
    email: Annotated[str, Field(max_length=320)]
    password: Password


class ProfileIn(BaseModel):
    display_name: DisplayName


class PasswordChangeIn(BaseModel):
    current_password: Password
    new_password: Password


class DeleteAccountIn(BaseModel):
    password: Password


class UserOut(BaseModel):
    id: str
    email: str
    display_name: str
    created_at: datetime


def user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id, email=user.email, display_name=user.display_name, created_at=user.created_at
    )


def normalize_email(email: str) -> str:
    return email.strip().lower()


def throttle(request: Request) -> LoginThrottle:
    return request.app.state.login_throttle


@router.post("/signup", status_code=201)
def signup(
    body: SignupIn, request: Request, response: Response, db: DbSession, settings: AppSettings
) -> UserOut:
    if not body.confirms_age:
        raise api_error(
            400, "must_confirm_age", f"You must be {settings.min_age} or older to use Rubriqly."
        )
    if not body.accepts_terms:
        raise api_error(
            400, "must_accept_terms", "Please agree to the Terms and Privacy Policy to continue."
        )
    email = normalize_email(body.email)
    problem = password_problem(body.password, email)
    if problem:
        raise api_error(400, "weak_password", problem)

    network = network_hash(request, settings)
    limit = signup_limit_reached(db, settings, network)
    if limit == "network":
        raise api_error(
            429, "signup_limit_network", "Too many sign-ups from this network today. Try tomorrow."
        )
    if limit == "site":
        raise api_error(
            429, "signup_limit_site", "Rubriqly isn't taking new sign-ups today. Try tomorrow."
        )

    email_taken = api_error(409, "email_taken", "That email already has an account. Sign in?")
    if db.scalar(select(User.id).where(User.email == email)):
        raise email_taken
    user = User(
        email=email,
        password_hash=hash_password(body.password),
        display_name=body.display_name,
        signup_ip_hash=network,
        last_login_at=utcnow(),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:  # someone signed up with the same email at the same moment
        db.rollback()
        raise email_taken from None

    set_session_cookie(response, create_session(db, user, settings), settings)
    return user_out(user)


@router.post("/login")
def login(
    body: LoginIn, request: Request, response: Response, db: DbSession, settings: AppSettings
) -> UserOut:
    email = normalize_email(body.email)
    attempts = throttle(request)
    if attempts.is_locked(email):
        raise too_many_attempts(settings)

    user = db.scalars(select(User).where(User.email == email)).one_or_none()
    if user is None:
        burn_equal_time(body.password)
        attempts.record_failure(email)
        raise api_error(401, "invalid_credentials", INVALID_CREDENTIALS)
    matches, updated_hash = verify_password(body.password, user.password_hash)
    if not matches:
        attempts.record_failure(email)
        raise api_error(401, "invalid_credentials", INVALID_CREDENTIALS)
    if not user.is_active:
        raise api_error(403, "account_disabled", "This account has been disabled.")

    attempts.clear(email)
    if updated_hash:
        user.password_hash = updated_hash
    user.last_login_at = utcnow()
    db.commit()
    set_session_cookie(response, create_session(db, user, settings), settings)
    return user_out(user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: DbSession, settings: AppSettings) -> None:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        end_session(db, token)
    clear_session_cookie(response, settings)


@router.get("/me")
def me(current: CurrentUser) -> UserOut:
    return user_out(current.user)


@router.patch("/me")
def update_profile(body: ProfileIn, current: CurrentUser, db: DbSession) -> UserOut:
    current.user.display_name = body.display_name
    db.commit()
    return user_out(current.user)


def confirm_password(
    request: Request, user: User, password: str, settings: Settings, wrong: str
) -> None:
    """Re-checks a signed-in user's password. Wrong guesses count with sign-in's, so someone at
    a signed-in computer can't keep guessing here either."""
    attempts = throttle(request)
    if attempts.is_locked(user.email):
        raise too_many_attempts(settings)
    if not verify_password(password, user.password_hash)[0]:
        attempts.record_failure(user.email)
        raise api_error(400, "wrong_password", wrong)
    attempts.clear(user.email)


def too_many_attempts(settings: Settings) -> HTTPException:
    return api_error(
        429,
        "too_many_attempts",
        f"Too many attempts. Try again in {settings.login_lock_minutes} minutes.",
    )


@router.post("/password", status_code=204)
def change_password(
    body: PasswordChangeIn,
    request: Request,
    current: CurrentUser,
    db: DbSession,
    settings: AppSettings,
) -> None:
    user = current.user
    confirm_password(
        request, user, body.current_password, settings, "Your current password is incorrect."
    )
    problem = password_problem(body.new_password, user.email)
    if problem:
        raise api_error(400, "weak_password", problem)
    user.password_hash = hash_password(body.new_password)
    db.commit()
    # Sign out every other browser; this one stays signed in.
    end_all_sessions(db, user, keep=current.session)


@router.delete("/me", status_code=204)
def delete_account(
    body: DeleteAccountIn,
    request: Request,
    response: Response,
    current: CurrentUser,
    db: DbSession,
    settings: AppSettings,
) -> None:
    confirm_password(request, current.user, body.password, settings, "Your password is incorrect.")
    # Sessions and usage rows go with it (ON DELETE CASCADE).
    db.delete(current.user)
    db.commit()
    clear_session_cookie(response, settings)
