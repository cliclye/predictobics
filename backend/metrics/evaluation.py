"""
Offline evaluation: compare predictions to historical results.

- Walk-forward QM evaluation: EPA is recomputed from matches *before* each match,
  then we predict that match (no future leakage).
- Leaky baseline: uses stored team_event_metrics (faster; optimistic).
- EPA vs TBA ranking: Spearman correlation when TBA rankings are available.
"""

from __future__ import annotations

import logging
import math
from typing import Any, Optional

import numpy as np
from scipy import stats as scipy_stats
from sqlalchemy import select

from backend.database import async_session
from backend.ingestion.tba_client import get_event_rankings
from backend.metrics.epa import MatchRecord, TeamMetrics, compute_epa
from backend.metrics.predictor import _aggregate_alliance, predict_match
from backend.models.orm import Event, Match, MatchAlliance, TeamEventMetrics

logger = logging.getLogger(__name__)


def _brier(probs: list[float], labels: list[int]) -> float:
    return float(np.mean([(p - y) ** 2 for p, y in zip(probs, labels)]))


def _log_loss(probs: list[float], labels: list[int], eps: float = 1e-15) -> float:
    total = 0.0
    for p, y in zip(probs, labels):
        p = min(max(p, eps), 1 - eps)
        total += -(y * math.log(p) + (1 - y) * math.log(1 - p))
    return total / max(len(labels), 1)


def _metrics_map_from_epa(
    epa_results: dict[str, TeamMetrics], event_key: str
) -> dict[tuple[str, str], TeamMetrics]:
    return {(tk, event_key): tm for tk, tm in epa_results.items()}


async def _load_event_qm_context(event_key: str):
    async with async_session() as session:
        mr = await session.execute(
            select(Match)
            .where(Match.event_key == event_key)
            .where(Match.comp_level == "qm")
            .where(Match.red_score >= 0)
            .where(Match.blue_score >= 0)
            .order_by(Match.match_number)
        )
        matches = mr.scalars().all()
        if not matches:
            return None, None
        mkeys = [m.key for m in matches]
        ar = await session.execute(
            select(MatchAlliance).where(MatchAlliance.match_key.in_(mkeys))
        )
        amap: dict[str, dict[str, list[str]]] = {}
        for a in ar.scalars().all():
            amap.setdefault(a.match_key, {}).setdefault(a.alliance, []).append(a.team_key)
    return matches, amap


def _records_for_prefix(
    matches: list, alliance_map: dict[str, dict[str, list[str]]], prefix_len: int
) -> list[MatchRecord]:
    records: list[MatchRecord] = []
    for idx in range(prefix_len):
        m = matches[idx]
        sides = alliance_map.get(m.key, {})
        for color in ("red", "blue"):
            teams = sides.get(color, [])
            if not teams:
                continue
            score = m.red_score if color == "red" else m.blue_score
            auto = m.red_auto_score if color == "red" else m.blue_auto_score
            teleop = m.red_teleop_score if color == "red" else m.blue_teleop_score
            endgame = m.red_endgame_score if color == "red" else m.blue_endgame_score
            foul_recv = (m.red_foul_points if color == "red" else m.blue_foul_points) or 0
            records.append(
                MatchRecord(
                    match_key=m.key,
                    team_keys=teams,
                    score_total=score or 0,
                    score_auto=auto or 0,
                    score_teleop=teleop or 0,
                    score_endgame=endgame or 0,
                    match_index=idx,
                    foul_points_received=foul_recv,
                )
            )
    return records


