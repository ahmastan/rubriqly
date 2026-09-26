# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Rubriqly** lets students check a draft against a rubric before turning it in. It shows an estimated level per criterion with confidence, the rubric author's tip for that level, paragraph tags (claim / evidence / analysis), a checklist, and progress across drafts. Scoring uses the **Jev** model (TypeSafe) through **Vercel AI Gateway**. Jev only returns scores and yes/no answers; it cannot write text. "Scan a rubric" reads rubric photos with a separate vision model (Gemini Flash, same gateway) that never sees drafts.

- **Open source (MIT).** The hosted service at rubriqly.com is one deployment of this code. Keep deployment-specific values out of this repo: they're settings (`VITE_*` build variables, backend environment variables, and a deployment's own `render.yaml`; see `render.example.yaml`).
- **Product rules:** results are always "an estimated level … not a grade", and the product never writes or rewrites student text.
- **Naming:** "Rubriqly" (capital R) in anything users read. Lowercase `rubriqly` for identifiers: folders, the Python package, npm names, storage keys, file names.
- **Layout:** two sibling folders under this root (`rubriqly-frontend/`, `rubriqly-backend/`). The root holds shared config (CI, pre-commit, `.env.example`, `render.example.yaml`) and `docs/`.

**What's here**
- **Frontend:** the app plus a marketing landing page and Privacy/Terms/Contact pages. It requires an account (`/signin`, `/signup`) and scores drafts through the backend's `POST /api/checks`.
- **Backend:** FastAPI serving `/api/health`, `/api/auth/*` (signup, login, logout, me [GET/PATCH/DELETE], password), `POST /api/checks`, `POST /api/rubric-scans` and `GET /api/rubric-scans/quota`, with Postgres (SQLite in tests), Alembic migrations, and Jev through Vercel AI Gateway (or a free mock). `scripts/smoke_jev.py` runs one real check and `scripts/smoke_scan.py <photos>` one real rubric scan (without `--yes` both are free dry runs; with `--yes` they're paid).
- **Deploying your own copy:** `docs/self-hosting.md` and `render.example.yaml`.

## Commands

Frontend (`cd rubriqly-frontend`):
```bash
npm run dev                 # dev server, http://localhost:5173 (unoptimized; never use it for Lighthouse)
npm run build && npm run preview   # production build served at http://localhost:4173
npm test                    # vitest run (all)
npx vitest run src/pages/NewCheckPage.test.tsx -t "counts words"   # one file / one test
npm run lint                # eslint
npm run typecheck           # tsc -b
npm run format              # prettier (no semicolons, single quotes, width 100)
```

Backend (`cd rubriqly-backend`, managed with uv, Python 3.13, requires >=3.12):
```bash
uv sync
uv run uvicorn rubriqly.main:app --reload         # http://localhost:8000/api/health, docs at /docs
uv run pytest                                     # all
uv run pytest tests/test_health.py::test_health_returns_ok   # one test
uv run ruff check . && uv run ruff format --check .
```
If you get "No module named rubriqly", the editable install is stale: run `uv sync --reinstall-package rubriqly`.

CI (`.github/workflows/ci.yml`) runs:
- backend: ruff and pytest
- frontend: eslint, `tsc`, vitest and build

## Frontend architecture (`rubriqly-frontend/src`)

**Data layer: every screen goes through `lib/api.ts`.**
- **Backend calls:** `lib/http.ts` (`apiFetch`, `ApiError` with `status`/`code`/`message` from the backend's `{detail: {code, message}}`; network failures become `code: 'network'`). The frontend always calls the same-origin `/api`, proxied to `localhost:8000` by Vite (`vite.config.ts`, for dev and preview) and by Render in production.
- **Accounts:** `lib/auth.ts` (getAccount, signIn, signUp, signOut, updateDisplayName, changePassword, deleteAccount, `safeNext`). `useAccount()` in `lib/hooks.ts` is the React Query `ACCOUNT_KEY` (null when signed out).
  - `components/AppLayout` is the guard: signed-out visitors go to `/signin?next=…`, and a "waking up the server" note appears after 3 seconds.
  - On sign-in or sign-out, call `queryClient.removeQueries()` and then set `ACCOUNT_KEY`.
  - A 401 on a check sets `ACCOUNT_KEY` to null.
- **Storage:** `lib/localStore.ts` uses one key per account, `rubriqly:v1:<userId>`, set by `setStorageUser` (which `auth.ts` calls whenever the account is known). The first account to sign in on a browser takes over the pre-accounts `rubriqly:v1` data. It stores nothing while signed out.
- **Checks:** `runCheck` POSTs `{rubric: rubricForScoring(rubric) (no tips), prompt, text}`. `lib/checkResult.ts` `buildCheckResult` combines the response with the rubric through `scoring.ts` (rounding, tips, overall) and the word-count rule. Nothing is saved if scoring fails.
- **Uploads (`lib/fileText.ts`):** .docx, .pdf and .txt files are read in the browser; the file never leaves the device. The size limit is 5 MB.
  - .docx uses `mammoth`.
  - .pdf uses the pdfjs-dist **legacy** build (the standard v6 build needs `Uint8Array.toHex`, which older browsers lack). Its worker comes from `?url`.
  - Both are dynamically imported, so they download only when a file is chosen.
  - `pdfPagesToText` rebuilds paragraphs from layout: a new paragraph after a larger-than-minimum line gap, or at an indented line. Page numbers are dropped, hyphenated words are rejoined, and a paragraph can continue across pages. PDF results are flagged `approximate`, so the page asks students to check the breaks.
  - Tests build real .docx files with `src/test/files.ts` (`makeDocx`, using mammoth's jszip).
- **Rubric scans (`lib/rubricScan.ts`, `pages/RubricScanPage.tsx`):** 1–3 photos (`MAX_PHOTOS`). Small JPG/PNG/WebP go as-is; bigger ones (or HEIC where the browser can open it) are re-encoded to JPEG, longest side 2000px. `scanRubric` / `getScanQuota` are in `api.ts` (`SCAN_QUOTA_KEY`, `SCAN_PRIVACY_NOTICE`, which must stay truthful). Success navigates to `/rubrics/new` with `{ scan }` in router state; `BuilderPage` builds values with `scannedToBuilderValues`, shows a "Not saved yet" banner, marks the AI's questions and tips with a grey "Suggested" pill (aria-hidden; fields get `aria-describedby` a hint instead) until edited (`isSuggested`), and `useBlocker` confirms before leaving unsaved. Quota `available: false` means the server can't scan (production with the mock).
- **Demo labels:** "Demo results" shows only on old checks with `model === 'mock'`. The builder's "Test on a sample essay" is still simulated in the browser (`mockJev.ts`) and labelled "demo result".
- `PRIVACY_NOTICE` must stay truthful.
- The display name lives on the server (`Account.displayName`). `initials()` for the avatar is in `lib/text.ts`.
- **Drafts are local-only by design.** Assignments, drafts, checks and students' own rubrics live in the browser; only the text being checked goes to the backend, which doesn't store it. The database holds accounts, sessions and usage counts only. Rubric photos go to the backend to be read and are forgotten; the scanned rubric is saved in the browser.

**Domain logic, split so it's testable without React**
- `lib/types.ts` mirrors the planned API shapes.
- `lib/starterRubrics.ts`: the three built-in rubrics (`source: 'builtin'`). User rubrics are `'mine'`, and saving a built-in creates a copy.
- `lib/scoring.ts`:
  - `CONFIDENCE_THRESHOLD = 0.6`
  - tips are shown for levels below the second-highest
  - the overall result is a weighted average, rounded and clamped
- `lib/jevPayload.ts`: the builder's "What Jev receives" preview. It still uses `noul` for yes/no, but Vercel's Jev API calls that type `boolean`, with endpoint `POST https://ai-gateway.vercel.sh/v1/evaluate` and model `typesafe-ai/jev`. A real response (23 September 2026) confirmed this. `score` is 0-based (add 1 for our levels), score answers include `confidence` inline (also in `providerMetadata.typesafe.confidence`), boolean answers have only `probability`, and `providerOptions.gateway.disallowPromptTraining: true` is honored.

**Routing (`routes.tsx`): every page is lazy-loaded.**
- Marketing pages (`/`, `/privacy`, `/terms`, `/contact`) sit outside the app shell.
- App pages (`/check/new`, `/checks/:id`, `/rubrics`, `/rubrics/scan`, `/rubrics/new`, `/rubrics/:id/edit`, `/settings`) are children of `components/AppLayout` (the sidebar, a collapsible rail, and a mobile `<dialog>` drawer).
- `PageFallback` renders `data-page-fallback` while a page's code loads.

**Theming (`index.css`)**
- Design tokens are CSS variables on `:root` and `:root[data-theme='dark']`, exposed to Tailwind v4 through `@theme inline`. Use token classes (`bg-surface`, `text-ink-2`, `bg-accent`), not hex values.
- `.theme-light` / `.theme-dark` force one palette on a section; that element must also set `bg-bg text-ink`.
- The inline script in `index.html` applies the saved theme, and the landing pages' dark background (`data-landing`), before first paint. Keep it in sync with `lib/theme.ts` and `pages/landing/useLandingBackground.ts`.
- **Colors:**
  - dark blue `accent` for levels, links and focus
  - dark purple `accent-2` / `feature` for the logo, avatar and overall result card
  - red `danger` only for deleting
  - amber `warn` only for low confidence and missing tags
- Level bars are segmented and in the accent color, never red/yellow/green.
- Text must meet 4.5:1 contrast in both themes.

**Landing page (`pages/landing/`), Direction B: dark-first with paper bands**
- All copy and made-up demo content lives in `content.ts`.
- `CONTACT_EMAIL` in `content.ts` comes from `VITE_CONTACT_EMAIL` (unset → the pages say "coming soon"). `VITE_SITE_URL` fills the share tags in `index.html` (a small plugin in `vite.config.ts`). Both are typed in `src/env.d.ts`.
- **Legal pages:** `/privacy`, `/terms` and `/contact` are `LegalPages.tsx`, with the text in `legal.ts` (`{contact}` becomes the email).
  - Operator: "Rubriqly". Governing law: United States. Age 13+.
  - Every statement must match what the backend really does; update `legal.ts` (and its "Last updated" date) when data handling changes.
  - `LegalPages.test.tsx` checks the key facts and the honesty rules.
- **Fonts** are self-hosted (`@fontsource-variable/geist`, `geist-mono`, and `newsreader/opsz.css`, imported in `main.tsx`; the CSS names are `'Geist Variable'` etc.). `index.html` must make no third-party requests, and a test enforces this.
- Animations use **Motion's slim mode**: `import * as m from 'motion/react-m'` inside `<LazyMotion features={domAnimation} strict>` (set up in `SmoothScroll.tsx`). Rendering a full `motion.*` component throws in strict mode. Hooks (`useScroll`, `useTransform`, `useReducedMotion`) still come from `motion/react`.
- **Lenis** smooth scrolling runs only on the landing page (`SmoothScroll.tsx`). Programmatic scrolling there should use `useLenis()`.
- Reduced motion is handled per component through `useReducedMotion`, falling back to final or static states.
- The scroll demo has three versions: `demo/PinnedDemo` (desktop; sticky, driven by scroll progress through `stepRange` / `stepAt` in `demo/steps.ts`), `demo/StackedDemo` (mobile; plays when scrolled into view) and `demo/StaticDemo` (reduced motion). The rubric library has pinned and swipe versions. Tests find them via `data-demo` and `data-library` attributes.
- Word-split text (the statement, the final headline) keeps an `sr-only` full sentence, with the split words `aria-hidden`.
- **Honesty rules are enforced by a test:**
  - no fake testimonials, statistics or accuracy claims
  - "grade" appears only as a denial ("an estimate, not a grade")
  - open-source claims stay accurate: the code is MIT on GitHub (`GITHUB_URL` in `content.ts`)
  - sample content is original and labeled as an example

**Lint rule to know:** `react-refresh/only-export-components` means a `.tsx` file may only export components. Put hooks, constants and helpers in `.ts` files.

**Test conventions (`src/test/`)**
- `await renderRoute(path)` renders the whole app with a memory router. It waits until the lazy page has loaded and `PageFallback` is gone. Always `await` it.
- After clicking a link, use `waitFor(() => expect(router.state.location…))`, because the target page loads lazily.
- `setup.ts` stubs `IntersectionObserver`, `ResizeObserver`, `matchMedia` and `URL.createObjectURL` for jsdom, and resets localStorage and the theme after each test.
- `test/fakeBackend.ts` is installed as `fetch` for every test. It's an in-memory backend with the real API's shapes, starting signed in as `test1@rubriqly.com` (`usr_test1`, password `TEST_PASSWORD`), and it scores with `mockCheckResponse`. Use `resetFakeBackend({ signedIn: false })`, `fakeBackend.failNextCheck(...)`, `failNextScan(...)`, `setScansUsed(n)`, `disableScanning()`, `holdReplies()` (returns a release function), `goOffline()`, `signOut()` and `addAccount()`. Scans return `SCANNED_RUBRIC`. `requests` records every call.
- Reduced-motion tests live in their own file (`landing/ReducedMotion.test.tsx`), because Motion caches the reduced-motion setting.

## Backend (`rubriqly-backend/`)

- **App:** `rubriqly.main:create_app(settings)` is a factory (CORS comes from `allowed_origins`). Routers are mounted under `/api`.
- **Settings:** `rubriqly.config.Settings` (pydantic-settings) reads environment variables or `rubriqly-backend/.env` (copy it from the root `.env.example`). `ALLOWED_ORIGINS` is comma-separated. `JEV_MODE` and `SCAN_MODE` are `mock` or `live` (live requires `AI_GATEWAY_API_KEY`); `SCAN_MODEL` defaults to `google/gemini-2.5-flash` (newer Gemini models need paid gateway credits). A pasted Neon `postgresql://` URL is rewritten to `postgresql+psycopg://`. Production refuses the default `SECRET_KEY`. Budget limits (`CHECKS_PER_DAY`, etc.) are settings. Tests pass `Settings(_env_file=None, ...)` so a developer's `.env` can't leak in.
- **Accounts (`rubriqly/auth/`, `api/auth.py`):**
  - Passwords are hashed with Argon2 (`pwdlib`). Rules are in `password_problem`: at least 12 characters, no common passwords, no email name.
  - Server-side sessions: the `rubriqly_session` cookie (HttpOnly, SameSite=Lax, `Path=/api`, Secure in production) holds a random token, and the database stores only its SHA-256. Sessions slide for 30 days and are refreshed at most hourly.
  - Routes that need a user take `current: CurrentUser` (`auth/deps.py`).
  - Errors are `{"detail": {"code", "message"}}` via `api_error`.
  - Sign-up requires `confirms_age` (self-declared, `MIN_AGE` 13) and `accepts_terms`. It's limited per network (HMAC of the address; set `CLIENT_IP_HEADER` behind a proxy, e.g. `x-forwarded-for` on Render) and site-wide per UTC day.
  - Wrong-password lockout is in memory (`LoginThrottle`), which is fine for one server.
  - Admin CLI: `uv run rubriqly create-user|reset-password|deactivate-user|activate-user|list-users|usage`. Generated passwords are printed once and never written anywhere.
- **Jev client (`rubriqly/jev/`):**
  - `JevClient` protocol with an async `evaluate(state, questions) -> EvaluateResult`, on `app.state.jev`.
  - `MockJevClient` (the `JEV_MODE=mock` default) returns free, repeatable hash-based answers and records `calls`.
  - `GatewayJevClient` POSTs to `{JEV_BASE_URL}/evaluate`, always with `disallowPromptTraining: true`. It retries timeouts, network errors, 429 and 5xx up to 3 attempts, honoring `Retry-After` (capped at 5s).
  - Responses are validated. A missing, mistyped or off-scale answer raises `JevError("unavailable")`; the client never guesses.
  - `JevError.kind` is one of unavailable, rate_limited, budget, not_configured or bad_request. `.message` is safe to show students; details stay in the logs.
  - Logs hold tokens, cost and the generation id only, never the state or the key.
  - `EvaluateResult` has `cost_usd` (what was charged; 0 on the free credit) and `market_cost_usd` (the list price).
- **Gateway calls (`rubriqly/gateway.py`):** `post_with_retries` and `failure_for` are shared by the Jev client and the scanner; each converts `GatewayFailure` to its own error.
- **Rubric scanner (`rubriqly/scan/`, `api/rubric_scans.py`):**
  - `ScanClient` protocol (`scan(images) -> ScanResult`) on `app.state.scanner`: `MockScanClient` (fixed, labelled `DEMO_RUBRIC`, the `SCAN_MODE=mock` default) or `GatewayScanClient` (Chat Completions at `{JEV_BASE_URL}/chat/completions`, images as data URLs, strict JSON schema from `scan/prompt.py`, `reasoning.effort: low`, no temperature, `disallowPromptTraining: true`, 2 attempts).
  - `to_scanned_rubric` validates strictly: `ScanError` kinds `not_a_rubric`, `unreadable`, `too_big` (limits match `RubricIn`) plus the gateway kinds. Levels are lowest first; if every level has points and they descend, everything is flipped. Model-written text lives only in `suggested_*` fields. Cost comes from `usage.cost` / `usage.market_cost` (confirmed 26 September 2026); a failed parse still carries tokens and cost on the `ScanError`.
  - `POST /api/rubric-scans` `{images: [{data: base64}]}`: 1–3 images, each ≤2.5 MB and sniffed as JPG/PNG/WebP (`bad_image`, `image_too_big`), then the student's limit (`RUBRIC_SCANS_PER_USER_PER_WEEK` over any 7 days; `ok` and `not_a_rubric` count), then the site limit (`RUBRIC_SCANS_PER_DAY`, everything but `rate_limited`). Photo problems are 422 `scan_<kind>`, outages 503. Returns `{rubric, model, quota}`. The limit is read only through `scan_limit_for(user, settings)` (where a paid plan will plug in).
  - Production with `SCAN_MODE=mock` refuses (503 `scan_not_configured`, quota `available: false`): students never get a demo scan.
  - Photos and rubric text are never stored or logged; each attempt writes one `rubric_scan_usage` row.
- **Scoring (`rubriqly/scoring/`, `api/checks.py`):**
  - `POST /api/checks` takes `{rubric, prompt, text}` and is signed-in only.
  - `RubricIn` ignores tips, weights and summaries, so tips can't reach Jev. Descriptors must equal the number of levels, and ids must be unique.
  - `scoring/text.py` mirrors `lib/text.ts` (paragraph splitting, title rule, word count). Keep the two in sync.
  - One request carries the rubric (score questions for criteria, boolean questions for the checklist). There's one boolean-tag request per paragraph: Claim/Context for the intro, Claim/Evidence/Analysis for the body, and Claim/Significance for the conclusion (the last paragraph when there are 3 or more). Only body paragraphs can be `weak`. At most `JEV_MAX_PARALLEL` run at once. Question keys are `criterion_i` and `check_i`.
  - It returns scores only (`CheckOut`): 1-based unrounded `level`, `confidence` (Jev's, or 1 minus normalized entropy), per-level probabilities, checklist probabilities, and paragraph tags with `weak`. The browser's `scoring.ts` adds rounding, tips and the overall estimate.
  - Any Jev failure returns a 503 `scoring_<kind>`, never a partial result.
  - Each attempt writes one `check_usage` row: `ok`, `failed` (with the partial spend) or `rate_limited`. `cost_usd` is the **list price** (`market_cost_usd`), so usage shows real consumption even on free credit.
  - The per-student daily limit counts only `ok` checks. The site-wide limit counts `ok` and `failed`.
  - The draft text is never stored or logged.
  - The endpoint is sync (the DB runs in the threadpool) and calls the async scorer via `anyio.from_thread.run`.
- **Database:** Postgres in production (the reference deployment uses Neon); any Postgres, e.g. a Neon `dev` branch, in development via `DATABASE_URL` in `.env`. Production refuses a non-Postgres `DATABASE_URL`. Models are in `models.py` (`users`, `sessions` as `AuthSession`, `check_usage`, `rubric_scan_usage`) and never hold draft text or rubric photos. `UTCDateTime` keeps timestamps timezone-aware on SQLite too. The engine is lazy and `/api/health` never queries the database (so Render's health checks don't keep Neon awake). Routes get a session through `Depends(get_db)`.
- **Tests and migrations:** tests use a throw-away database built by the real migrations (`tests/conftest.py`): a temporary SQLite file locally, or `TEST_DATABASE_URL` Postgres in CI. Never Neon. `test_migrations_match_the_models` catches drift. Always review autogenerated migrations for Postgres compatibility, and never run a migration against a shared database without the maintainer's OK.

## Deployment

`render.example.yaml` is an example Render Blueprint (copy it to `render.yaml` and fill in the `YOUR-…` placeholders; `docs/self-hosting.md` walks through it). Two services:
- **Static site** (`rubriqly-frontend`, `npm ci && npm run build`, output `dist`, `NODE_VERSION` 24):
  - routes, in order: `/api/*` is rewritten to the API service's address (it must come first), then the SPA rewrite `/*` → `/index.html`
  - build variables: `VITE_SITE_URL`, `VITE_CONTACT_EMAIL`
  - cache headers for `/assets/*`; deploys only after checks pass, and only on frontend changes
- **API** (Python, root `rubriqly-backend`):
  - build `uv sync --frozen --no-dev`; start runs `alembic upgrade head`, then uvicorn with proxy headers (migrations run on every start)
  - health check `/api/health` (never touches the database)
  - `JEV_MODE=live`, `SCAN_MODE=live`, `ENVIRONMENT=production`, `ALLOWED_ORIGINS` = the site's addresses, `CLIENT_IP_HEADER=x-forwarded-for`
  - secrets: `DATABASE_URL` and `AI_GATEWAY_API_KEY` are `sync: false`; `SECRET_KEY` is `generateValue`
- The frontend's `apiFetch` treats a non-JSON 200 (for example `index.html` when the rewrite is missing) as "can't reach the server".
- Sign-in cookies and drafts are stored per site address, so two addresses for one site don't share them.
