# Risk Assessment

## Highest-Risk Items

| Risk | Severity | Surfaces | Why It Matters | Mitigation |
| --- | --- | --- | --- | --- |
| Existing dirty worktree overlaps likely builder scope | High | `frontend/src/App.css`, `frontend/src/index.css`, `frontend/src/pages/HomePage.*`, `frontend/src/pages/PredictPage.*`, `backend/api/routes.py`, `backend/metrics/epa.py` | Builders can overwrite user/in-flight edits before redesign or algorithm work even begins | Coordinator should confirm whether current modifications are authoritative before assigning write ownership |
| API contract drift between UI and prediction work | High | `frontend/src/api.js`, `frontend/src/pages/TeamPage.js`, `frontend/src/pages/EventPage.js`, `backend/api/routes.py`, `backend/api/schemas.py` | Builder-1 is tightly coupled to current payloads; Builder-2 can easily break rendering with “small” schema changes | Keep response shapes stable unless coordinator approves a contract change |
| Event simulation and match prediction use inconsistent calibration paths | High | `backend/metrics/predictor.py`, `backend/api/routes.py` | Accuracy work on one surface can make another surface look worse or contradictory | Treat single-match and event simulation as one unit for validation |
| Schema changes may be needed for real accuracy gains | High | `backend/models/orm.py`, `backend/metrics/compute.py`, `backend/metrics/epa.py` | Synergy and richer calibration data are not persisted today | Escalate early if Builder-2 concludes persistence is required |

## Medium-Risk Items

| Risk | Severity | Surfaces | Why It Matters | Mitigation |
| --- | --- | --- | --- | --- |
| ML model artifact can go stale after feature changes | Medium | `backend/metrics/predictor.py`, `backend/metrics/trained_model.pkl`, `scripts/retrain_model.py` | Runtime quietly falls back to analytical mode on mismatch | Retrain as part of any feature-vector change and verify reported `model_used` values |
| No obvious automated test suite in repo | Medium | Whole repo | Regression detection depends on manual checks and scripts | Reviewer should require script-backed backtest numbers plus a frontend smoke pass |
| TBA live dependencies affect some routes | Medium | `backend/api/district_locks_router.py`, playoff prediction route, evaluation rank correlation | External failures can look like app regressions | Treat live-data failures separately from code regressions |
| Page-local polling and duplicated fetch logic | Medium | `TeamPage.js`, `EventPage.js`, `HomePage.js`, `PredictPage.js` | UI refactor can accidentally increase request volume or desynchronize refresh behavior | Builder-1 should centralize polling/search behavior if refactoring deeply |

## Low-Risk But Worth Tracking

| Risk | Severity | Surfaces | Why It Matters | Mitigation |
| --- | --- | --- | --- | --- |
| Team page explanation text overstates algorithm transparency | Low | `frontend/src/pages/TeamPage.js` | Users can misread equal score splits as actual per-team EPA | Fix during redesign if the page remains in scope |
| Client-side admin secret support is visible in bundle | Low | `frontend/src/api.js` | Not directly related to redesign/accuracy, but easy to misuse in public builds | Keep it private-build only as current comment states |

## Hidden Dependencies

- `backend/metrics/double_elim_playoffs.py` is an uninspected but important dependency for playoff prediction quality.
- `backend/api/routes.py` is the integration choke point for both builders.
- `backend/models/orm.py` becomes a shared dependency immediately if algorithm work needs new stored fields.
- `frontend/src/index.css` and `frontend/src/App.css` are global styling choke points even for page-local redesigns.

## Blockers / Clarifications To Raise Early

- If Builder-2 wants to improve playoff modeling beyond EPA/ranking heuristics, assign `backend/metrics/double_elim_playoffs.py` explicitly.
- If Builder-2 needs persisted synergy or model metadata, expand ownership to schema/migration work before implementation starts.
- If Builder-1 is expected to redesign the shell/theme, the current modified global CSS files need coordinator resolution first.

## Validation Expectations For Reviewer

- Backend:
  - compare `scripts/evaluate_backtest.py` outputs before/after
  - verify `model_used` still reports the intended path
  - spot-check `/match_prediction`, `/event_prediction`, and `/playoff_prediction` for payload compatibility
- Frontend:
  - verify all five routes render with unchanged payload shapes
  - check loading, error, and empty states
  - confirm polling views still refresh without duplicate request storms