async def evaluate_event_walk_forward(event_key: str) -> dict[str, Any]:
    """
    For each qual match (after the first), recompute EPA from all *prior* matches
    only, then predict the current match vs actual winner.
    """
    ctx = await _load_event_qm_context(event_key)
    if ctx[0] is None:
        return {"event_key": event_key, "error": "no_qual_matches"}
    matches, alliance_map = ctx

    probs: list[float] = []
    labels: list[int] = []

    for i in range(len(matches)):
        m = matches[i]
        if m.winning_alliance not in ("red", "blue"):
            continue
        if m.red_score == m.blue_score:
            continue

        prior = _records_for_prefix(matches, alliance_map, i)
        if len(prior) < 4:
            continue

        epa_res = compute_epa(prior).metrics
        if len(epa_res) < 4:
            continue

        mm = _metrics_map_from_epa(epa_res, event_key)
        sides = alliance_map.get(m.key, {})
        red_teams = sides.get("red", [])
        blue_teams = sides.get("blue", [])
        if len(red_teams) != 3 or len(blue_teams) != 3:
            continue

        rf = _aggregate_alliance(red_teams, event_key, mm)
        bf = _aggregate_alliance(blue_teams, event_key, mm)
        if rf is None or bf is None:
            continue

        pr = predict_match(rf, bf)
        y = 1 if m.winning_alliance == "red" else 0
        p_red = pr.red_win_prob
        probs.append(p_red)
        labels.append(y)

    if not probs:
        return {
            "event_key": event_key,
            "n_predictions": 0,
            "method": "walk_forward",
        }

    pred_cls = [1 if p >= 0.5 else 0 for p in probs]
    acc = float(np.mean([p == y for p, y in zip(pred_cls, labels)]))
    return {
        "event_key": event_key,
        "method": "walk_forward",
        "n_predictions": len(probs),
        "accuracy": acc,
        "brier": _brier(probs, labels),
        "log_loss": _log_loss(probs, labels),
    }


async def evaluate_event_leaky(event_key: str) -> dict[str, Any]:
    """Uses stored DB metrics (includes future matches — optimistic calibration check)."""
    async with async_session() as session:
        mr = await session.execute(
            select(Match)
            .where(Match.event_key == event_key)
            .where(Match.comp_level == "qm")
            .where(Match.red_score >= 0)
            .where(Match.blue_score >= 0)
            .where(Match.winning_alliance.in_(["red", "blue"]))
        )
        matches = mr.scalars().all()
        if not matches:
            return {"event_key": event_key, "n_predictions": 0, "method": "leaky_metrics"}

        mkeys = [m.key for m in matches]
        ar = await session.execute(
            select(MatchAlliance).where(MatchAlliance.match_key.in_(mkeys))
        )
        amap: dict[str, dict[str, list[str]]] = {}
        for a in ar.scalars().all():
            amap.setdefault(a.match_key, {}).setdefault(a.alliance, []).append(a.team_key)

        met_r = await session.execute(
            select(TeamEventMetrics).where(TeamEventMetrics.event_key == event_key)
        )
        metrics_list = met_r.scalars().all()
        mm = {(m.team_key, event_key): m for m in metrics_list}

    probs: list[float] = []
    labels: list[int] = []

    for m in matches:
        if m.red_score == m.blue_score:
            continue
        sides = amap.get(m.key, {})
        red_teams = sides.get("red", [])
        blue_teams = sides.get("blue", [])
        if len(red_teams) != 3 or len(blue_teams) != 3:
            continue
        rf = _aggregate_alliance(red_teams, event_key, mm)
        bf = _aggregate_alliance(blue_teams, event_key, mm)
        if rf is None or bf is None:
            continue
        pr = predict_match(rf, bf)
        y = 1 if m.winning_alliance == "red" else 0
        probs.append(pr.red_win_prob)
        labels.append(y)

    if not probs:
        return {"event_key": event_key, "n_predictions": 0, "method": "leaky_metrics"}

    pred_cls = [1 if p >= 0.5 else 0 for p in probs]
    acc = float(np.mean([p == y for p, y in zip(pred_cls, labels)]))
    return {
        "event_key": event_key,
        "method": "leaky_metrics",
        "n_predictions": len(probs),
        "accuracy": acc,
        "brier": _brier(probs, labels),
        "log_loss": _log_loss(probs, labels),
    }


