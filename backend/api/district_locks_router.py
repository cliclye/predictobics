"""
District locks API: two independent Monte Carlo estimates from the same TBA district rankings.

DCMP: probability of finishing in the District Championship field (district-size cutoff).
WCMP: separate FIRST Championship (merit-path) estimate using the district’s Houston slot count.

Not EPA/predictions.
"""

from __future__ import annotations

import asyncio
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
    get_wcmp_allocated_slots_for_district,
    merge_locks_into_rankings,
)

logger = logging.getLogger(__name__)

_LOCKS_DISCLAIMER = (
    "DCMP and WCMP are different competitions and different numbers. "
    "DCMP lock %% uses your district’s estimated District Championship field size (who makes the "
    "district championship event). "
    "WCMP lock %% is separate: it uses the district’s FIRST Championship slot allocation and simulates "
    "whether you finish high enough in district points for the merit path to Houston — not the same cutoff "
    "as DCMP, and not P(qualify by Impact, EI, winning DCMP, etc.). "
    "Both columns share the same underlying Monte Carlo over remaining district-week points; "
    "uncertainty scales while events are unfinished. Not a guarantee. "
    "Impact Award teams show Impact instead of %%. Verify with official FIRST / district sources."
)

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


def _event_status_from_matches(matches: list) -> str:
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


async def _event_status(event_key: str) -> str:
    matches = await get_event_matches(event_key)
    return _event_status_from_matches(matches or [])


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


def _impact_teams_from_awards(awards: list | None) -> list[str]:
    teams: list[str] = []
    for a in awards or []:
        if not _is_impact_award(a):
            continue
        for rec in a.get("recipient_list") or []:
            aw = rec.get("team_key") or rec.get("awardee")
            if isinstance(aw, str) and aw.startswith("frc"):
                teams.append(aw)
            elif isinstance(aw, dict) and aw.get("team_key"):
                teams.append(aw["team_key"])
    return teams


async def _count_impact_teams_for_event(event_key: str) -> list[str]:
    awards = await get_event_awards(event_key)
    return _impact_teams_from_awards(awards)


