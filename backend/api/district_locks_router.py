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
    get_district_events_list,
    get_district_rankings,
    get_districts_for_year,
    get_event_awards,
    get_event_matches,
)
from backend.metrics.district_locks import (
    abbrev_from_district_key,
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


@router.get("/{district_key}/{year}")
async def get_district_locks(
    district_key: str,
    year: int,
    dcmp_spots: Optional[int] = Query(
        None,
        description="Override DCMP field size for this district (from FIRST)",
    ),
    n_simulations: int = Query(2500, ge=500, le=15000),
):
    """
    District rankings, per-event status, Impact winners, estimated DCMP lock %.
    """
    dkey = _normalize_district_key(district_key, year)

    rank_data = await get_district_rankings(dkey, year)
    if not rank_data:
        raise HTTPException(
            404,
            f"No district rankings for {dkey}. Check district key and year.",
        )

    rankings_raw = rank_data.get("rankings") or []
    if not rankings_raw:
        raise HTTPException(404, f"Empty rankings for {dkey} / {year}")

    spots = get_dcmp_spots_for_district(dkey, dcmp_spots)

    lock_rows = estimate_lock_probabilities(
        rankings_raw,
        spots,
        n_simulations=n_simulations,
    )
    merged = merge_locks_into_rankings(rankings_raw, lock_rows)

    teams_out: list[dict[str, Any]] = []
    for i, row in enumerate(merged):
        tk = row.get("team_key", "")
        pt = row.get("point_total")
        if pt is None and row.get("sort_orders"):
            so = row["sort_orders"]
            pt = float(so[0]) if so else 0.0
        else:
            pt = float(pt or 0)
        teams_out.append(
            {
                "rank": row.get("rank") or i + 1,
                "team_key": tk,
                "team_number": _team_num(tk),
                "point_total": pt,
                "rookie_bonus": float(row.get("rookie_bonus") or 0),
                "event_points": row.get("event_points") or [],
                "lock_probability": row.get("lock_probability", 0.0),
                "status": row.get("status", "out"),
            }
        )

    # District events
    devents = await get_district_events_list(dkey, year)
    events_out: list[dict[str, Any]] = []
    impact_teams: set[str] = set()
    total_pts_available = 0

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

        events_out.append(
            {
                "event_key": ek,
                "name": name,
                "status": status,
                "team_count": n_teams,
                "impact_winners": im,
            }
        )

    return {
        "district_key": dkey,
        "year": year,
        "dcmp_spots": spots,
        "impact_award_teams": sorted(impact_teams),
        "impact_award_count": len(impact_teams),
        "estimated_points_remaining_hint": total_pts_available,
        "events": events_out,
        "teams": teams_out,
        "disclaimer": (
            "DCMP field sizes and points are approximate; lock %% is a Monte Carlo model. "
            "Verify qualification with official FIRST sources."
        ),
    }
