"""
FastAPI route definitions.

All endpoints return JSON. Heavy operations (ingestion, metric computation,
model training) are run as background tasks so the API remains responsive.
"""

import logging
from typing import Optional

import numpy as np
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, Query, Header
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database import get_db
from backend.models.orm import Team, Event, Match, MatchAlliance, TeamEventMetrics
from backend.api.schemas import (
    TeamResponse, TeamDetailResponse, TeamMetricsResponse,
    EventResponse, EventRankingEntry, MatchPredictionRequest,
    MatchPredictionResponse, SimulationTeamResult, IngestionStatus,
    MatchResponse, EventPredictionResponse, PredictedRankEntry,
    PredictedAlliance, PlayoffMatch, BulkIngestRequest, BulkIngestQueued,
    ServerInfoResponse,
)
from backend.metrics.predictor import (
    predict_match,
    AllianceFeatures,
    simulate_event,
    train_model,
    build_alliance_features_from_metrics,
)
from backend.config import get_settings
from backend.ingestion.pipeline import ingest_year, ingest_event_matches, bulk_ingest_years
from backend.metrics.compute import compute_event_metrics, compute_year_metrics

logger = logging.getLogger(__name__)
router = APIRouter()


def _effective_write_secret() -> str:
    s = get_settings()
    return (s.admin_api_secret or s.bulk_ingest_secret or "").strip()


def _assert_write_authorized(
    x_admin_secret: Optional[str],
    x_bulk_ingest_secret: Optional[str],
) -> None:
    secret = _effective_write_secret()
    if not secret:
        return
    a = (x_admin_secret or "").strip()
    b = (x_bulk_ingest_secret or "").strip()
    if a == secret or b == secret:
        return
    raise HTTPException(
        status_code=403,
        detail="Invalid or missing X-Admin-Secret (or X-Bulk-Ingest-Secret with the same value).",
    )


@router.get("/server-info", response_model=ServerInfoResponse)
async def server_info():
    """Tells the SPA whether write operations need a secret (without revealing it)."""
    return ServerInfoResponse(write_secret_required=bool(_effective_write_secret()))


async def _qual_match_records(db: AsyncSession, event_key: str) -> dict[str, dict[str, int]]:
    """
    Win / loss / tie counts from played qualification matches in the DB
    (mirrors on-field results when scores and alliances are present).
    """
    r = await db.execute(
        select(Match).where(Match.event_key == event_key).where(Match.comp_level == "qm")
    )
    matches = r.scalars().all()
    if not matches:
        return {}
    mkeys = [m.key for m in matches]
    ar = await db.execute(select(MatchAlliance).where(MatchAlliance.match_key.in_(mkeys)))
    amap: dict[str, dict[str, list[str]]] = {}
    for a in ar.scalars().all():
        amap.setdefault(a.match_key, {}).setdefault(a.alliance, []).append(a.team_key)

    out: dict[str, dict[str, int]] = {}
    for m in matches:
        if m.red_score is None or m.blue_score is None:
            continue
        if m.red_score < 0 or m.blue_score < 0:
            continue
        sides = amap.get(m.key, {})
        reds = sides.get("red", [])
        blues = sides.get("blue", [])
        if not reds or not blues:
            continue
        for tk in reds + blues:
            out.setdefault(tk, {"w": 0, "l": 0, "t": 0})
        if m.red_score == m.blue_score:
            for tk in reds + blues:
                out[tk]["t"] += 1
            continue
        win = (m.winning_alliance or "").strip().lower()
        if win not in ("red", "blue"):
            win = "red" if m.red_score > m.blue_score else "blue"
        lose = "blue" if win == "red" else "red"
        for tk in sides.get(win, []):
            out[tk]["w"] += 1
        for tk in sides.get(lose, []):
            out[tk]["l"] += 1
    return out


def _run_snake_draft_greedy_epa(
    captains: list[str],
    pool_sorted_epa: list[str],
    skip_first_pick: bool,
) -> list[list[str]]:
    """
    FRC-style snake: round 1 order 1..8 or (2025+ skip) 2..8 then 1;
    round 2 order 8..1. Each pick takes the highest-EPA team left in *pool*
    (pool must be sorted by EPA descending before calling).
    """
    pool = list(pool_sorted_epa)
    alliances = [[c] for c in captains]
    if skip_first_pick:
        order_r1 = list(range(1, 8)) + [0]
    else:
        order_r1 = list(range(8))
    for i in order_r1:
        if pool:
            alliances[i].append(pool.pop(0))
    for i in range(7, -1, -1):
        if pool:
            alliances[i].append(pool.pop(0))
    return alliances


