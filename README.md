# Rubriqly

Rubriqly helps students check a draft against a rubric before they turn it in. For each rubric criterion it estimates a level, with how confident it is and the rubric author's tip for that level. It tags every paragraph for claim, evidence and analysis, runs the rubric's checklist, and tracks progress across drafts, so you know where to revise.

It's a **self-check tool: an estimate, not a grade**. It never writes or rewrites text for you. Scoring uses the [Jev](https://vercel.com/ai-gateway/models/jev) model by TypeSafe AI, through Vercel AI Gateway. Jev only returns scores and probabilities; it can't write text.

**Try it:** [rubriqly.com](https://rubriqly.com) (the hosted version). **Run your own:** see below.

## What's inside

```
rubriqly-frontend/   React + Vite + Tailwind web app and landing page (TypeScript)
rubriqly-backend/    FastAPI API: accounts, scoring with Jev, Postgres + Alembic (Python, uv)
docs/                architecture.md, self-hosting.md
render.example.yaml  example deployment (Render Blueprint)
```

- **Drafts stay in the browser.** Assignments, drafts, results and your own rubrics are saved on the device. Only the text being checked goes to the server, which scores it and doesn't keep it.
- **Uploads** (.docx, .pdf, .txt) are read in the browser; the file itself is never uploaded.
- **Accounts** (email + password) live in Postgres, with daily limits that protect the scoring budget.
- More in [docs/architecture.md](docs/architecture.md).

## Run it locally (no keys needed)

Requirements: [uv](https://docs.astral.sh/uv/) and Node 24. The backend uses a free **mock** scorer by default, so you don't need any accounts to develop.

```bash
# Backend: http://localhost:8000/api/health  (API docs at /docs)
cd rubriqly-backend
cp ../.env.example .env      # JEV_MODE=mock: fake, repeatable scores, no API key
uv sync
uv run alembic upgrade head  # creates the tables (a local SQLite file by default)
uv run rubriqly create-user --email you@example.com --name "Your Name"   # prints a password
uv run uvicorn rubriqly.main:app --reload

# Frontend: http://localhost:5173  (forwards /api to the backend)
cd rubriqly-frontend
npm install
npm run dev
```

Sign in with the account you created. Results from the mock scorer are labelled as such.

To score with the real Jev model, set `JEV_MODE=live` and `AI_GATEWAY_API_KEY` in `rubriqly-backend/.env`. Real checks cost a fraction of a cent each. To read rubric photos for real ("Scan a rubric"), also set `SCAN_MODE=live`; each scan costs about half a cent, and the mock returns a fixed demo rubric.

## Checks

```bash
cd rubriqly-backend && uv run ruff check . && uv run ruff format --check . && uv run pytest
cd rubriqly-frontend && npm run lint && npm run typecheck && npm test && npm run build
```

The tests never call the real Jev or a shared database: the backend uses a throw-away database, and the frontend uses an in-memory stand-in for the API.

## Deploy your own

[docs/self-hosting.md](docs/self-hosting.md) walks through Render (site + API), Neon (Postgres) and Vercel AI Gateway (Jev), starting from [render.example.yaml](render.example.yaml).

If you run a public copy, write your own Privacy Policy and Terms (`rubriqly-frontend/src/pages/landing/legal.ts`). The included ones describe the hosted service at rubriqly.com.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © The Rubriqly authors. The license covers the code. The Rubriqly name and logo identify the hosted service at rubriqly.com; please use a different name for your own public deployment.