async def _district_locks_payload_impl(
    dkey: str,
    year: int,
    dcmp_spots_override: Optional[int],
    wcmp_allocated_override: Optional[int],
    wcmp_merit_sim_override: Optional[int],
    n_simulations: int,
) -> dict[str, Any]:
    """Build full district locks JSON. Raises ValueError if TBA has no rankings for this district."""
    rank_data = await get_district_rankings(dkey, year)
    if rank_data is None:
        raise ValueError(
            f"TBA returned no data for district {dkey}. "
            "Set TBA_API_KEY on the API server, and use a valid district key (e.g. 2026pnw)."
        )

    if isinstance(rank_data, list):
        rankings_raw = rank_data
    else:
        rankings_raw = (rank_data.get("rankings") or []) if isinstance(rank_data, dict) else []

    spots = get_dcmp_spots_for_district(dkey, dcmp_spots_override)
    wcmp_allocated = get_wcmp_allocated_slots_for_district(dkey, wcmp_allocated_override)
    if wcmp_merit_sim_override is not None and int(wcmp_merit_sim_override) > 0:
        wcmp_sim_cutoff = int(wcmp_merit_sim_override)
    else:
        wcmp_sim_cutoff = wcmp_allocated

    devents = await get_district_events_list(dkey, year)
    events_out: list[dict[str, Any]] = []
    impact_teams: set[str] = set()
    total_pts_available = 0
    calendar_incomplete = 0
    calendar_total = 0

    ev_sem = asyncio.Semaphore(8)

    async def _enrich_one_district_event(ev: dict) -> Optional[dict[str, Any]]:
        ek = ev.get("key")
        if not ek:
            return None
        async with ev_sem:
            matches, awards = await asyncio.gather(
                get_event_matches(ek),
                get_event_awards(ek),
            )
        name = ev.get("name") or ek
        n_teams = int(ev.get("team_count") or len(ev.get("teams", []) or []) or 0)
        status = _event_status_from_matches(matches or [])
        im = _impact_teams_from_awards(awards or [])
        et = ev.get("event_type")
        try:
            is_district_cmp = int(et) == 2 if et is not None else False
        except (TypeError, ValueError):
            is_district_cmp = False
        counts_for_calendar = not is_district_cmp
        pts_hint = int(22 * n_teams) if status != "completed" and n_teams > 0 else 0
        return {
            "event_key": ek,
            "name": name,
            "status": status,
            "team_count": n_teams,
            "impact_winners": im,
            "counts_for_lock_calendar": counts_for_calendar,
            "pts_hint": pts_hint,
        }

    enriched = await asyncio.gather(*[_enrich_one_district_event(ev) for ev in devents])
    for row in enriched:
        if row is None:
            continue
        events_out.append(
            {
                "event_key": row["event_key"],
                "name": row["name"],
                "status": row["status"],
                "team_count": row["team_count"],
                "impact_winners": row["impact_winners"],
                "counts_for_lock_calendar": row["counts_for_lock_calendar"],
            }
        )
        for t in row["impact_winners"]:
            impact_teams.add(t)
        total_pts_available += int(row["pts_hint"])
        if row["counts_for_lock_calendar"]:
            calendar_total += 1
            if (row["status"] or "") != "completed":
                calendar_incomplete += 1
    uncertainty_mult = calendar_uncertainty_multiplier(calendar_incomplete, calendar_total)

    lock_rows = estimate_lock_probabilities(
        rankings_raw,
        spots,
        n_simulations=n_simulations,
        calendar_events_incomplete=calendar_incomplete,
        calendar_events_total=calendar_total,
        wcmp_merit_spots=wcmp_sim_cutoff,
    )
    merged = merge_locks_into_rankings(rankings_raw, lock_rows)

    teams_out: list[dict[str, Any]] = []
    for i, row in enumerate(merged):
        tk = row.get("team_key", "")
        br = _point_breakdown(row)
        lp = row.get("lock_probability", 0.0)
        st = row.get("status", "out")
        wlp = row.get("wcmp_lock_probability")
        wst = row.get("wcmp_status", "out")
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
            entry["wcmp_lock_display"] = "Impact"
            entry["wcmp_lock_probability"] = None
            entry["wcmp_status"] = "impact"
        else:
            entry["lock_display"] = None
            entry["lock_probability"] = float(lp) if lp is not None else None
            entry["wcmp_lock_display"] = None
            entry["wcmp_lock_probability"] = (
                float(wlp) if wlp is not None else None
            )
            entry["wcmp_status"] = wst
        teams_out.append(entry)

    return {
        "district_key": dkey,
        "year": year,
        "dcmp_spots": spots,
        "wcmp_allocated_slots": wcmp_allocated,
        "wcmp_merit_sim_spots": wcmp_sim_cutoff,
        "impact_award_teams": sorted(impact_teams),
        "impact_award_count": len(impact_teams),
        "estimated_points_remaining_hint": total_pts_available,
        "calendar_events_incomplete": calendar_incomplete,
        "calendar_events_total": calendar_total,
        "lock_uncertainty_multiplier": uncertainty_mult,
        "events": events_out,
        "teams": teams_out,
        "disclaimer": _LOCKS_DISCLAIMER,
    }