# ──────────────────────────── Team endpoints ────────────────────────────

@router.get("/team/{team_key}", response_model=TeamDetailResponse)
async def get_team(
    team_key: str,
    year: int = Query(None),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Team).where(Team.key == team_key))
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(404, f"Team {team_key} not found")

    query = (
        select(TeamEventMetrics)
        .where(TeamEventMetrics.team_key == team_key)
    )
    if year is not None:
        query = query.where(TeamEventMetrics.year == year)
    query = query.order_by(TeamEventMetrics.year.desc())

    metrics_result = await db.execute(query)
    metrics = metrics_result.scalars().all()

    return TeamDetailResponse(
        team=TeamResponse(
            key=team.key, team_number=team.team_number, name=team.name,
            city=team.city, state_prov=team.state_prov, country=team.country,
            rookie_year=team.rookie_year,
        ),
        metrics=[
            TeamMetricsResponse(
                team_key=m.team_key, event_key=m.event_key, year=m.year,
                epa_total=m.epa_total, epa_auto=m.epa_auto,
                epa_teleop=m.epa_teleop, epa_endgame=m.epa_endgame,
                epa_defense_adjusted=m.epa_defense_adjusted,
                consistency=m.consistency, reliability=m.reliability,
                strength_of_schedule=m.strength_of_schedule,
                matches_played=m.matches_played or 0,
            ) for m in metrics
        ],
    )


@router.get("/teams", response_model=list[TeamResponse])
async def list_teams(
    page: int = Query(0, ge=0),
    size: int = Query(50, ge=1, le=500),
    search: str = Query(None),
    db: AsyncSession = Depends(get_db),
):
    query = select(Team)
    if search:
        query = query.where(
            Team.name.ilike(f"%{search}%") | Team.key.ilike(f"%{search}%")
        )
    query = query.order_by(Team.team_number).offset(page * size).limit(size)
    result = await db.execute(query)
    teams = result.scalars().all()
    return [
        TeamResponse(
            key=t.key, team_number=t.team_number, name=t.name,
            city=t.city, state_prov=t.state_prov, country=t.country,
            rookie_year=t.rookie_year,
        ) for t in teams
    ]


# ──────────────────────────── Event endpoints ────────────────────────────

@router.get("/event/{event_key}", response_model=EventResponse)
async def get_event(event_key: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Event).where(Event.key == event_key))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(404, f"Event {event_key} not found")
    return EventResponse(
        key=event.key, name=event.name, year=event.year,
        city=event.city, state_prov=event.state_prov, country=event.country,
        start_date=event.start_date, end_date=event.end_date, week=event.week,
    )


@router.get("/events", response_model=list[EventResponse])
async def list_events(
    year: int = Query(...),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Event).where(Event.year == year).order_by(Event.start_date)
    )
    events = result.scalars().all()
    return [
        EventResponse(
            key=e.key, name=e.name, year=e.year,
            city=e.city, state_prov=e.state_prov, country=e.country,
            start_date=e.start_date, end_date=e.end_date, week=e.week,
        ) for e in events
    ]


# ──────────────────────────── Rankings ────────────────────────────

@router.get("/rankings/{event_key}", response_model=list[EventRankingEntry])
async def get_rankings(event_key: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TeamEventMetrics, Team)
        .join(Team, TeamEventMetrics.team_key == Team.key)
        .where(TeamEventMetrics.event_key == event_key)
        .order_by(TeamEventMetrics.epa_total.desc())
    )
    rows = result.all()
    if not rows:
        raise HTTPException(404, f"No metrics found for {event_key}")

    return [
        EventRankingEntry(
            rank=idx + 1,
            team_key=m.team_key,
            team_number=t.team_number,
            team_name=t.name,
            epa_total=m.epa_total,
            epa_auto=m.epa_auto,
            epa_teleop=m.epa_teleop,
            epa_endgame=m.epa_endgame,
            epa_defense_adjusted=m.epa_defense_adjusted,
            consistency=m.consistency,
            reliability=m.reliability,
            matches_played=m.matches_played or 0,
        ) for idx, (m, t) in enumerate(rows)
    ]


# ──────────────────────────── Matches ────────────────────────────

