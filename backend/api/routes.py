"""
FastAPI route definitions.

All endpoints return JSON. Heavy operations (ingestion, metric computation,
model training) are run as background tasks so the API remains responsive.
"""

import logging
import numpy as np
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database import get_db
from backend.models.orm import Team, Event, Match, MatchAlliance, TeamEventMetrics
from backend.api.schemas import (
    TeamResponse, TeamDetailResponse, TeamMetricsResponse,
    EventResponse, EventRankingEntry, MatchPredictionRequest,
    MatchPredictionResponse, SimulationTeamResult, IngestionStatus,
    MatchResponse,
)
from backend.metrics.predictor import (
    predict_match, AllianceFeatures, simulate_event, train_model,
)
from backend.ingestion.pipeline import ingest_year, ingest_event_matches
from backend.metrics.compute import compute_event_metrics, compute_year_metrics

logger = logging.getLogger(__name__)
router = APIRouter()


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

    from scipy import stats as sp_stats

    MATCH_NOISE = 80.0

    def _alliance_stats(team_keys: list[str]):
        epa = 0.0
        eff = 0.0
        var = 0.0
        for tk in team_keys:
            met = metrics.get(tk)
            if not met:
                continue
            e = met.epa_total or 0
            c = met.consistency or 0.5
            r = met.reliability or 1.0
            epa += e
            eff += e * c * r
            var += met.score_variance or 0
        return epa, eff, var

    results = []
    for m in matches:
        sides = alliance_map.get(m.key, {})
        red_teams = sides.get("red", [])
        blue_teams = sides.get("blue", [])

        red_epa, red_eff, red_var = _alliance_stats(red_teams)
        blue_epa, blue_eff, blue_var = _alliance_stats(blue_teams)

        red_win_prob = None
        if red_epa or blue_epa:
            combined_sigma = np.sqrt(red_var + blue_var + 2 * MATCH_NOISE)
            if combined_sigma < 1e-6:
                combined_sigma = 12.0
            z = (red_eff - blue_eff) / combined_sigma
            red_win_prob = float(np.clip(sp_stats.norm.cdf(z), 0.01, 0.99))

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
            red_predicted_score=round(red_epa, 1) if red_epa else None,
            blue_predicted_score=round(blue_epa, 1) if blue_epa else None,
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


# ──────────────────────────── Admin / Ingestion ────────────────────────────

@router.post("/ingest/{year}", response_model=IngestionStatus)
async def trigger_ingestion(year: int, background_tasks: BackgroundTasks):
    background_tasks.add_task(_run_ingestion, year)
    return IngestionStatus(status="started", message=f"Ingestion for {year} started in background")


@router.post("/compute/{event_key}", response_model=IngestionStatus)
async def trigger_compute(event_key: str, background_tasks: BackgroundTasks):
    background_tasks.add_task(compute_event_metrics, event_key)
    return IngestionStatus(status="started", message=f"Compute for {event_key} started")


@router.post("/train/{year}", response_model=IngestionStatus)
async def trigger_training(year: int, background_tasks: BackgroundTasks):
    background_tasks.add_task(train_model, year)
    return IngestionStatus(status="started", message=f"Model training for {year} started")


# ──────────────────────────── Helpers ────────────────────────────

async def _run_ingestion(year: int):
    await ingest_year(year)
    await compute_year_metrics(year)


async def _build_alliance_features(
    team_keys: list[str], event_key: str, db: AsyncSession
) -> AllianceFeatures:
    epas = []
    autos = []
    teleops = []
    endgames = []
    consistencies = []
    reliabilities = []
    soss = []
    variances = []

    for tk in team_keys:
        result = await db.execute(
            select(TeamEventMetrics)
            .where(TeamEventMetrics.team_key == tk)
            .where(TeamEventMetrics.event_key == event_key)
        )
        m = result.scalar_one_or_none()
        if m:
            epas.append(m.epa_total or 0)
            autos.append(m.epa_auto or 0)
            teleops.append(m.epa_teleop or 0)
            endgames.append(m.epa_endgame or 0)
            consistencies.append(m.consistency or 0)
            reliabilities.append(m.reliability or 1)
            soss.append(m.strength_of_schedule or 0)
            variances.append(m.score_variance or 0)
        else:
            epas.append(0)
            autos.append(0)
            teleops.append(0)
            endgames.append(0)
            consistencies.append(0.5)
            reliabilities.append(1.0)
            soss.append(0)
            variances.append(100.0)

    raw_sum = sum(epas)
    avg_c = float(np.mean(consistencies))
    avg_r = float(np.mean(reliabilities))

    return AllianceFeatures(
        total_epa=raw_sum,
        auto_epa=sum(autos),
        teleop_epa=sum(teleops),
        endgame_epa=sum(endgames),
        avg_consistency=avg_c,
        avg_reliability=avg_r,
        avg_sos=float(np.mean(soss)),
        epa_stdev=float(np.std(epas)),
        total_variance=sum(variances),
        effective_epa=raw_sum * avg_c * avg_r,
        max_epa=max(epas) if epas else 0,
        min_epa=min(epas) if epas else 0,
    )
