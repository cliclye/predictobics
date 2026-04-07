# Codebase Map

## High-Level Split

- `frontend/`: React 19 single-page app built with `react-scripts`; route-per-page architecture, client-side fetches only.
- `backend/`: FastAPI API with async SQLAlchemy models/session management, plus ingestion, metric computation, and prediction logic.
- Primary data stores:
  - PostgreSQL tables in `backend/models/orm.py`
  - TBA live/API data for ingestion, district locks, playoff alliances, and some evaluation inputs

## Top-Level Directories

| Path | Role |
| --- | --- |
| `frontend/src` | SPA entrypoint, routes, page components, API client, CSS |
| `backend/api` | REST endpoints and response schemas |
| `backend/metrics` | EPA engine, predictor, event simulation, evaluation, district locks, playoff bracket logic |
| `backend/ingestion` | TBA ingestion pipeline and client |
| `backend/models` | SQLAlchemy ORM schema |
| `scripts` | Operational scripts for ingest, retraining, recompute, and backtesting |

## Frontend Route Map

| Route | Entry File | Backend Endpoints | Notes |
| --- | --- | --- | --- |
| `/` | `frontend/src/pages/HomePage.js` | `/events`, `/teams` | Event browser + team search |
| `/team/:teamKey` | `frontend/src/pages/TeamPage.js` | `/team/{team}/season` | Single round-trip team season bundle |
| `/event/:eventKey` | `frontend/src/pages/EventPage.js` | `/event/{key}`, `/rankings/{key}`, `/event_prediction/{key}`, `/playoff_prediction/{key}`, `/matches/{key}` | Heaviest UI surface |
| `/predict` | `frontend/src/pages/PredictPage.js` | `/match_prediction`, `/teams` | Manual match predictor |
| `/locks` | `frontend/src/pages/LocksPage.js` | `/district_locks/districts/{year}`, `/district_locks/{district}/{year}` | Separate from EPA pipeline |

## Frontend Shell

- SPA bootstrap: `frontend/src/index.js`
- Router shell: `frontend/src/App.js`
- Global tokens/reset: `frontend/src/index.css`
- Shared shell styles: `frontend/src/App.css`
- Central API client: `frontend/src/api.js`

## Backend Runtime Map

1. App startup in `backend/main.py`
   - initializes DB
   - mounts API routers under `/api`
   - runs auto-refresh loop for active events
2. Ingestion in `backend/ingestion/pipeline.py`
   - pulls teams, events, matches from TBA
   - fills `teams`, `events`, `matches`, `match_alliances`
3. Metric compute in `backend/metrics/compute.py`
   - loads qualification matches for one event
   - converts them into `MatchRecord`s
   - calls `backend/metrics/epa.py::compute_epa`
   - upserts `team_event_metrics`
4. Prediction in `backend/metrics/predictor.py`
   - single-match analytical/ML blend
   - Monte Carlo event simulation
   - model training and model artifact loading
5. API assembly in `backend/api/routes.py`
   - bundles DB rows into page-ready payloads
   - derives match predictions and event-level projections
6. District locks in `backend/api/district_locks_router.py`
   - separate live-TBA path; not coupled to EPA metrics

## Database Model Map

| Model | File | Purpose |
| --- | --- | --- |
| `Team` | `backend/models/orm.py` | Team identity and location |
| `Event` | `backend/models/orm.py` | Event metadata |
| `Match` | `backend/models/orm.py` | Scores, sub-scores, winner, timing |
| `MatchAlliance` | `backend/models/orm.py` | Team membership per alliance per match |
| `TeamEventMetrics` | `backend/models/orm.py` | Precomputed EPA-derived event metrics |

## Prediction Data Flow

`TBA -> ingest_event_matches -> Match + MatchAlliance -> compute_event_metrics -> compute_epa -> TeamEventMetrics -> predict_match/simulate_event -> API routes -> frontend pages`

Important branch points:

- Team page depends on `TeamSeasonBundleResponse` from `/team/{team}/season`
- Event rankings depend on stored `TeamEventMetrics`
- Event predictions depend on `simulate_event`, composite ranking heuristics, and playoff simulation
- Playoff predictions add an external dependency on actual alliances from TBA, with fallback reconstruction from playoff matches

## Supporting Scripts

| Script | Purpose |
| --- | --- |
| `scripts/recompute_all_metrics.py` | Recompute EPA/metrics without re-ingesting TBA data |
| `scripts/retrain_model.py` | Retrain the ML predictor and rewrite `trained_model.pkl` |
| `scripts/evaluate_backtest.py` | Run year-level evaluation and backtests |
| `scripts/bulk_ingest.py` | Large historical ingest workflow |

## Builder Takeaways

- Frontend and backend are cleanly separated at the REST boundary; Builder-1 can redesign UI as long as response shapes stay stable.
- `LocksPage` is algorithmically separate from EPA; UI work there should not assume shared backend logic with event/team predictions.
- The largest integration surface is `backend/api/routes.py`, especially `/team/{team}/season`, `/event_prediction/{event}`, and `/playoff_prediction/{event}`.
- Playoff accuracy changes may require work in `backend/metrics/double_elim_playoffs.py`, which is a dependency even though the main prediction surfaces start in `predictor.py` and `routes.py`.
