"""
8-alliance double elimination (official FRC 25+ team events): 13 bracket matches + finals.

Upper R1 (M1–M4): 1v8, 4v5, 2v7, 3v6 (alliance numbers 1–8).
Then M7–M8, M5–M6, M9–M10, M11, M12, M13, then finals (winner of M11 vs winner of last chance).
"""

from __future__ import annotations

import numpy as np
from typing import Any, Callable

from backend.metrics.predictor import build_alliance_features_from_metrics, predict_match


def _series_p_win_bo3(p_game: float) -> float:
    """P(win best-of-3) given P(win one game), same as routes._predict_bo3."""
    p = float(np.clip(p_game, 0.02, 0.98))
    return float(np.clip(p * p + 2 * p * p * (1 - p), 0.01, 0.99))


def make_predict_bo3(
    alliances: list[list[str]],
    metrics_map: dict[str, Any],
) -> Callable[[int, int], float]:
    """Return P(alliance a_idx wins Bo3 vs b_idx), 0-based indices."""

    cache: dict[tuple[int, int], float] = {}

    def _p(a_idx: int, b_idx: int) -> float:
        key = (a_idx, b_idx)
        if key in cache:
            return cache[key]
        t1 = alliances[a_idx] if a_idx < len(alliances) else []
        t2 = alliances[b_idx] if b_idx < len(alliances) else []
        if not t1 and not t2:
            out = 0.5
        elif not t1:
            out = 0.0
        elif not t2:
            out = 1.0
        else:
            f1 = build_alliance_features_from_metrics(t1, metrics_map)
            f2 = build_alliance_features_from_metrics(t2, metrics_map)
            pr = predict_match(f1, f2)
            out = _series_p_win_bo3(pr.red_win_prob)
        cache[key] = out
        return out

    return _p


def _loser(a_idx: int, b_idx: int, winner: int) -> int:
    return b_idx if winner == a_idx else a_idx


def _epa_sum(alliances: list[list[str]], metrics_map: dict[str, Any], a_idx: int) -> float:
    teams = alliances[a_idx] if a_idx < len(alliances) else []
    s = 0.0
    for tk in teams:
        m = metrics_map.get(tk)
        s += float(m.epa_total or 0) if m else 0.0
    return s


def simulate_double_elim_winner(
    alliances: list[list[str]],
    metrics_map: dict[str, Any],
    rng: np.random.Generator,
    predict_bo3: Callable[[int, int], float],
) -> int:
    """
    One tournament simulation. Returns 0-based alliance index of finals winner.
    Alliances list must have length >= 8 (padded with empty slots ok for indices).
    """
    n = len(alliances)
    if n < 8:
        raise ValueError("Need 8 alliance slots for double elim")

    def sim(a: int, b: int) -> int:
        p = predict_bo3(a, b)
        return a if rng.random() < p else b

    # Upper R1 — M1..M4: (1v8), (4v5), (2v7), (3v6) → 0-based (0,7), (3,4), (1,6), (2,5)
    w1 = sim(0, 7)
    w2 = sim(3, 4)
    w3 = sim(1, 6)
    w4 = sim(2, 5)
    l1 = _loser(0, 7, w1)
    l2 = _loser(3, 4, w2)
    l3 = _loser(1, 6, w3)
    l4 = _loser(2, 5, w4)

    # Lower R1 — M5, M6
    w5 = sim(l1, l2)
    w6 = sim(l3, l4)

    # Upper R2 — M7, M8
    w7 = sim(w1, w2)
    w8 = sim(w3, w4)
    l7 = _loser(w1, w2, w7)
    l8 = _loser(w3, w4, w8)

    # Lower R2 — M9 (L7 vs W6), M10 (L8 vs W5)
    w9 = sim(l7, w6)
    w10 = sim(l8, w5)

    # Upper final — M11
    w11 = sim(w7, w8)
    l11 = _loser(w7, w8, w11)

    # Lower — M12 (W9 vs W10)
    w12 = sim(w9, w10)

    # M13 — L11 vs W12
    w13 = sim(l11, w12)

    # Finals — W11 vs W13 (upper bracket winner vs lower bracket winner)
    return sim(w11, w13)


