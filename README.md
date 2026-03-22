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
| `BULK_INGEST_SECRET` | If set, `POST /api/ingest/bulk` requires header `X-Bulk-Ingest-Secret` |

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

## Legal

This project is not affiliated with FIRST®, The Blue Alliance, or Statbotics. *FIRST®* is a registered trademark of FIRST. Match data trademarks are used for informational purposes.

Predictobics is independent analytics software; predictions are estimates, not guarantees.
