# Predictobics

FRC analytics platform: component EPA, defense-adjusted metrics, match win probabilities, district “locks,” and optional ML blending. Data is sourced from [The Blue Alliance](https://www.thebluealliance.com/) (TBA).

**License:** [MIT](LICENSE)

## Features

- Event and team views with EPA breakdowns (auto / teleop / endgame)
- Match predictions (analytical Gaussian model ± optional trained classifier)
- District Championship lock estimates (Monte Carlo–style, where configured)
- PostgreSQL-backed ingestion and metric recomputation scripts

## Repository layout

| Path | Purpose |
|------|---------|
| `backend/` | FastAPI app, metrics (EPA, predictor), TBA ingestion |
| `frontend/` | React (Create React App) UI |
| `scripts/` | Bulk ingest, metric recompute, evaluation helpers |

## Requirements

- **Python** 3.10+ for local development (see `runtime.txt` for one deploy target)
- **Node.js** 18+ for the frontend
- **PostgreSQL** for the API database
- A **TBA API key** ([register here](https://www.thebluealliance.com/account))

## Quick start (local)

### 1. Backend

```bash
cd /path/to/predictobics
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env: set TBA_API_KEY and DATABASE_URL
PYTHONPATH=. uvicorn backend.main:app --reload --port 8000
```

API docs: `http://localhost:8000/docs`

### 2. Frontend

```bash
cd frontend
npm install
npm start
```

By default the dev server proxies `/api` to `http://localhost:8000`. For a separate API host, set `REACT_APP_API_URL` (e.g. `https://your-api.example.com/api`).

### 3. Production build (API serves static files)

```bash
cd frontend && npm run build
cd .. && PYTHONPATH=. uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

If `frontend/build` exists, `backend.main` mounts the SPA and static assets.

## Environment variables

Copy `.env.example` to `.env`. Common variables:

| Variable | Description |
|----------|-------------|
| `TBA_API_KEY` | **Required** for ingestion and live TBA calls |
| `DATABASE_URL` | Async SQLAlchemy URL (e.g. `postgresql+asyncpg://...`) |
| `DATABASE_URL_SYNC` | Optional sync URL if you add sync tooling |
| `ADMIN_API_SECRET` | If set, all write POSTs (`/ingest/*`, `/compute/*`, `/train/*`) require `X-Admin-Secret` (or `X-Bulk-Ingest-Secret` with the same value) |
| `BULK_INGEST_SECRET` | Legacy: if `ADMIN_API_SECRET` is empty, same protection as `ADMIN_API_SECRET` for every write route |
| `CORS_ORIGINS` | Optional comma-separated browser origins; default `*` |

Optional tuning (see `backend/config.py`): `PREDICTION_PROB_SHRINK`, `PREDICTION_Z_TEMPERATURE`, `PREDICTION_ML_BLEND_WEIGHT`, `PREDICTION_DEFENSE_BLEND`, and EPA-related `EPA_*` settings.

## Operations: refreshing metrics

After changing EPA or prediction code, recompute stored team/event metrics from existing match rows (fast):

```bash
PYTHONPATH=. python scripts/recompute_all_metrics.py
# Optional: --start 2019 --end 2026
```

Full re-ingest from TBA for many seasons (slow, respects TBA):

```bash
PYTHONPATH=. python scripts/bulk_ingest.py --start 2002 --end 2026 --newest-first
```

For hosted databases, use a connection URL whose hostname resolves from your machine (e.g. public proxy URL), or run scripts inside the same network as the database.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md).

## Deploying the frontend on Vercel

This repo is a **monorepo** (Python API + React UI). Vercel should build **only the React app**.

1. Import the GitHub repo into Vercel.
2. Open **Project → Settings → General**.
3. Set **Root Directory** to `frontend` and save.
4. Framework Preset: **Create React App** (or “Other” with build `npm run build`, output `build`).
5. Set **`REACT_APP_API_URL`** in **Environment Variables** to your public API base (e.g. `https://your-railway-app.up.railway.app/api`) so the browser calls Railway, not Vercel.

`frontend/vercel.json` provides SPA rewrites. The root `vercel.json` is a fallback if you build from the monorepo root with the root `package.json` `build` script.

If Vercel tries to install **Python** (`requirements.txt`) or **CPython 3.14**, Root Directory is probably not set to `frontend` — fix step 3.

## Legal

This project is not affiliated with FIRST®, The Blue Alliance, or Statbotics. *FIRST®* is a registered trademark of FIRST. Match data trademarks are used for informational purposes.

Predictobics is independent analytics software; predictions are estimates, not guarantees.