def monte_carlo_champion_1based(
    alliances: list[list[str]],
    metrics_map: dict[str, Any],
    predict_bo3: Callable[[int, int], float],
    n_sims: int = 1800,
    seed: int = 42,
) -> int:
    """Return 1-based alliance number most likely to win the tournament."""
    rng = np.random.default_rng(seed)
    counts = [0] * max(len(alliances), 8)
    for _ in range(n_sims):
        w0 = simulate_double_elim_winner(alliances, metrics_map, rng, predict_bo3)
        counts[w0] += 1
    return int(np.argmax(counts)) + 1


def build_double_elim_bracket_display(
    alliances: list[list[str]],
    metrics_map: dict[str, Any],
    predict_bo3: Callable[[int, int], float],
) -> list[dict[str, Any]]:
    """
    Deterministic bracket: stronger EPA sum advances. Each match gets Bo3 win prob for that pairing.
    Returns dicts suitable for PlayoffMatch.
    """
    n = len(alliances)
    if n < 8:
        return []

    def pick(a: int, b: int) -> int:
        ta = alliances[a] if a < len(alliances) else []
        tb = alliances[b] if b < len(alliances) else []
        if not ta and not tb:
            return min(a, b)
        if not ta:
            return b
        if not tb:
            return a
        ea = _epa_sum(alliances, metrics_map, a)
        eb = _epa_sum(alliances, metrics_map, b)
        return a if ea >= eb else b

    def match_row(
        mn: int,
        rnd: str,
        a: int,
        b: int,
    ) -> dict[str, Any]:
        p = predict_bo3(a, b)
        fav = a if p >= 0.5 else b
        return {
            "round_name": rnd,
            "match_num": mn,
            "red_alliance": a + 1,
            "blue_alliance": b + 1,
            "red_win_prob": round(float(p), 3),
            "winner": fav + 1,
        }

    bracket: list[dict[str, Any]] = []

    # M1–M4
    bracket.append(match_row(1, "Upper Round 1", 0, 7))
    bracket.append(match_row(2, "Upper Round 1", 3, 4))
    bracket.append(match_row(3, "Upper Round 1", 1, 6))
    bracket.append(match_row(4, "Upper Round 1", 2, 5))

    w1 = pick(0, 7)
    w2 = pick(3, 4)
    w3 = pick(1, 6)
    w4 = pick(2, 5)
    l1 = _loser(0, 7, w1)
    l2 = _loser(3, 4, w2)
    l3 = _loser(1, 6, w3)
    l4 = _loser(2, 5, w4)

    bracket.append(match_row(5, "Lower Round 1", l1, l2))
    bracket.append(match_row(6, "Lower Round 1", l3, l4))

    w5 = pick(l1, l2)
    w6 = pick(l3, l4)

    bracket.append(match_row(7, "Upper Round 2", w1, w2))
    bracket.append(match_row(8, "Upper Round 2", w3, w4))

    w7 = pick(w1, w2)
    w8 = pick(w3, w4)
    l7 = _loser(w1, w2, w7)
    l8 = _loser(w3, w4, w8)

    bracket.append(match_row(9, "Lower Round 2", l7, w6))
    bracket.append(match_row(10, "Lower Round 2", l8, w5))

    w9 = pick(l7, w6)
    w10 = pick(l8, w5)

    bracket.append(match_row(11, "Upper Bracket Final", w7, w8))

    w11 = pick(w7, w8)
    l11 = _loser(w7, w8, w11)

    bracket.append(match_row(12, "Lower Bracket Final", w9, w10))

    w12 = pick(w9, w10)

    bracket.append(match_row(13, "Lower Bracket Final", l11, w12))

    w13 = pick(l11, w12)

    bracket.append(match_row(14, "Finals", w11, w13))

    return bracket
