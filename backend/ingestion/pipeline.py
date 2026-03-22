"""
Data ingestion pipeline.

Fetches data from TBA and upserts it into the local PostgreSQL database.
Designed to be idempotent — safe to re-run without duplicating data.

Score breakdown parsing:
  TBA's score_breakdown JSON varies by year. We extract auto/teleop/endgame
  sub-scores where available and fall back to 0 when a field is missing.
  This makes the pipeline resilient across game changes.
"""

import asyncio
import logging
from datetime import datetime
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database import async_session
from backend.ingestion.tba_client import (
    get_teams_page, get_events_by_year, get_event_matches, get_event_teams
)
from backend.models.orm import Team, Event, Match, MatchAlliance

logger = logging.getLogger(__name__)


async def ingest_teams():
    """Fetch all teams from TBA (paginated) and upsert into DB."""
    async with async_session() as session:
        page = 0
        total = 0
        while True:
            teams_data = await get_teams_page(page)
            if not teams_data:
                break

            for t in teams_data:
                stmt = pg_insert(Team.__table__).values(
                    key=t["key"],
                    team_number=t["team_number"],
                    name=t.get("nickname") or t.get("name"),
                    city=t.get("city"),
                    state_prov=t.get("state_prov"),
                    country=t.get("country"),
                    rookie_year=t.get("rookie_year"),
                ).on_conflict_do_update(
                    index_elements=["key"],
                    set_=dict(
                        name=t.get("nickname") or t.get("name"),
                        city=t.get("city"),
                        state_prov=t.get("state_prov"),
                        country=t.get("country"),
                        rookie_year=t.get("rookie_year"),
                    )
                )
                await session.execute(stmt)

            await session.commit()
            total += len(teams_data)
            logger.info(f"Ingested teams page {page} ({len(teams_data)} teams)")
            page += 1

        logger.info(f"Total teams ingested: {total}")


async def ingest_events(year: int):
    """Fetch all events for a year and upsert."""
    async with async_session() as session:
        events_data = await get_events_by_year(year)
        if not events_data:
            logger.warning(f"No events found for {year}")
            return

        for e in events_data:
            start = _parse_date(e.get("start_date"))
            end = _parse_date(e.get("end_date"))

            stmt = pg_insert(Event.__table__).values(
                key=e["key"],
                name=e.get("name"),
                event_type=e.get("event_type"),
                year=e.get("year", year),
                city=e.get("city"),
                state_prov=e.get("state_prov"),
                country=e.get("country"),
                start_date=start,
                end_date=end,
                week=e.get("week"),
            ).on_conflict_do_update(
                index_elements=["key"],
                set_=dict(
                    name=e.get("name"),
                    event_type=e.get("event_type"),
                    start_date=start,
                    end_date=end,
                    week=e.get("week"),
                )
            )
            await session.execute(stmt)

        await session.commit()
        logger.info(f"Ingested {len(events_data)} events for {year}")


