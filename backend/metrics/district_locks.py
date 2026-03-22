"""
District Championship (DCMP) lock estimates from TBA district rankings.

Uses Monte Carlo over remaining district point opportunities to estimate
P(rank <= DCMP cutoff). Rules vary by year; DCMP capacity is configurable.
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


def estimate_lock_probabilities(
    rankings: list[dict],
    dcmp_spots: int,
    n_simulations: int = 8000,
    seed: int = 42,
) -> list[dict]:
    """
    Monte Carlo: simulate remaining district qual points with correlated uncertainty
    (district-wide shocks) and heavy-tailed per-event draws — top teams are not all ~100%
    while meaningful points remain on the calendar.
    """
    if not rankings or dcmp_spots < 1:
        return []

    rng = np.random.default_rng(seed)
    n_teams = len(rankings)

    base = np.zeros(n_teams, dtype=float)
    slots_left = np.zeros(n_teams, dtype=int)

    for i, row in enumerate(rankings):
        base[i] = _row_points(row)
        used, _ = _team_event_slots_used(row)
        slots_left[i] = max(0, 2 - min(used, 2))

    probs = np.zeros(n_teams)

    for _ in range(n_simulations):
        sim = base.copy()
        global_shift = float(rng.normal(0.0, 5.5))
        season_scale = float(rng.lognormal(0.0, 0.18))

        for i in range(n_teams):
            if slots_left[i] <= 0:
                continue
            sim[i] += global_shift
            for _ in range(int(slots_left[i])):
                sim[i] += _future_event_draw(rng) * season_scale

        jitter = rng.random(n_teams) * 1e-5
        order = np.argsort(-(sim + jitter))
        inv_rank = np.empty_like(order)
        inv_rank[order] = np.arange(n_teams)
        in_top = inv_rank < dcmp_spots
        probs += in_top.astype(float)

    probs /= float(n_simulations)

    out = []
    for i, row in enumerate(rankings):
        tk = row.get("team_key", "")
        p = float(np.clip(probs[i], 0.0, 1.0))
        out.append(
            {
                "team_key": tk,
                "lock_probability": p,
                "status": _status_bucket(p),
            }
        )
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