def _slim_teams_for_wcmp_page(teams: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for t in teams:
        out.append(
            {
                "rank": t.get("rank"),
                "team_key": t.get("team_key"),
                "team_number": t.get("team_number"),
                "event_1_pts": t.get("event_1_pts"),
                "event_2_pts": t.get("event_2_pts"),
                "age_adjustment": t.get("age_adjustment"),
                "rookie_bonus": t.get("rookie_bonus"),
                "point_total": t.get("point_total"),
                "lock_probability": t.get("lock_probability"),
                "lock_display": t.get("lock_display"),
                "wcmp_lock_probability": t.get("wcmp_lock_probability"),
                "wcmp_lock_display": t.get("wcmp_lock_display"),
                "wcmp_status": t.get("wcmp_status"),
                "status": t.get("status"),
            }
        )
    return out


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


@router.get("/wcmp/{year}")
async def all_districts_wcmp_locks(
    year: int,
    n_simulations: int = Query(8000, ge=2000, le=25000),
):
    """
    WCMP-focused bundle: all district-model districts (DCMP + WCMP lock %%).
    Districts run in parallel with a small semaphore to limit TBA load; order matches ``districts_meta``.
    Prefer the browser calling ``/{district_key}/{year}`` per district for long Vercel timeouts.
    """
    raw = await get_districts_for_year(year)
    districts_meta: list[dict[str, Any]] = []
    for d in raw:
        if isinstance(d, dict) and d.get("key"):
            districts_meta.append(
                {
                    "key": d["key"],
                    "abbrev": d.get("abbrev") or abbrev_from_district_key(d["key"]),
                    "name": d.get("display_name") or d.get("name") or d["key"],
                }
            )
    districts_meta.sort(key=lambda x: x.get("name") or "")

    dist_sem = asyncio.Semaphore(3)

    async def _one(dm: dict[str, Any]) -> dict[str, Any]:
        dkey = dm["key"]
        dname = dm["name"]
        async with dist_sem:
            try:
                full = await _district_locks_payload_impl(
                    dkey,
                    year,
                    None,
                    None,
                    None,
                    n_simulations,
                )
                return {
                    "district_key": full["district_key"],
                    "name": dname,
                    "abbrev": dm.get("abbrev"),
                    "dcmp_spots": full["dcmp_spots"],
                    "wcmp_allocated_slots": full["wcmp_allocated_slots"],
                    "wcmp_merit_sim_spots": full["wcmp_merit_sim_spots"],
                    "calendar_events_incomplete": full["calendar_events_incomplete"],
                    "calendar_events_total": full["calendar_events_total"],
                    "lock_uncertainty_multiplier": full["lock_uncertainty_multiplier"],
                    "teams": _slim_teams_for_wcmp_page(full["teams"]),
                    "error": None,
                }
            except ValueError as e:
                logger.warning("district locks skipped for %s: %s", dkey, e)
                return {
                    "district_key": dkey,
                    "name": dname,
                    "abbrev": dm.get("abbrev"),
                    "error": str(e),
                    "teams": [],
                }
            except Exception as e:
                logger.exception("district locks failed for %s", dkey)
                return {
                    "district_key": dkey,
                    "name": dname,
                    "abbrev": dm.get("abbrev"),
                    "error": f"Server error while loading district: {e!s}",
                    "teams": [],
                }

    results: list[dict[str, Any]] = list(
        await asyncio.gather(*[_one(dm) for dm in districts_meta])
    )

    return {
        "year": year,
        "districts": results,
        "disclaimer": _LOCKS_DISCLAIMER,
    }


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
    wcmp_allocated_spots: Optional[int] = Query(
        None,
        description="Override district's total FIRST Championship slot allocation (all paths)",
    ),
    wcmp_merit_spots: Optional[int] = Query(
        None,
        description="Override WCMP lock %% rank cutoff (defaults to district's FIRST Championship slot count)",
    ),
    n_simulations: int = Query(8000, ge=2000, le=25000),
):
    """
    District rankings, per-event status, Impact winners, and two separate lock % columns (DCMP field vs WCMP merit path).
    """
    dkey = _normalize_district_key(district_key, year)
    try:
        return await _district_locks_payload_impl(
            dkey,
            year,
            dcmp_spots,
            wcmp_allocated_spots,
            wcmp_merit_spots,
            n_simulations,
        )
    except ValueError as e:
        raise HTTPException(404, str(e)) from e
