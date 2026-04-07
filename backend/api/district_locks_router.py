"""
District Championship lock estimates — live data from The Blue Alliance.

Separate from EPA/predictions; uses district rankings + Monte Carlo.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

from backend.ingestion.tba_client import (
    get_district_championship_event,
    get_district_events_list,
    get_district_rankings,
    get_districts_for_year,
    get_event_awards,
    get_event_matches,
)
from backend.metrics.district_locks import (
    abbrev_from_district_key,
    calendar_uncertainty_multiplier,
    estimate_lock_probabilities,
    get_dcmp_spots_for_district,
    merge_locks_into_rankings,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/district_locks", tags=["district_locks"])


def _normalize_district_key(district_key: str, year: int) -> str:
    dk = district_key.strip()
    if len(dk) >= 4 and dk[:4].isdigit():
        return dk
    return f"{year}{dk.lower()}"


def _team_num(team_key: str) -> int:
    m = re.match(r"^frc(\d+)$", team_key or "", re.I)
    return int(m.group(1)) if m else 0


def _match_alliance_scores(m: dict) -> tuple[Optional[int], Optional[int]]:
    """TBA API uses alliances.red.score, not top-level red_score."""
    al = m.get("alliances") or {}
    r = al.get("red") or {}
    b = al.get("blue") or {}
    rs = r.get("score")
    bs = b.get("score")
    if rs is None and m.get("red_score") is not None:
        rs = m.get("red_score")
    if bs is None and m.get("blue_score") is not None:
        bs = m.get("blue_score")
    return rs, bs


async def _event_status(event_key: str) -> str:
    matches = await get_event_matches(event_key)
    if not matches:
        return "pre_event"
    qm = [m for m in matches if m.get("comp_level") == "qm"]
    if not qm:
        return "in_progress"

    def _played(m: dict) -> bool:
        rs, bs = _match_alliance_scores(m)
        return rs is not None and bs is not None and rs >= 0 and bs >= 0

    played_n = sum(1 for m in qm if _played(m))
    if played_n >= len(qm):
        return "completed"
    if played_n > 0:
        return "qualifications"
    return "pre_event"


def _is_impact_award(award: dict) -> bool:
    name = (award.get("name") or "").lower()
    if "impact" in name:
        return True
    if "chairman" in name and "impact" not in name:
        return False
    # Legacy Chairman's Award
    if "chairman" in name:
        return True
    return False


def _point_breakdown(row: dict) -> dict[str, int]:
    """Event 1 / Event 2 district points, age/adjustments, rookie, total (TBA fields)."""
    evp = [e for e in (row.get("event_points") or []) if not e.get("district_cmp")]
    evp.sort(key=lambda e: e.get("event_key", "") or "")
    e1 = int(evp[0].get("total", 0)) if len(evp) > 0 else 0
    e2 = int(evp[1].get("total", 0)) if len(evp) > 1 else 0
    age = int(row.get("adjustments") or 0)
    rookie = int(row.get("rookie_bonus") or 0)
    pt = row.get("point_total")
    if pt is None and row.get("sort_orders"):
        pt = row["sort_orders"][0]
    total = int(pt or 0)
    return {
        "event_1_pts": e1,
        "event_2_pts": e2,
        "age_adjustment": age,
        "rookie_bonus": rookie,
        "point_total": total,
    }


async def _count_impact_teams_for_event(event_key: str) -> list[str]:
    awards = await get_event_awards(event_key)
    teams: list[str] = []
    for a in awards:
        if not _is_impact_award(a):
            continue
        for rec in a.get("recipient_list") or []:
            aw = rec.get("team_key") or rec.get("awardee")
            if isinstance(aw, str) and aw.startswith("frc"):
                teams.append(aw)
            elif isinstance(aw, dict) and aw.get("team_key"):
                teams.append(aw["team_key"])
    return teams


@router.get("/districts/{year}")
async def list_districts(year: int):
    """All districts for a season (for dropdown)."""
    raw = await get_districts_for_year(year)
    out = []
    for d in raw:
        if isinstance(d, dict) and d.get("key"):
            out.append(
                {
                    "key": d["key"],
                    "abbrev": d.get("abbrev") or abbrev_from_district_key(d["key"]),
                    "name": d.get("display_name") or d.get("name") or d["key"],
                }
            )
    return sorted(out, key=lambda x: x.get("name") or "")


@router.get("/championship/{district_abbrev}/{year}")
async def lookup_district_championship_event(district_abbrev: str, year: int):
    """
    Resolve the TBA event key for a district's District Championship (DCMP).

    Example: ``/district_locks/championship/pnw/2026`` → PNW DCMP for use with
    ``/event/{event_key}`` (EPA rankings, event & playoff predictions).
    """
    dkey = _normalize_district_key(district_abbrev, year)
    ev = await get_district_championship_event(dkey, year)
    if not ev or not ev.get("key"):
        raise HTTPException(
            404,
            f"No District Championship event (TBA type DISTRICT_CMP) found for {dkey}. "
            "It may not be published on TBA for this season yet.",
        )
    return {
        "district_key": dkey,
        "year": year,
        "event_key": ev["key"],
        "name": ev.get("name") or ev["key"],
        "start_date": ev.get("start_date"),
        "week": ev.get("week"),
    }


@router.get("/{district_key}/{year}")
async def get_district_locks(
    district_key: str,
    year: int,
    dcmp_spots: Optional[int] = Query(
        None,
        description="Override DCMP field size for this district (from FIRST)",
    ),
    n_simulations: int = Query(8000, ge=2000, le=25000),
):
    """
    District rankings, per-event status, Impact winners, estimated DCMP lock %.
    """
    dkey = _normalize_district_key(district_key, year)

    rank_data = await get_district_rankings(dkey, year)
    if rank_data is None:
        raise HTTPException(
            404,
            f"TBA returned no data for district {dkey}. "
            "Set TBA_API_KEY on the API server, and use a valid district key (e.g. 2026pnw).",
        )

    # TBA returns a list; older code paths may use {"rankings": [...]}
    if isinstance(rank_data, list):
        rankings_raw = rank_data
    else:
        rankings_raw = (rank_data.get("rankings") or []) if isinstance(rank_data, dict) else []

    spots = get_dcmp_spots_for_district(dkey, dcmp_spots)

    # District events + Impact winners (collect before building team rows)
    devents = await get_district_events_list(dkey, year)
    events_out: list[dict[str, Any]] = []
    impact_teams: set[str] = set()
    total_pts_available = 0
    calendar_incomplete = 0
    calendar_total = 0

    for ev in devents:
        ek = ev.get("key")
        if not ek:
            continue
        name = ev.get("name") or ek
        n_teams = int(ev.get("team_count") or len(ev.get("teams", []) or []) or 0)
        status = await _event_status(ek)
        # Rough hint: not yet awarded district points at incomplete events
        if status != "completed" and n_teams > 0:
            total_pts_available += int(22 * n_teams)

        im = await _count_impact_teams_for_event(ek)
        for t in im:
            impact_teams.add(t)

        # TBA EventType: 1 = District week events (ranking points); 2 = District Championship.
        # DCMP does not add to the same district-points race; don't treat it as "open calendar"
        # for lock uncertainty once all week events are done.
        et = ev.get("event_type")
        try:
            is_district_cmp = int(et) == 2 if et is not None else False
        except (TypeError, ValueError):
            is_district_cmp = False
        counts_for_calendar = not is_district_cmp

        events_out.append(
            {
                "event_key": ek,
                "name": name,
                "status": status,
                "team_count": n_teams,
                "impact_winners": im,
                "counts_for_lock_calendar": counts_for_calendar,
            }
        )
        if counts_for_calendar:
            calendar_total += 1
            if (status or "") != "completed":
                calendar_incomplete += 1
    uncertainty_mult = calendar_uncertainty_multiplier(calendar_incomplete, calendar_total)

    lock_rows = estimate_lock_probabilities(
        rankings_raw,
        spots,
        n_simulations=n_simulations,
        calendar_events_incomplete=calendar_incomplete,
        calendar_events_total=calendar_total,
    )
    merged = merge_locks_into_rankings(rankings_raw, lock_rows)

    teams_out: list[dict[str, Any]] = []
    for i, row in enumerate(merged):
        tk = row.get("team_key", "")
        br = _point_breakdown(row)
        lp = row.get("lock_probability", 0.0)
        st = row.get("status", "out")
        is_impact = tk in impact_teams
        entry: dict[str, Any] = {
            "rank": row.get("rank") or i + 1,
            "team_key": tk,
            "team_number": _team_num(tk),
            "event_1_pts": br["event_1_pts"],
            "event_2_pts": br["event_2_pts"],
            "age_adjustment": br["age_adjustment"],
            "rookie_bonus": br["rookie_bonus"],
            "point_total": br["point_total"],
            "event_points": row.get("event_points") or [],
            "status": "impact" if is_impact else st,
        }
        if is_impact:
            entry["lock_display"] = "Impact"
            entry["lock_probability"] = None
        else:
            entry["lock_display"] = None
            entry["lock_probability"] = float(lp) if lp is not None else None
        teams_out.append(entry)

    return {
        "district_key": dkey,
        "year": year,
        "dcmp_spots": spots,
        "impact_award_teams": sorted(impact_teams),
        "impact_award_count": len(impact_teams),
        "estimated_points_remaining_hint": total_pts_available,
        "calendar_events_incomplete": calendar_incomplete,
        "calendar_events_total": calendar_total,
        "lock_uncertainty_multiplier": uncertainty_mult,
        "events": events_out,
        "teams": teams_out,
        "disclaimer": (
            "DCMP field sizes are approximate. Lock %% is a Monte Carlo over remaining district "
            "points; uncertainty scales up while district *week* events (not District Championship) "
            "are still in progress on the calendar — not a guarantee. "
            "Impact Award teams show Impact instead of %%. Verify with official FIRST / district sources."
        ),
    }