async def epa_vs_tba_rank_correlation(event_key: str) -> Optional[dict[str, Any]]:
    """Spearman rho between EPA sort order and official TBA qual rank (if API returns data)."""
    data = await get_event_rankings(event_key)
    if not data or "rankings" not in data:
        return None

    tba_ranks: dict[str, int] = {}
    for row in data.get("rankings") or []:
        tk = row.get("team_key")
        r = row.get("rank")
        if tk and r is not None:
            tba_ranks[str(tk)] = int(r)

    if len(tba_ranks) < 8:
        return None

    async with async_session() as session:
        result = await session.execute(
            select(TeamEventMetrics.team_key, TeamEventMetrics.epa_total)
            .where(TeamEventMetrics.event_key == event_key)
        )
        rows = result.all()

    epa_order = [tk for tk, _ in sorted(rows, key=lambda x: (x[1] or 0), reverse=True)]
    common = [tk for tk in epa_order if tk in tba_ranks]
    if len(common) < 8:
        return None

    epa_pos = [epa_order.index(tk) + 1 for tk in common]
    tba_pos = [tba_ranks[tk] for tk in common]
    rho, pval = scipy_stats.spearmanr(epa_pos, tba_pos)
    return {
        "event_key": event_key,
        "n_teams": len(common),
        "spearman_rho": float(rho) if rho == rho else 0.0,
        "spearman_p": float(pval) if pval == pval else 1.0,
    }


async def evaluate_year(
    year: int,
    max_events: int = 40,
    walk_forward: bool = True,
) -> dict[str, Any]:
    """
    Aggregate metrics over up to `max_events` district/regional events for a season.
    """
    async with async_session() as session:
        r = await session.execute(select(Event.key).where(Event.year == year))
        keys = [row[0] for row in r.fetchall()]

    if not keys:
        return {"year": year, "error": "no_events"}

    rng = np.random.default_rng(42)
    rng.shuffle(keys)
    keys = keys[:max_events]

    wf_n = wf_acc = wf_brier = wf_ll = 0
    lk_n = lk_acc = lk_brier = lk_ll = 0
    spearmans: list[float] = []

    details: list[dict[str, Any]] = []

    for ek in keys:
        try:
            leaky = await evaluate_event_leaky(ek)
            lk_n += leaky.get("n_predictions", 0)
            if leaky.get("n_predictions", 0) > 0:
                lk_acc += leaky["accuracy"] * leaky["n_predictions"]
                lk_brier += leaky["brier"] * leaky["n_predictions"]
                lk_ll += leaky["log_loss"] * leaky["n_predictions"]

            if walk_forward:
                wf = await evaluate_event_walk_forward(ek)
                wf_n += wf.get("n_predictions", 0)
                if wf.get("n_predictions", 0) > 0:
                    wf_acc += wf["accuracy"] * wf["n_predictions"]
                    wf_brier += wf["brier"] * wf["n_predictions"]
                    wf_ll += wf["log_loss"] * wf["n_predictions"]
                details.append({"event": ek, "walk_forward": wf, "leaky": leaky})
            else:
                details.append({"event": ek, "leaky": leaky})

            corr = await epa_vs_tba_rank_correlation(ek)
            if corr and corr.get("spearman_rho") is not None:
                spearmans.append(float(corr["spearman_rho"]))
        except Exception as e:
            logger.warning("eval failed for %s: %s", ek, e)
            continue

    def _avg(acc: float, n: int, brier: float, ll: float) -> dict[str, float]:
        if n == 0:
            return {"n": 0, "accuracy": 0.0, "brier": 0.0, "log_loss": 0.0}
        return {
            "n": float(n),
            "accuracy": acc / n,
            "brier": brier / n,
            "log_loss": ll / n,
        }

    out: dict[str, Any] = {
        "year": year,
        "events_sampled": len(keys),
        "leaky_match_metrics": _avg(lk_acc, int(lk_n), lk_brier, lk_ll),
        "walk_forward_match_metrics": _avg(wf_acc, int(wf_n), wf_brier, wf_ll)
        if walk_forward
        else None,
        "ranking_spearman_mean": float(np.mean(spearmans)) if spearmans else None,
        "ranking_spearman_n_events": len(spearmans),
        "details": details[:15],
    }
    return out
