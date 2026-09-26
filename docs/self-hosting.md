# Deploy your own Rubriqly

This sets up the same stack as rubriqly.com: a static site and an API on **Render**, Postgres on **Neon**, and scoring through **Vercel AI Gateway**. Everything below has a free tier. Real Jev scoring costs roughly $0.0001–0.0004 per check at list price.

If your copy will be public, use your own name for it, and write your own Privacy Policy and Terms (see step 6).

## 1. Accounts and keys

| Service | What to do |
|---|---|
| **GitHub** | Fork this repo (or push a copy to your own). |
| **Neon** | Create a project (pick the region closest to your API; the example uses AWS US West 2 / Oregon). Keep compute small (0.25–0.5 CU). Copy the **connection string** with **pooling off**. Optionally create a `dev` branch for local development. |
| **Vercel** | AI Gateway → **API Keys** → create a key for the server. Set a **budget** (AI Gateway → Budgets) and leave auto top-up off. |
| **Render** | Sign up and connect your GitHub. |

Connection strings and API keys are secrets. Never commit them, and never put them in a `VITE_*` variable (those are public).

## 2. Try one real Jev call (optional, costs a fraction of a cent)

```bash
export AI_GATEWAY_API_KEY="your-key"
curl -s https://ai-gateway.vercel.sh/v1/evaluate \
  -H "Authorization: Bearer $AI_GATEWAY_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"typesafe-ai/jev","state":"Example: the printing press made books cheaper, which spread ideas.",
       "questions":{"claim":{"type":"boolean","instructions":"Does the text make a claim?"}},
       "providerOptions":{"gateway":{"disallowPromptTraining":true}}}'
```

Or score a sample essay end to end: `cd rubriqly-backend && uv run python scripts/smoke_jev.py`. That's a free dry run; add `--yes` to make the real calls.

## 3. The Blueprint

1. Copy `render.example.yaml` to `render.yaml` in your repo and replace every `YOUR-…` placeholder:
   - the `/api/*` rewrite destination → your API service's address, e.g. `https://my-rubriqly-api.onrender.com`. Render shows it after the first deploy, so you may need to update it once.
   - `VITE_SITE_URL` → your site's full address. `VITE_CONTACT_EMAIL` → your contact address.
   - `ALLOWED_ORIGINS` → your site's addresses, comma-separated.
   - Rename the services if you like.
2. Commit and push. On Render: **New → Blueprint** → pick your repo → **Apply**.
3. Render may ask for the secrets. If it doesn't, open the API service → **Environment** and add:
   - `DATABASE_URL`: the Neon connection string (production branch)
   - `AI_GATEWAY_API_KEY`: the Vercel key

   `SECRET_KEY` is generated for you. Then **Manual Deploy**.
4. Watch the API's logs. You should see the Alembic migration run, then `Uvicorn running`.
5. Open `https://<your-site>/api/health`. You should see `{"status":"ok"}`. If you see the web page instead, the `/api/*` rewrite is missing or points at the wrong address.

The API refuses to start in production without a Postgres `DATABASE_URL`, a real `SECRET_KEY`, or (with `JEV_MODE=live` or `SCAN_MODE=live`) an `AI_GATEWAY_API_KEY`. The log says which one is missing.

"Scan a rubric" needs `SCAN_MODE=live` (the example Blueprint sets it). Without it, the production site says rubric scanning isn't available rather than showing a demo rubric. Scans use `SCAN_MODEL` (default `google/gemini-2.5-flash`, which works on Vercel's free tier; newer Gemini models need paid credits). To check accuracy on your own photos first: `cd rubriqly-backend && uv run python scripts/smoke_scan.py photo.jpg` (a free dry run; add `--yes` for a real scan).

## 4. Your first account

Sign up on the site, or create accounts from your computer against the production database:

```bash
cd rubriqly-backend
DATABASE_URL='your-production-connection-string' uv run rubriqly create-user --email you@example.com --name "You"
```

The command prints a password once, and the first output line shows which database was used.

## 5. Custom domain (optional)

Render → the static site → **Settings → Custom Domains**. Add the DNS records it shows at your registrar, then wait for the certificate. Add the new address to `ALLOWED_ORIGINS` and set `VITE_SITE_URL` to it.

Browsers keep sign-in and saved drafts separately for each address, so pick one main address early.

## 6. Legal pages and wording

- `rubriqly-frontend/src/pages/landing/legal.ts` holds the Privacy Policy and Terms. They describe rubriqly.com's hosted service, so rewrite them for yours: operator, contact, jurisdiction, and any providers you change.
- `rubriqly-frontend/src/pages/landing/content.ts` holds the landing page copy.

## Everyday tasks

Run these from `rubriqly-backend/`. Put `DATABASE_URL='…'` in front to target production.

| Task | Command |
|---|---|
| Add a user | `uv run rubriqly create-user --email … --name "…"` |
| Reset a forgotten password | `uv run rubriqly reset-password --email …` (prints a new one) |
| Block / unblock | `uv run rubriqly deactivate-user --email …` / `activate-user` |
| List users | `uv run rubriqly list-users` |
| Today's sign-ups, checks and cost | `uv run rubriqly usage` |

Limits (checks per student and per day, sign-ups, word count) are environment variables; see `.env.example`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| The app says "Can't reach Rubriqly right now" | Open `/api/health` on the site. A web page means the rewrite is wrong; a long wait means the free API was asleep. |
| API log: `JEV_MODE=live needs AI_GATEWAY_API_KEY` / `DATABASE_URL must be…` / `SECRET_KEY must be set` | Add that variable under the API's **Environment**, then redeploy. |
| `password authentication failed` | The connection string is wrong or its password was reset. Copy it again from Neon. |
| Build fails at `uv sync --frozen` | Run `uv lock` in `rubriqly-backend`, commit `uv.lock`, push. |
| Scoring says the budget is reached | Raise the Vercel budget or add AI Gateway credits. |