async def ingest_event_matches(event_key: str):
    """
    Fetch all matches for an event, upsert matches and alliance compositions.

    Parsing strategy for sub-scores:
      We attempt to pull autoPoints, teleopPoints, endgamePoints from the
      score_breakdown. These field names are stable across recent years but
      we default to 0 when missing, so older events degrade gracefully.
    """
    async with async_session() as session:
        matches_data = await get_event_matches(event_key)
        if not matches_data:
            return

        for m in matches_data:
            alliances = m.get("alliances", {})
            red = alliances.get("red", {})
            blue = alliances.get("blue", {})
            breakdown = m.get("score_breakdown") or {}

            red_bd = breakdown.get("red", {})
            blue_bd = breakdown.get("blue", {})

            match_time = None
            if m.get("time"):
                match_time = datetime.fromtimestamp(m["time"])

            red_auto = _extract_auto(red_bd)
            blue_auto = _extract_auto(blue_bd)
            red_teleop = _extract_teleop(red_bd)
            blue_teleop = _extract_teleop(blue_bd)
            red_endgame = _extract_endgame(red_bd)
            blue_endgame = _extract_endgame(blue_bd)
            red_total = red.get("score") or 0
            blue_total = blue.get("score") or 0
            red_foul = _int_or(red_bd.get("foulPoints"), 0)
            blue_foul = _int_or(blue_bd.get("foulPoints"), 0)

            if red_auto == 0 and red_teleop == 0 and red_total > 0 and red_bd:
                red_endgame = red_endgame or 0
                red_auto = _int_or(red_bd.get("totalAutoPoints"), 0)
                red_teleop = red_total - red_auto - red_endgame - red_foul
                if red_teleop < 0:
                    red_teleop = _int_or(red_bd.get("totalTeleopPoints"), 0)
            if blue_auto == 0 and blue_teleop == 0 and blue_total > 0 and blue_bd:
                blue_endgame = blue_endgame or 0
                blue_auto = _int_or(blue_bd.get("totalAutoPoints"), 0)
                blue_teleop = blue_total - blue_auto - blue_endgame - blue_foul
                if blue_teleop < 0:
                    blue_teleop = _int_or(blue_bd.get("totalTeleopPoints"), 0)

            match_vals = dict(
                red_score=red_total,
                blue_score=blue_total,
                red_auto_score=red_auto,
                blue_auto_score=blue_auto,
                red_teleop_score=red_teleop,
                blue_teleop_score=blue_teleop,
                red_endgame_score=red_endgame,
                blue_endgame_score=blue_endgame,
                red_foul_points=red_foul,
                blue_foul_points=blue_foul,
                score_breakdown=breakdown,
                winning_alliance=m.get("winning_alliance"),
            )
            stmt = pg_insert(Match.__table__).values(
                key=m["key"],
                event_key=event_key,
                comp_level=m["comp_level"],
                set_number=m["set_number"],
                match_number=m["match_number"],
                time=match_time,
                **match_vals,
            ).on_conflict_do_update(
                index_elements=["key"],
                set_=match_vals,
            )
            await session.execute(stmt)

            red_teams = red.get("team_keys", [])
            blue_teams = blue.get("team_keys", [])

            for pos, tk in enumerate(red_teams):
                await _upsert_match_alliance(session, m["key"], tk, "red", pos)
            for pos, tk in enumerate(blue_teams):
                await _upsert_match_alliance(session, m["key"], tk, "blue", pos)

        await session.commit()
        logger.info(f"Ingested {len(matches_data)} matches for {event_key}")


async def ingest_season(year: int):
    """
    Ingest all events + matches for one season without refreshing the global team list.
    Use this inside bulk jobs; call ingest_teams() once before many ingest_season() calls.
    """
    logger.info(f"Ingesting season {year} (events + matches)")
    await ingest_events(year)

    async with async_session() as session:
        result = await session.execute(
            select(Event.key).where(Event.year == year)
        )
        event_keys = [r[0] for r in result.fetchall()]

    for ek in event_keys:
        try:
            await ingest_event_matches(ek)
            logger.info(f"  Completed {ek}")
        except Exception as e:
            logger.error(f"  Failed {ek}: {e}")

    logger.info(f"Ingestion complete for {year}: {len(event_keys)} events")


async def ingest_year(year: int):
    """Full pipeline: teams, events, and all matches for a given year."""
    logger.info(f"Starting full ingestion for {year}")
    await ingest_teams()
    await ingest_season(year)


