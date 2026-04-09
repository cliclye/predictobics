"""
District Championship (DCMP) and FIRST Championship (WCMP) lock estimates from TBA district rankings.

Uses Monte Carlo over remaining district point opportunities to estimate
P(rank <= DCMP cutoff) and, separately, P(rank <= merit-based Championship cutoff).
Rules vary by year; capacities are configurable.
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


def _row_points(row: dict) -> float:
    pt = row.get("point_total")
    if pt is not None:
        return float(pt)
    so = row.get("sort_orders") or []
    return float(so[0]) if so else 0.0

# Approximate DCMP field sizes by district (FIRST publishes yearly; tune as needed).
# Key = lowercase abbrev without year prefix (e.g. pnw, fim).
DEFAULT_DCMP_SPOTS: dict[str, int] = {
    "pnw": 50,
    "fim": 160,
    "ne": 64,
    "chs": 50,
    "in": 32,
    "isr": 45,
    "fma": 60,
    "fnc": 32,
    "fit": 64,
    "fin": 32,
    "fsc": 45,
    "pch": 45,
    "ont": 80,
}


def abbrev_from_district_key(district_key: str) -> str:
    """2026pnw -> pnw"""
    s = district_key.strip().lower()
    if len(s) > 4 and s[:4].isdigit():
        return s[4:]
    return s


def get_dcmp_spots_for_district(district_key: str, override: Optional[int] = None) -> int:
    if override is not None and override > 0:
        return int(override)
    ab = abbrev_from_district_key(district_key)
    return DEFAULT_DCMP_SPOTS.get(ab, 48)


# Approximate merit-based FIRST Championship slots filled via final district-points order,
# after reserving ~9 slots for typical DCMP winners / Impact / Dean's List / EI / RAS / WFFA paths.
# Based on FIRST Game Manual Table 11-8 style allocations (~2025); tune yearly.
DEFAULT_WCMP_MERIT_SPOTS: dict[str, int] = {
    "pnw": 13,
    "fim": 71,
    "ne": 22,
    "chs": 8,
    "in": 4,
    "isr": 4,
    "fma": 14,
    "fnc": 5,
    "fit": 19,
    "fin": 4,
    "fsc": 4,
    "pch": 4,
    "ont": 13,
}


def get_wcmp_merit_spots_for_district(district_key: str, override: Optional[int] = None) -> int:
    if override is not None and override > 0:
        return int(override)
    ab = abbrev_from_district_key(district_key)
    return DEFAULT_WCMP_MERIT_SPOTS.get(ab, 8)


def _team_event_slots_used(rank_row: dict) -> tuple[int, list[dict]]:
    """How many district events this team has earned points at (0–2 typical)."""
    evp = rank_row.get("event_points")
    if not evp:
        # No breakdown: if they already have district points, assume at least one event played
        if _row_points(rank_row) > 0:
            return (1, [])
        return (0, [])
    used = 0
    details = []
    for ep in evp:
        pts = ep.get("total") or ep.get("district_points") or ep.get("points") or 0
        if pts > 0:
            used += 1
        details.append(ep)
    return used, details


def _future_event_draw(rng: np.random.Generator) -> float:
    """
    Heavy-tailed draw for one future district event (similar spread to real FRC variance).
    Mixture: most teams cluster mid-table but upsets and blowouts happen.
    """
    # Mixture: "normal" event vs "high" event vs "rough" event
    u = rng.random()
    if u < 0.25:
        return max(0.0, float(rng.normal(24, 7)))
    if u < 0.65:
        return max(0.0, float(rng.normal(16, 8)))
    return max(0.0, float(rng.normal(8, 9)))


def calendar_uncertainty_multiplier(
    calendar_events_incomplete: int,
    calendar_events_total: int,
) -> float:
    """
    Scale simulated district-point variance when part of the district schedule is still open.

    Without this, teams that already maxed two events can look "100% locked" while several
    district events have not finished — other teams can still earn a lot of points there,
    so outcome uncertainty should stay material until the calendar completes.
    """
    n_inc = int(max(0, calendar_events_incomplete))
    n_tot = int(max(0, calendar_events_total))
    if n_inc <= 0 or n_tot <= 0:
        return 1.0
    frac = n_inc / float(n_tot)
    # Blend: share of calendar left + extra weight when many events remain
    raw = 1.0 + 1.35 * frac + 0.14 * (n_inc ** 0.5)
    return float(min(3.0, max(1.0, raw)))


def estimate_lock_probabilities(
    rankings: list[dict],
    dcmp_spots: int,
    n_simulations: int = 8000,
    seed: int = 42,
    calendar_events_incomplete: int = 0,
    calendar_events_total: int = 0,
    wcmp_merit_spots: Optional[int] = None,
) -> list[dict]:
    """
    Monte Carlo: simulate remaining district qual points with correlated uncertainty
    (district-wide shocks) and heavy-tailed per-event draws — top teams are not all ~100%
    while meaningful points remain on the calendar.

    ``calendar_events_incomplete`` / ``calendar_events_total`` (district events whose TBA
    status is not *completed*) widen the simulation when the district season is still in
    progress, so lock % reflects unknown outcomes at not-yet-finished events.

    When ``wcmp_merit_spots`` is set, the same draws also estimate P(rank <= that cutoff)
    for approximate FIRST Championship qualification via district-points order (merit path).
    """
    if not rankings or dcmp_spots < 1:
        return []

    mult = calendar_uncertainty_multiplier(calendar_events_incomplete, calendar_events_total)

    rng = np.random.default_rng(seed)
    n_teams = len(rankings)

    base = np.zeros(n_teams, dtype=float)
    slots_left = np.zeros(n_teams, dtype=int)

    for i, row in enumerate(rankings):
        base[i] = _row_points(row)
        used, _ = _team_event_slots_used(row)
        slots_left[i] = max(0, 2 - min(used, 2))

    probs = np.zeros(n_teams)
    do_wcmp = wcmp_merit_spots is not None and int(wcmp_merit_spots) > 0
    wk = min(int(wcmp_merit_spots), n_teams) if do_wcmp else 0
    probs_wcmp = np.zeros(n_teams) if do_wcmp else None

    # Correlated noise for teams still eligible to earn points: scales with open calendar
    global_std = 5.5 * mult
    lognorm_sigma = min(0.32, 0.18 * mult)

    for _ in range(n_simulations):
        sim = base.copy()
        global_shift = float(rng.normal(0.0, global_std))
        season_scale = float(rng.lognormal(0.0, lognorm_sigma))

        for i in range(n_teams):
            if slots_left[i] <= 0:
                continue
            sim[i] += global_shift
            for _ in range(int(slots_left[i])):
                sim[i] += _future_event_draw(rng) * season_scale * mult

        jitter = rng.random(n_teams) * 1e-5
        order = np.argsort(-(sim + jitter))
        inv_rank = np.empty_like(order)
        inv_rank[order] = np.arange(n_teams)
        in_top = inv_rank < dcmp_spots
        probs += in_top.astype(float)
        if do_wcmp and probs_wcmp is not None and wk > 0:
            probs_wcmp += (inv_rank < wk).astype(float)

    probs /= float(n_simulations)
    if do_wcmp and probs_wcmp is not None:
        probs_wcmp /= float(n_simulations)

    out = []
    for i, row in enumerate(rankings):
        tk = row.get("team_key", "")
        p = float(np.clip(probs[i], 0.0, 1.0))
        item: dict = {
            "team_key": tk,
            "lock_probability": p,
            "status": _status_bucket(p),
        }
        if do_wcmp and probs_wcmp is not None:
            pw = float(np.clip(probs_wcmp[i], 0.0, 1.0))
            item["wcmp_lock_probability"] = pw
            item["wcmp_status"] = _status_bucket(pw)
        out.append(item)
    return out


def _status_bucket(p: float) -> str:
    """Color hints from simulated probability (not 'clinched' at 100% unless essentially 1)."""
    if p >= 0.97:
        return "clinched"
    if p >= 0.45:
        return "in_range"
    if p >= 0.08:
        return "bubble"
    return "out"


def merge_locks_into_rankings(
    rankings: list[dict],
    lock_info: list[dict],
) -> list[dict]:
    by_team = {x["team_key"]: x for x in lock_info}
    merged = []
    for row in rankings:
        tk = row.get("team_key")
        extra = by_team.get(tk, {})
        merged.append({**row, **extra})
    return merged
