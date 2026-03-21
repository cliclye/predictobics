"""
Orchestrator that loads match data from the database, runs the EPA engine,
and writes results back to team_event_metrics.

This module bridges the database layer and the pure-math EPA module,
keeping the EPA engine free of database dependencies for testability.
"""

import logging
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from backend.database import async_session
from backend.models.orm import Match, MatchAlliance, TeamEventMetrics, Team
from backend.metrics.epa import MatchRecord, compute_epa
from datetime import datetime

logger = logging.getLogger(__name__)


async def compute_event_metrics(event_key: str):
    """
    Compute and store EPA + auxiliary metrics for all teams at an event.

    Pipeline:
    1. Load all matches for the event.
    2. For each match, build two MatchRecords (one per alliance).
    3. Feed all records into the EPA engine.
    4. Upsert results into team_event_metrics.
    """
    async with async_session() as session:
        matches_result = await session.execute(
            select(Match)
            .where(Match.event_key == event_key)
            .where(Match.comp_level == "qm")
            .where(Match.red_score >= 0)
            .where(Match.blue_score >= 0)
            .order_by(Match.match_number)
        )
        matches = matches_result.scalars().all()

        if not matches:
            logger.warning(f"No qual matches found for {event_key}")
            return

        alliances_result = await session.execute(
            select(MatchAlliance)
            .where(MatchAlliance.match_key.in_([m.key for m in matches]))
        )
        alliances = alliances_result.scalars().all()

        alliance_map: dict[str, dict[str, list[str]]] = {}
        for a in alliances:
            alliance_map.setdefault(a.match_key, {}).setdefault(a.alliance, []).append(a.team_key)

        records: list[MatchRecord] = []
        for idx, match in enumerate(matches):
            sides = alliance_map.get(match.key, {})
            for color in ("red", "blue"):
                teams = sides.get(color, [])
                if not teams:
                    continue
                score = match.red_score if color == "red" else match.blue_score
                auto = match.red_auto_score if color == "red" else match.blue_auto_score
                teleop = match.red_teleop_score if color == "red" else match.blue_teleop_score
                endgame = match.red_endgame_score if color == "red" else match.blue_endgame_score

                records.append(MatchRecord(
                    match_key=match.key,
                    team_keys=teams,
                    score_total=score or 0,
                    score_auto=auto or 0,
                    score_teleop=teleop or 0,
                    score_endgame=endgame or 0,
                    match_index=idx,
                ))

        if not records:
            return

        metrics = compute_epa(records)

        # Only insert metrics for teams that exist in the teams table
        all_team_keys = list(metrics.keys())
        existing_result = await session.execute(
            select(Team.key).where(Team.key.in_(all_team_keys))
        )
        valid_teams = {r[0] for r in existing_result.fetchall()}

        year = int(event_key[:4])
        for team_key, tm in metrics.items():
            if team_key not in valid_teams:
                continue
            metric_vals = dict(
                epa_total=tm.epa_total,
                epa_auto=tm.epa_auto,
                epa_teleop=tm.epa_teleop,
                epa_endgame=tm.epa_endgame,
                epa_defense_adjusted=tm.epa_defense_adjusted,
                consistency=tm.consistency,
                reliability=tm.reliability,
                strength_of_schedule=tm.strength_of_schedule,
                matches_played=tm.matches_played,
                score_variance=tm.score_variance,
                updated_at=datetime.utcnow(),
            )
            stmt = pg_insert(TeamEventMetrics.__table__).values(
                team_key=team_key,
                event_key=event_key,
                year=year,
                **metric_vals,
            ).on_conflict_do_update(
                constraint="uq_team_event",
                set_=metric_vals,
            )
            await session.execute(stmt)

        await session.commit()
        logger.info(f"Computed metrics for {len(metrics)} teams at {event_key}")


async def compute_year_metrics(year: int):
    """Compute metrics for every event in a given year."""
    from backend.models.orm import Event
    async with async_session() as session:
        result = await session.execute(
            select(Event.key).where(Event.year == year)
        )
        event_keys = [r[0] for r in result.fetchall()]

    for ek in event_keys:
        try:
            await compute_event_metrics(ek)
        except Exception as e:
            logger.error(f"Failed to compute metrics for {ek}: {e}")
