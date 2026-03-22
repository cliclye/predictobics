# Predictobics — Advanced FRC Analytics Platform

An analytics platform for FIRST Robotics Competition data, featuring component EPA metrics, defense-adjusted ratings, ML-powered match predictions, and Monte Carlo event simulation.

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL 15+
- A [TBA API key](https://www.thebluealliance.com/account)

### Setup

```bash
# 1. Create .env from template
cp .env.example .env
# Edit .env with your TBA_API_KEY and DATABASE_URL

# 2. Create the database
createdb statfrc

# 3. Install backend dependencies
cd backend
pip install -r requirements.txt

# 4. Install frontend dependencies
cd ../frontend
npm install

# 5. Start the backend (creates tables automatically)
cd ..
uvicorn backend.main:app --reload --port 8000

# 6. In another terminal, start the frontend dev server
cd frontend
npm start
```

### Ingest Data
```bash
# Trigger data ingestion + metric computation for a year
curl -X POST http://localhost:8000/api/ingest/2024

# Train the ML prediction model
curl -X POST http://localhost:8000/api/train/2024
```

## Architecture

```
backend/
  config.py          — Settings via pydantic-settings
  database.py        — Async SQLAlchemy engine
  main.py            — FastAPI app entry point
  ingestion/
    tba_client.py    — TBA API v3 HTTP client with ETag caching
    pipeline.py      — Idempotent data ingestion pipeline
  models/
    orm.py           — SQLAlchemy ORM models
  metrics/
    epa.py           — EPA computation engine (WLS + outlier rejection)
    compute.py       — DB-to-metrics orchestrator
    predictor.py     — Match prediction + Monte Carlo simulation
    evaluation.py    — Walk-forward backtests vs TBA (Brier, Spearman rank)
  api/
    routes.py        — FastAPI endpoints
    schemas.py       — Pydantic response models
frontend/
  src/
    App.js           — Router + layout
    api.js           — API client
    pages/           — React page components
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/team/{team_key}` | Team details + metrics history |
| GET | `/api/teams?search=...` | Search teams |
| GET | `/api/event/{event_key}` | Event info |
| GET | `/api/events?year=2024` | List events by year |
| GET | `/api/rankings/{event_key}` | EPA rankings for event |
| POST | `/api/match_prediction` | Predict match outcome |
| GET | `/api/simulate/{event_key}` | Monte Carlo event simulation |
| POST | `/api/ingest/{year}` | Trigger data ingestion |
| POST | `/api/compute/{event_key}` | Compute metrics for event |
| POST | `/api/train/{year}` | Train ML prediction model |
| GET | `/api/evaluation/year/{year}?max_events=40` | Backtest: match Brier/log-loss + EPA vs TBA rank correlation |

### Backtesting (historical accuracy)

After ingesting data, run a **walk-forward** evaluation (EPA recomputed before each match — no future leakage):

```bash
PYTHONPATH=. python scripts/evaluate_backtest.py --year 2024 --max-events 30
```

Or via API: `GET /api/evaluation/year/2024`. Tune calibration in `.env` / `config.py`:

- `PREDICTION_PROB_SHRINK` — pull win probabilities toward 50% (better Brier)
- `PREDICTION_Z_TEMPERATURE` — values above 1.0 soften upset probabilities
- `PREDICTION_ML_BLEND_WEIGHT` — ML vs analytical blend (0 = analytical only)

## Metrics

- **Component EPA**: Separate auto, teleop, endgame contributions via weighted least squares
- **Defense-adjusted EPA**: Normalized by opponent quality
- **Consistency**: 1/(1+σ), penalizing volatile performance
- **Reliability**: Fraction of matches with non-zero contribution
- **Strength of Schedule**: Average opponent EPA faced

Powered by [The Blue Alliance](https://www.thebluealliance.com).