COMP_LEVEL_ORDER = {"qm": 0, "ef": 1, "qf": 2, "sf": 3, "f": 4}


@router.get("/matches/{event_key}", response_model=list[MatchResponse])
async def get_matches(event_key: str, db: AsyncSession = Depends(get_db)):
    matches_result = await db.execute(
        select(Match).where(Match.event_key == event_key)
    )
    matches = matches_result.scalars().all()

    if not matches:
        return []

    alliances_result = await db.execute(
        select(MatchAlliance)
        .where(MatchAlliance.match_key.in_([m.key for m in matches]))
    )
    alliances = alliances_result.scalars().all()

    alliance_map: dict[str, dict[str, list[str]]] = {}
    for a in alliances:
        alliance_map.setdefault(a.match_key, {}).setdefault(a.alliance, [])
        teams = alliance_map[a.match_key][a.alliance]
        while len(teams) <= (a.position or 0):
            teams.append("")
        teams[a.position or len(teams) - 1] = a.team_key

    metrics_result = await db.execute(
        select(TeamEventMetrics)
        .where(TeamEventMetrics.event_key == event_key)
    )
    metrics = {m.team_key: m for m in metrics_result.scalars().all()}

    results = []
    for m in matches:
        sides = alliance_map.get(m.key, {})
        red_teams = sides.get("red", [])
        blue_teams = sides.get("blue", [])

        red_feat = build_alliance_features_from_metrics(red_teams, metrics)
        blue_feat = build_alliance_features_from_metrics(blue_teams, metrics)

        red_win_prob = None
        red_pred = None
        blue_pred = None
        if red_feat.total_epa or blue_feat.total_epa:
            pred = predict_match(red_feat, blue_feat)
            red_win_prob = pred.red_win_prob
            red_pred = round(pred.red_expected_score, 1)
            blue_pred = round(pred.blue_expected_score, 1)

        results.append(MatchResponse(
            key=m.key,
            comp_level=m.comp_level,
            set_number=m.set_number,
            match_number=m.match_number,
            time=m.time,
            red_score=m.red_score,
            blue_score=m.blue_score,
            winning_alliance=m.winning_alliance,
            red_teams=red_teams,
            blue_teams=blue_teams,
            red_predicted_score=red_pred,
            blue_predicted_score=blue_pred,
            red_win_prob=red_win_prob,
        ))

    results.sort(key=lambda r: (COMP_LEVEL_ORDER.get(r.comp_level, 99), r.set_number, r.match_number))
    return results


# ──────────────────────────── Predictions ────────────────────────────

@router.post("/match_prediction", response_model=MatchPredictionResponse)
async def predict_match_endpoint(
    req: MatchPredictionRequest,
    db: AsyncSession = Depends(get_db),
):
    if len(req.red_teams) != 3 or len(req.blue_teams) != 3:
        raise HTTPException(400, "Each alliance must have exactly 3 teams")

    red_feat = await _build_alliance_features(req.red_teams, req.event_key, db)
    blue_feat = await _build_alliance_features(req.blue_teams, req.event_key, db)

    result = predict_match(red_feat, blue_feat)
    return MatchPredictionResponse(
        red_win_prob=result.red_win_prob,
        blue_win_prob=result.blue_win_prob,
        red_expected_score=result.red_expected_score,
        blue_expected_score=result.blue_expected_score,
        model_used=result.model_used,
    )


@router.get("/simulate/{event_key}", response_model=list[SimulationTeamResult])
async def simulate_event_endpoint(
    event_key: str,
    n: int = Query(500, ge=10, le=5000),
):
    results = await simulate_event(event_key, n_simulations=n)
    return [
        SimulationTeamResult(
            team_key=tk,
            avg_rank=data["avg_rank"],
            avg_rp=data["avg_rp"],
            median_rp=data["median_rp"],
            p90_rp=data["p90_rp"],
            p10_rp=data["p10_rp"],
        )
        for tk, data in sorted(results.items(), key=lambda x: x[1]["avg_rank"])
    ]


# ──────────────────────── Full Event Prediction ────────────────────────

