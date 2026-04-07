# Algorithm Hotspot Report

## Current Prediction Pipeline

1. Match/event data enters through `backend/ingestion/pipeline.py`
2. `backend/metrics/compute.py` builds `MatchRecord` rows from qualification matches
3. `backend/metrics/epa.py` computes component EPA, variance, consistency, reliability, defense-adjusted EPA, and pair synergy scores
4. `backend/metrics/compute.py` persists only per-team event metrics to `team_event_metrics`
5. `backend/metrics/predictor.py` serves:
   - single-match prediction
   - event Monte Carlo simulation
   - training / model loading
6. `backend/api/routes.py` assembles:
   - match predictions
   - team season bundles
   - event rankings
   - event prediction payloads
   - playoff prediction payloads
7. `backend/metrics/evaluation.py` backtests the stack offline

## Hotspots

### H1. Qualification ranking simulation does not model bonus ranking points

- Severity: High
- Evidence:
  - `backend/metrics/predictor.py:597-647`
  - `backend/api/routes.py:554-577`
- Current behavior:
  - played and simulated matches award only win/tie points
  - `avg_rp` is then converted into `predicted_record` by dividing by 2
- Why this matters:
  - FRC qualification ranking is not just W/L/T
  - `predicted_rankings`, `predicted_rp`, and `predicted_record` are structurally biased even if match win probabilities improve
- Likely builder surface:
  - `backend/metrics/predictor.py`
  - `backend/api/routes.py`

### H2. Event simulation uses a different uncertainty model than single-match prediction

- Severity: High
- Evidence:
  - single-match variance scaling in `backend/metrics/predictor.py:216-230`
  - event simulation variance in `backend/metrics/predictor.py:621-624`
- Current behavior:
  - `/match_prediction` widens variance using reliability and match-count adjustments
  - `simulate_event()` ignores those adjustments and samples from raw variance plus noise only
- Why this matters:
  - `/match_prediction` and `/event_prediction` can disagree for the same alliances
  - calibration work in the analytical predictor does not fully carry over to event projections

### H3. Synergy is computed but effectively dropped on the floor

- Severity: High
- Evidence:
  - synergy generation in `backend/metrics/epa.py:184-247`
  - `build_alliance_features_from_metrics()` supports synergy in `backend/metrics/predictor.py:82-165`
  - compute persistence omits it in `backend/metrics/compute.py:83-123`
  - event/match routes call feature builders without synergy maps in `backend/api/routes.py:399-406` and `backend/metrics/predictor.py:615-616`
- Current behavior:
  - pair synergy scores are calculated at EPA time
  - they are not stored in the DB schema
  - runtime predictors do not receive them
- Why this matters:
  - there is dead algorithmic work in the current pipeline
  - an obvious accuracy lever is unavailable to the runtime system
- Hidden dependency:
  - real use of synergy likely needs schema or cache support beyond current `TeamEventMetrics`

### H4. EPA solve path is dense and repeatedly recomputed

- Severity: Medium
- Evidence:
  - dense matrix build in `backend/metrics/epa.py:80-126`
  - dense diagonal weight matrix in `backend/metrics/epa.py:250-256`
  - repeated solves for total/auto/teleop/endgame plus outlier passes in `backend/metrics/epa.py:122-144`
- Current behavior:
  - every event compute builds full dense matrices
  - each outlier pass re-solves all four component systems
- Why this matters:
  - historical recompute and evaluation loops will be slower than necessary
  - builder iteration cost rises when tuning EPA repeatedly

### H5. Walk-forward evaluation is honest but expensive

- Severity: Medium
- Evidence:
  - prefix rebuild loop in `backend/metrics/evaluation.py:114-145`
  - `_records_for_prefix()` rebuilds prior match records each iteration in `backend/metrics/evaluation.py:70-98`
- Current behavior:
  - for each qualification match, EPA is recomputed from scratch on all prior matches
- Why this matters:
  - backtests are expensive, which slows algorithm tuning
  - the team may default to the optimistic “leaky” evaluation more often because it is faster

### H6. Alliance selection and playoff projections are heuristic-capped

- Severity: Medium
- Evidence:
  - composite captain ranking in `backend/api/routes.py:536-552`
  - greedy EPA snake draft in `backend/api/routes.py:579-612`
  - explicit note that declines are not modeled in `backend/api/routes.py:629-639`
- Current behavior:
  - captain order blends EPA, simulated RP, and actual W-L-T
  - picks are greedy best EPA remaining
  - decline behavior and composition strategy are not modeled
- Why this matters:
  - playoff champion predictions can plateau even if the match model improves
  - event predictions depend on several human-decision heuristics, not just EPA quality

## Secondary Hotspots

- `backend/api/routes.py:450-453` uses `_build_alliance_features()` that performs one DB query per requested team; acceptable for one-off predictions, but not ideal if this endpoint becomes heavily used.
- `backend/api/routes.py:390-430` predicts every event match during response assembly; team pages and playoff polling reuse this path frequently.

## Data-Model Constraints

- `backend/models/orm.py:105-133` stores only per-team-per-event aggregates.
- There is no place to persist:
  - pair synergy
  - model version
  - calibration metadata beyond score variance
- If Builder-2 wants persistent synergy or richer uncertainty data, schema work becomes part of the algorithm task.

## Model Artifact Dependency

- `backend/metrics/predictor.py` loads `trained_model.pkl` at runtime.
- Feature-count mismatch falls back to analytical prediction rather than hard-failing.
- If Builder-2 changes feature engineering, retraining is required or the ML path silently stops contributing.

## Recommended Builder-2 Order

1. Fix ranking/event simulation semantics first: bonus RP and uncertainty alignment.
2. Re-run `scripts/evaluate_backtest.py` to get before/after numbers.
3. Only then decide whether synergy should become a real persisted feature.
4. Treat alliance-selection/playoff heuristics as a separate phase so match-model gains stay measurable.
