# Ownership Recommendation

## Proposed Builder Boundaries

### Builder-1: Frontend Redesign

Primary ownership:

- `frontend/src/App.js`
- `frontend/src/api.js`
- `frontend/src/App.css`
- `frontend/src/index.css`
- `frontend/src/pages/HomePage.js`
- `frontend/src/pages/HomePage.css`
- `frontend/src/pages/EventPage.js`
- `frontend/src/pages/EventPage.css`
- `frontend/src/pages/TeamPage.js`
- `frontend/src/pages/TeamPage.css`
- `frontend/src/pages/PredictPage.js`
- `frontend/src/pages/PredictPage.css`
- `frontend/src/pages/LocksPage.js`
- `frontend/src/pages/LocksPage.css`
- any new `frontend/src/components/*` or `frontend/src/hooks/*` files created during the redesign

Why this boundary is clean:

- all UI composition, styling, and client fetch behavior stay on one side
- avoids backend merge conflicts except at the API contract line
- lets Builder-1 normalize duplicated autocomplete/polling patterns without cross-team edits

### Builder-2: Prediction / Metrics Improvement

Primary ownership:

- `backend/metrics/compute.py`
- `backend/metrics/epa.py`
- `backend/metrics/predictor.py`
- `backend/metrics/evaluation.py`
- `backend/api/routes.py` only for prediction-related route logic and payload assembly
- `backend/api/schemas.py` only if response fields must change
- `scripts/recompute_all_metrics.py`
- `scripts/retrain_model.py`
- `scripts/evaluate_backtest.py`

Conditional ownership to assign explicitly if needed:

- `backend/metrics/double_elim_playoffs.py`
- `backend/config.py`
- `backend/models/orm.py`

Why this boundary is clean:

- all algorithmic changes remain in the metric/prediction pipeline
- offline evaluation and retraining stay with the team changing the model
- frontend remains insulated as long as response shapes do not move

## Shared Contract Line

These payloads should be treated as stable unless the coordinator explicitly approves a contract change:

| Contract | Consumed By |
| --- | --- |
| `TeamSeasonBundleResponse` | `frontend/src/pages/TeamPage.js` |
| `EventRankingEntry[]` | `frontend/src/pages/EventPage.js` |
| `MatchPredictionResponse` | `frontend/src/pages/PredictPage.js` |
| `EventPredictionResponse` | `frontend/src/pages/EventPage.js` |
| `PlayoffPredictionResponse` | `frontend/src/pages/EventPage.js` |
| District locks response shape | `frontend/src/pages/LocksPage.js` |

## Files That Need Coordinator Attention First

- Existing modified frontend globals:
  - `frontend/src/App.css`
  - `frontend/src/index.css`
  - `frontend/src/pages/HomePage.js`
  - `frontend/src/pages/HomePage.css`
  - `frontend/src/pages/PredictPage.js`
  - `frontend/src/pages/PredictPage.css`
- Existing modified backend algorithm/API files:
  - `backend/api/routes.py`
  - `backend/metrics/epa.py`

Recommendation:

- Treat those files as already claimed until the coordinator clarifies whether the current edits are user-owned or fair game for the builders.

## Recommended Execution Order

1. Freeze the API contract first.
2. Let Builder-2 improve internals while preserving current response shapes.
3. Let Builder-1 redesign the UI against those stable payloads.
4. If Builder-2 discovers a necessary schema or payload change, stop and escalate before implementation spreads.

## Reviewer Focus

- verify Builder-2 did not silently break payloads the UI depends on
- verify Builder-1 did not regress route coverage or polling behaviors
- compare historical backtest metrics before and after algorithm work
- check that playoff prediction changes, if any, include the extra dependency files rather than only `predictor.py`