@router.get("/event_prediction/{event_key}", response_model=EventPredictionResponse)
async def predict_event(
    event_key: str,
    n: int = Query(500, ge=50, le=5000),
    skip_first_pick: Optional[bool] = Query(
        None,
        description="Alliance 1 defers first pick to end of round 1 (2025+ rule). "
        "Default: true for 2025 and later events.",
    ),
    db: AsyncSession = Depends(get_db),
):
    from scipy import stats as sp_stats

    sim_results = await simulate_event(event_key, n_simulations=n)
    if not sim_results:
        raise HTTPException(
            404,
            f"No prediction data for {event_key}: ingest matches and compute EPA for this event first.",
        )

    ev_row = await db.execute(select(Event).where(Event.key == event_key))
    ev = ev_row.scalar_one_or_none()
    event_year = ev.year if ev else 0
    apply_skip = skip_first_pick if skip_first_pick is not None else (event_year >= 2025)

    metrics_result = await db.execute(
        select(TeamEventMetrics, Team)
        .join(Team, TeamEventMetrics.team_key == Team.key)
        .where(TeamEventMetrics.event_key == event_key)
    )
    team_data = {m.team_key: (m, t) for m, t in metrics_result.all()}

    matches_result = await db.execute(
        select(Match).where(Match.event_key == event_key)
        .where(Match.comp_level == "qm")
    )
    total_quals = len(matches_result.scalars().all())

    records = await _qual_match_records(db, event_key)

    team_keys = list(sim_results.keys())
    ep_vals = [
        float((team_data.get(tk, (None, None))[0].epa_total or 0) if team_data.get(tk, (None, None))[0] else 0)
        for tk in team_keys
    ]
    rp_vals = [float(sim_results[tk]["avg_rp"]) for tk in team_keys]
    min_e, max_e = min(ep_vals), max(ep_vals)
    min_rp, max_rp = min(rp_vals), max(rp_vals)

    def _norm(val: float, lo: float, hi: float) -> float:
        if hi - lo < 1e-9:
            return 0.5
        return (val - lo) / (hi - lo)

    def _composite(tk: str) -> float:
        m, _ = team_data.get(tk, (None, None))
        e = float(m.epa_total or 0) if m else 0.0
        rp = float(sim_results[tk]["avg_rp"])
        rec = records.get(tk, {"w": 0, "l": 0, "t": 0})
        w, l, t = rec["w"], rec["l"], rec["t"]
        played = w + l + t
        win_pct = (w + 0.5 * t) / played if played else 0.5
        e_n = _norm(e, min_e, max_e)
        rp_n = _norm(rp, min_rp, max_rp)
        if played >= 6:
            return 0.35 * e_n + 0.25 * rp_n + 0.40 * win_pct
        if played >= 3:
            return 0.42 * e_n + 0.28 * rp_n + 0.30 * win_pct
        return 0.52 * e_n + 0.48 * rp_n

    ranked = sorted(sim_results.items(), key=lambda x: (_composite(x[0]), x[1]["avg_rp"]), reverse=True)

    predicted_rankings = []
    for rank, (tk, data) in enumerate(ranked, 1):
        m, t = team_data.get(tk, (None, None))
        avg_rp = data["avg_rp"]
        matches_per_team = total_quals * 6 // max(len(sim_results), 1) if total_quals > 0 else 10
        if matches_per_team < 1:
            matches_per_team = 10
        wins = avg_rp / 2.0
        losses = matches_per_team - wins
        rec = records.get(tk, {"w": 0, "l": 0, "t": 0})
        qw, ql, qt = rec["w"], rec["l"], rec["t"]
        played = qw + ql + qt
        actual_qual_record = f"{qw}-{ql}-{qt}" if played > 0 else None
        predicted_rankings.append(PredictedRankEntry(
            rank=rank,
            team_key=tk,
            team_number=t.team_number if t else int(tk.replace("frc", "")),
            team_name=t.name if t else None,
            epa_total=m.epa_total if m else 0,
            predicted_rp=avg_rp,
            predicted_record=f"{wins:.0f}-{losses:.0f}",
            win_pct=wins / max(matches_per_team, 1),
            actual_qual_record=actual_qual_record,
        ))

    # Alliance selection: top 8 captains by composite rank; greedy EPA from remaining pool; snake (+ optional skip)
    available = list(ranked)
    captains = [tk for tk, _ in available[:8]]
    remaining = [tk for tk, _ in available[8:]]

    def _epa(tk):
        m, _ = team_data.get(tk, (None, None))
        return (m.epa_total or 0) if m else 0

    remaining.sort(key=lambda tk: _epa(tk), reverse=True)

    alliances = _run_snake_draft_greedy_epa(captains, remaining, apply_skip)

    predicted_alliances = []
    for i, alliance_teams in enumerate(alliances):
        captain = alliance_teams[0] if len(alliance_teams) > 0 else ""
        pick1 = alliance_teams[1] if len(alliance_teams) > 1 else ""
        pick2 = alliance_teams[2] if len(alliance_teams) > 2 else ""

        def _num(tk):
            _, t = team_data.get(tk, (None, None))
            return t.team_number if t else int(tk.replace("frc", "")) if tk else 0

        alliance_epa = sum(_epa(tk) for tk in alliance_teams)
        predicted_alliances.append(PredictedAlliance(
            number=i + 1,
            captain=captain,
            pick1=pick1,
            pick2=pick2,
            captain_num=_num(captain),
            pick1_num=_num(pick1),
            pick2_num=_num(pick2),
            alliance_epa=round(alliance_epa, 1),
        ))

    # Playoff bracket: QF -> SF -> F
    def _alliance_epa_total(alliance_num):
        if alliance_num - 1 < len(alliances):
            return sum(_epa(tk) for tk in alliances[alliance_num - 1])
        return 0

    def _alliance_var(alliance_num):
        if alliance_num - 1 < len(alliances):
            return sum(
                (team_data.get(tk, (None, None))[0].score_variance or 0)
                if team_data.get(tk, (None, None))[0] else 0
                for tk in alliances[alliance_num - 1]
            )
        return 0

    def _predict_bo3(a1, a2):
        epa1 = _alliance_epa_total(a1)
        epa2 = _alliance_epa_total(a2)
        var1 = _alliance_var(a1)
        var2 = _alliance_var(a2)
        sigma = np.sqrt(var1 + var2 + 160.0)
        if sigma < 1e-6:
            sigma = 12.0
        z = (epa1 - epa2) / sigma
        single_win = float(sp_stats.norm.cdf(z))
        # Best of 3: P(win series) = p^2 + 2*p^2*(1-p)
        p = single_win
        series_p = p * p + 2 * p * p * (1 - p)
        return float(np.clip(series_p, 0.01, 0.99))

    bracket = []
    qf_matchups = [(1, 8), (4, 5), (2, 7), (3, 6)]
    qf_winners = []
    for i, (a, b) in enumerate(qf_matchups):
        p = _predict_bo3(a, b)
        winner = a if p >= 0.5 else b
        qf_winners.append(winner)
        bracket.append(PlayoffMatch(
            round_name="Quarterfinal", match_num=i + 1,
            red_alliance=a, blue_alliance=b,
            red_win_prob=round(p, 3), winner=winner,
        ))

    sf_matchups = [(qf_winners[0], qf_winners[1]), (qf_winners[2], qf_winners[3])]
    sf_winners = []
    for i, (a, b) in enumerate(sf_matchups):
        p = _predict_bo3(a, b)
        winner = a if p >= 0.5 else b
        sf_winners.append(winner)
        bracket.append(PlayoffMatch(
            round_name="Semifinal", match_num=i + 1,
            red_alliance=a, blue_alliance=b,
            red_win_prob=round(p, 3), winner=winner,
        ))

    final_a, final_b = sf_winners[0], sf_winners[1]
    final_p = _predict_bo3(final_a, final_b)
    final_winner = final_a if final_p >= 0.5 else final_b
    bracket.append(PlayoffMatch(
        round_name="Final", match_num=1,
        red_alliance=final_a, blue_alliance=final_b,
        red_win_prob=round(final_p, 3), winner=final_winner,
    ))

    winner_teams = alliances[final_winner - 1] if final_winner - 1 < len(alliances) else []

    ranking_note = (
        "Predicted rank blends EPA, simulated RP, and actual qualification W-L-T (when "
        "enough matches are in the database) so the order is not EPA-only."
    )
    alliance_note = (
        "Greedy picks (strongest EPA still available). Snake draft: round 1 "
        + ("2→8, then 1" if apply_skip else "1→8")
        + ", round 2 8→1. "
        + (
            "Alliance 1 may defer first pick to the end of round 1 (2025+ FIRST rule); "
            "declines are not modeled."
            if apply_skip
            else "Pre-2025 order: round 1 is 1→8 with no skip."
        )
    )

    return EventPredictionResponse(
        predicted_rankings=predicted_rankings,
        predicted_alliances=predicted_alliances,
        playoff_bracket=bracket,
        predicted_winner=final_winner,
        predicted_winner_teams=winner_teams,
        event_year=event_year,
        alliance_skip_first_pick=apply_skip,
        alliance_selection_note=alliance_note,
        ranking_method_note=ranking_note,
    )