async def bulk_ingest_years(
    start_year: int,
    end_year: int,
    *,
    refresh_teams_first: bool = True,
    compute_metrics: bool = True,
    newest_first: bool = False,
    pause_between_years_sec: float = 1.0,
) -> dict:
    """
    Pre-fill the database for many seasons (historical archive).

    - Optionally refreshes the global team list once (recommended for first bulk run).
    - Processes each year: events → all event matches → optional EPA compute for that year.
    - Pauses briefly between years to stay polite to TBA.

    Returns a summary dict with per-year status.
    """
    from backend.metrics.compute import compute_year_metrics

    cy = datetime.utcnow().year
    start_year = max(2002, min(start_year, cy + 1))
    end_year = max(2002, min(end_year, cy + 1))
    if start_year > end_year:
        start_year, end_year = end_year, start_year

    years = list(range(start_year, end_year + 1))
    if newest_first:
        years.reverse()

    if refresh_teams_first:
        logger.info("Bulk ingest: refreshing global team list from TBA (one pass)")
        await ingest_teams()

    results: list[dict] = []

    for y in years:
        row = {"year": y, "ingest": "ok", "compute": "skipped"}
        try:
            await ingest_season(y)
        except Exception as e:
            logger.exception("Bulk ingest failed for season %s: %s", y, e)
            row["ingest"] = f"error: {e}"
            results.append(row)
            continue

        if compute_metrics:
            try:
                await compute_year_metrics(y)
                row["compute"] = "ok"
            except Exception as e:
                logger.exception("compute_year_metrics failed for %s: %s", y, e)
                row["compute"] = f"error: {e}"

        results.append(row)
        if pause_between_years_sec > 0:
            await asyncio.sleep(pause_between_years_sec)

    logger.info(
        "Bulk ingest finished: years %s–%s (%d seasons)",
        min(start_year, end_year),
        max(start_year, end_year),
        len(years),
    )
    return {
        "start_year": start_year,
        "end_year": end_year,
        "years_processed": years,
        "refresh_teams_first": refresh_teams_first,
        "results": results,
    }


async def refresh_active_events(year: int) -> list[str]:
    """
    Re-fetch matches only for events that are currently active (within their
    start/end date window, plus 1 day buffer). Returns list of event keys
    that were refreshed.
    """
    from backend.metrics.compute import compute_event_metrics

    now = datetime.utcnow()
    async with async_session() as session:
        result = await session.execute(
            select(Event).where(
                Event.year == year,
                Event.start_date <= now,
            )
        )
        events = result.scalars().all()

    active_keys = []
    for ev in events:
        if ev.end_date is None:
            active_keys.append(ev.key)
        else:
            from datetime import timedelta
            if ev.end_date + timedelta(days=1) >= now:
                active_keys.append(ev.key)

    if not active_keys:
        return []

    refreshed = []
    for ek in active_keys:
        try:
            await ingest_event_matches(ek)
            await compute_event_metrics(ek)
            refreshed.append(ek)
        except Exception as e:
            logger.error(f"  Refresh failed {ek}: {e}")

    if refreshed:
        logger.info(f"Auto-refreshed {len(refreshed)} active events for {year}")

    return refreshed


async def _upsert_match_alliance(session: AsyncSession, match_key: str,
                                  team_key: str, alliance: str, position: int):
    stmt = pg_insert(MatchAlliance.__table__).values(
        match_key=match_key,
        team_key=team_key,
        alliance=alliance,
        position=position,
    ).on_conflict_do_update(
        constraint="uq_match_team",
        set_=dict(alliance=alliance, position=position)
    )
    await session.execute(stmt)


def _int_or(val, default=0) -> int:
    if val is None:
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


def _extract_auto(breakdown: dict) -> int:
    for field in ["autoPoints", "totalAutoPoints"]:
        val = breakdown.get(field)
        if val is not None and val != 0:
            return _int_or(val, 0)
    return 0


def _extract_teleop(breakdown: dict) -> int:
    for field in ["teleopPoints", "totalTeleopPoints"]:
        val = breakdown.get(field)
        if val is not None and val != 0:
            return _int_or(val, 0)
    return 0


def _extract_endgame(breakdown: dict) -> int:
    for field in [
        "endGameTotalStagePoints", "endGameBargePoints",
        "endGameTowerPoints", "endGamePoints", "endgamePoints",
    ]:
        val = breakdown.get(field)
        if val is not None and val != 0:
            return _int_or(val, 0)
    return 0


def _parse_date(date_str: str | None) -> datetime | None:
    if not date_str:
        return None
    try:
        return datetime.fromisoformat(date_str)
    except (ValueError, TypeError):
        return None