# ──────────────────────────── Evaluation (backtests vs history) ────────────────────────────

@router.get("/evaluation/year/{year}")
async def evaluate_year_endpoint(
    year: int,
    max_events: int = Query(40, ge=5, le=200),
    walk_forward: bool = Query(
        True,
        description="If true, recomputes EPA before each match (honest; slower). "
        "If false, only leaky baseline is omitted from walk-forward block.",
    ),
):
    """
    Compare match predictions to actual QM results and EPA order vs TBA ranks.
    Requires ingested data + TBA key for ranking correlation.
    """
    from backend.metrics.evaluation import evaluate_year

    return await evaluate_year(year, max_events=max_events, walk_forward=walk_forward)


# ──────────────────────────── Admin / Ingestion ────────────────────────────

@router.post("/ingest/{year}", response_model=IngestionStatus)
async def trigger_ingestion(
    year: int,
    background_tasks: BackgroundTasks,
    x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"),
    x_bulk_ingest_secret: Optional[str] = Header(None, alias="X-Bulk-Ingest-Secret"),
):
    _assert_write_authorized(x_admin_secret, x_bulk_ingest_secret)
    background_tasks.add_task(_run_ingestion, year)
    return IngestionStatus(status="started", message=f"Ingestion for {year} started in background")


@router.post("/ingest/bulk", response_model=BulkIngestQueued)
async def trigger_bulk_ingestion(
    body: BulkIngestRequest,
    background_tasks: BackgroundTasks,
    x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"),
    x_bulk_ingest_secret: Optional[str] = Header(None, alias="X-Bulk-Ingest-Secret"),
):
    """
    Pre-pull many years of events + matches + EPA (historical archive).

    Runs in the background; may take hours for large ranges. When
    `ADMIN_API_SECRET` or `BULK_INGEST_SECRET` is set in the API environment,
    send the same value in `X-Admin-Secret` or `X-Bulk-Ingest-Secret`.
    If neither is set, the endpoint is open (local dev only).
    """
    _assert_write_authorized(x_admin_secret, x_bulk_ingest_secret)

    async def _bulk_job():
        await bulk_ingest_years(
            body.start_year,
            body.end_year,
            refresh_teams_first=body.refresh_teams_first,
            compute_metrics=body.compute_metrics,
            newest_first=body.newest_first,
            pause_between_years_sec=body.pause_between_years_sec,
        )

    background_tasks.add_task(_bulk_job)
    return BulkIngestQueued(
        status="started",
        message=f"Bulk ingest queued for {body.start_year}–{body.end_year}. "
        "Progress is logged on the server; use scripts/bulk_ingest.py for a foreground run.",
        start_year=body.start_year,
        end_year=body.end_year,
    )


@router.post("/compute/{event_key}", response_model=IngestionStatus)
async def trigger_compute(
    event_key: str,
    background_tasks: BackgroundTasks,
    x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"),
    x_bulk_ingest_secret: Optional[str] = Header(None, alias="X-Bulk-Ingest-Secret"),
):
    _assert_write_authorized(x_admin_secret, x_bulk_ingest_secret)
    background_tasks.add_task(compute_event_metrics, event_key)
    return IngestionStatus(status="started", message=f"Compute for {event_key} started")


@router.post("/train/{year}", response_model=IngestionStatus)
async def trigger_training(
    year: int,
    background_tasks: BackgroundTasks,
    x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"),
    x_bulk_ingest_secret: Optional[str] = Header(None, alias="X-Bulk-Ingest-Secret"),
):
    _assert_write_authorized(x_admin_secret, x_bulk_ingest_secret)
    background_tasks.add_task(train_model, year)
    return IngestionStatus(status="started", message=f"Model training for {year} started")


# ──────────────────────────── Helpers ────────────────────────────

async def _run_ingestion(year: int):
    await ingest_year(year)
    await compute_year_metrics(year)


async def _build_alliance_features(
    team_keys: list[str], event_key: str, db: AsyncSession
) -> AllianceFeatures:
    metrics: dict = {}
    for tk in team_keys:
        result = await db.execute(
            select(TeamEventMetrics)
            .where(TeamEventMetrics.team_key == tk)
            .where(TeamEventMetrics.event_key == event_key)
        )
        metrics[tk] = result.scalar_one_or_none()
    return build_alliance_features_from_metrics(team_keys, metrics)
