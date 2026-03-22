"""
Expected Points Added (EPA) computation engine — v2.

Key algorithms:
1. Component EPA: Separate auto/teleop/endgame via weighted least squares.
2. Time-decay weighting: exp(-λ * matches_ago) so recent form dominates.
3. Ridge regularization: (AᵀWA + λI)x = AᵀWb + λ·prior centered on mean.
4. Iterative outlier rejection: down-weight high-residual matches (blowouts,
   dead robots) then re-solve.
5. Dead-robot detection: matches where a team's estimated contribution is
   near zero get down-weighted so one bad match doesn't tank a rating.
6. Defense modeling: separate offensive EPA and opponent-impact score by
   tracking how much opponents under-perform when facing each team.
7. Synergy detection: track residual performance for team pairs to capture
   alliance composition effects.
8. Per-team variance: residual variance enables Gaussian win probability.
9. Effective EPA: EPA * consistency * reliability for downstream prediction.
"""

import numpy as np
import logging
from dataclasses import dataclass
from backend.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class MatchRecord:
    match_key: str
    team_keys: list[str]
    score_total: float
    score_auto: float
    score_teleop: float
    score_endgame: float
    match_index: int
    foul_points_received: float = 0.0  # foul points awarded TO this alliance; subtracted for cleaner EPA


@dataclass
class TeamMetrics:
    team_key: str
    epa_total: float = 0.0
    epa_auto: float = 0.0
    epa_teleop: float = 0.0
    epa_endgame: float = 0.0
    epa_defense_adjusted: float = 0.0
    consistency: float = 0.0
    reliability: float = 1.0
    strength_of_schedule: float = 0.0
    matches_played: int = 0
    score_variance: float = 0.0


@dataclass
class EPAResult:
    """Bundle of EPA outputs: per-team metrics + calibration data for the predictor."""
    metrics: dict  # str -> TeamMetrics
    global_residual_variance: float = 92.0  # residual variance from WLS; feeds noise model
    synergy_scores: dict = None  # tuple[str,str] -> float; pair-level residual bonuses

    def __post_init__(self):
        if self.synergy_scores is None:
            self.synergy_scores = {}


def compute_epa(records: list[MatchRecord]) -> EPAResult:
    if not records:
        return EPAResult(metrics={})

    all_teams = sorted({tk for r in records for tk in r.team_keys})
    team_idx = {tk: i for i, tk in enumerate(all_teams)}
    n_teams = len(all_teams)
    n_records = len(records)

    if n_records < 2:
        return EPAResult(metrics={tk: TeamMetrics(team_key=tk, matches_played=1) for tk in all_teams})

    # ── Build system matrix ──
    A = np.zeros((n_records, n_teams))
    b_total = np.zeros(n_records)
    b_auto = np.zeros(n_records)
    b_teleop = np.zeros(n_records)
    b_endgame = np.zeros(n_records)

    for i, rec in enumerate(records):
        for tk in rec.team_keys:
            if tk in team_idx:
                A[i, team_idx[tk]] = 1.0
        # Subtract foul points received for cleaner EPA (fouls inflate score artificially)
        b_total[i] = rec.score_total - rec.foul_points_received
        b_auto[i] = rec.score_auto
        b_teleop[i] = rec.score_teleop
        b_endgame[i] = rec.score_endgame

    # ── Time-decay weights ──
    max_idx = max(r.match_index for r in records)
    weights = np.array([
        settings.epa_time_decay ** (max_idx - r.match_index)
        for r in records
    ])

    # ── Dead-robot / blowout down-weighting ──
    median_score = float(np.median(b_total[b_total > 0])) if np.any(b_total > 0) else 1.0
    for i, rec in enumerate(records):
        if rec.score_total <= settings.epa_dead_robot_threshold:
            weights[i] *= 0.15
        elif median_score > 0 and rec.score_total > median_score * settings.epa_blowout_ratio:
            weights[i] *= 0.4

    # ── Prior means (per-team average contribution) ──
    valid_scores = b_total[b_total > settings.epa_dead_robot_threshold]
    mean_total = float(np.mean(valid_scores)) / 3.0 if len(valid_scores) > 0 else 1.0
    valid_auto = b_auto[b_total > settings.epa_dead_robot_threshold]
    mean_auto = float(np.mean(valid_auto)) / 3.0 if len(valid_auto) > 0 else 0.0
    valid_teleop = b_teleop[b_total > settings.epa_dead_robot_threshold]
    mean_teleop = float(np.mean(valid_teleop)) / 3.0 if len(valid_teleop) > 0 else 0.0
    valid_endgame = b_endgame[b_total > settings.epa_dead_robot_threshold]
    mean_endgame = float(np.mean(valid_endgame)) / 3.0 if len(valid_endgame) > 0 else 0.0

    # ── Solve EPA for each component ──
    epa_total = _solve_wls(A, b_total, weights, n_teams, mean_total)
    epa_auto = _solve_wls(A, b_auto, weights, n_teams, mean_auto)
    epa_teleop = _solve_wls(A, b_teleop, weights, n_teams, mean_teleop)
    epa_endgame = _solve_wls(A, b_endgame, weights, n_teams, mean_endgame)

    # ── Iterative outlier rejection (2 passes) ──
    for _ in range(2):
        residuals = b_total - A @ epa_total
        std_r = np.std(residuals)
        if std_r < 1e-6:
            break
        z_scores = np.abs(residuals) / std_r
        outlier_mask = z_scores > settings.epa_outlier_z_threshold
        if not np.any(outlier_mask):
            break
        adj_w = weights.copy()
        adj_w[outlier_mask] *= 0.05
        epa_total = _solve_wls(A, b_total, adj_w, n_teams, mean_total)
        epa_auto = _solve_wls(A, b_auto, adj_w, n_teams, mean_auto)
        epa_teleop = _solve_wls(A, b_teleop, adj_w, n_teams, mean_teleop)
        epa_endgame = _solve_wls(A, b_endgame, adj_w, n_teams, mean_endgame)
        weights = adj_w

    # ── Global residual variance (feeds noise model in predictor) ──
    predicted = A @ epa_total
    global_residual_var = float(np.var(b_total - predicted))

    # ── Per-team residuals, variance, consistency ──
    team_resids: dict[str, list[float]] = {tk: [] for tk in all_teams}
    team_match_count: dict[str, int] = {tk: 0 for tk in all_teams}

    for i, rec in enumerate(records):
        per_team_resid = (rec.score_total - predicted[i]) / max(len(rec.team_keys), 1)
        for tk in rec.team_keys:
            if tk in team_idx:
                team_resids[tk].append(per_team_resid)
                team_match_count[tk] += 1

    # ── Opponent strengths + defense modeling ──
    team_opp_epas: dict[str, list[float]] = {tk: [] for tk in all_teams}
    team_opp_score_deltas: dict[str, list[float]] = {tk: [] for tk in all_teams}
    by_match: dict[str, list[MatchRecord]] = {}
    for r in records:
        by_match.setdefault(r.match_key, []).append(r)

    for match_key, sides in by_match.items():
        if len(sides) != 2:
            continue
        for si in range(2):
            our = sides[si]
            opp = sides[1 - si]
            opp_epa_sum = sum(epa_total[team_idx[tk]] for tk in opp.team_keys if tk in team_idx)
            opp_predicted = sum(epa_total[team_idx[tk]] for tk in opp.team_keys if tk in team_idx)
            opp_actual = opp.score_total
            opp_delta = opp_actual - opp_predicted
            for tk in our.team_keys:
                if tk in team_opp_epas:
                    team_opp_epas[tk].append(opp_epa_sum)
                    team_opp_score_deltas[tk].append(opp_delta)

    global_avg_epa = float(np.mean(epa_total)) if n_teams > 0 else mean_total

    # ── Synergy: track pair residuals ──
    pair_bonus: dict[tuple[str, str], list[float]] = {}
    for rec in records:
        tks = [tk for tk in rec.team_keys if tk in team_idx]
        if len(tks) < 2:
            continue
        alliance_pred = sum(epa_total[team_idx[tk]] for tk in tks)
        resid = rec.score_total - alliance_pred
        for a_idx in range(len(tks)):
            for b_idx in range(a_idx + 1, len(tks)):
                pair = tuple(sorted([tks[a_idx], tks[b_idx]]))
                pair_bonus.setdefault(pair, []).append(resid / max(len(tks) - 1, 1))

    synergy_scores: dict[str, float] = {}
    for pair, vals in pair_bonus.items():
        if len(vals) >= 2:
            avg = float(np.mean(vals))
            synergy_scores[pair] = avg

    # ── Assemble final metrics ──
    results = {}
    for tk in all_teams:
        idx = team_idx[tk]
        n_played = team_match_count[tk]

        resids = team_resids[tk]
        variance = float(np.var(resids)) if len(resids) > 1 else (mean_total * 0.3) ** 2
        stdev = float(np.std(resids)) if len(resids) > 1 else mean_total * 0.3
        consistency = 1.0 / (1.0 + stdev / max(mean_total, 1.0))

        reliability = 1.0
        if n_played > 0:
            dead_matches = sum(1 for r in resids if (epa_total[idx] + r) < settings.epa_dead_robot_threshold)
            reliability = 1.0 - (dead_matches / n_played)

        opp_strengths = team_opp_epas.get(tk, [])
        sos = float(np.mean(opp_strengths)) if opp_strengths else global_avg_epa

        opp_deltas = team_opp_score_deltas.get(tk, [])
        defense_impact = float(np.mean(opp_deltas)) if opp_deltas else 0.0
        if global_avg_epa > 0 and sos > 0:
            defense_adj = float(epa_total[idx]) * (sos / global_avg_epa) - defense_impact * 0.3
        else:
            defense_adj = float(epa_total[idx])

        results[tk] = TeamMetrics(
            team_key=tk,
            epa_total=float(epa_total[idx]),
            epa_auto=float(epa_auto[idx]),
            epa_teleop=float(epa_teleop[idx]),
            epa_endgame=float(epa_endgame[idx]),
            epa_defense_adjusted=defense_adj,
            consistency=consistency,
            reliability=reliability,
            strength_of_schedule=sos,
            matches_played=n_played,
            score_variance=variance,
        )

    return EPAResult(
        metrics=results,
        global_residual_variance=global_residual_var,
        synergy_scores=synergy_scores,
    )


def _solve_wls(A: np.ndarray, b: np.ndarray, w: np.ndarray,
               n_teams: int, prior_mean: float) -> np.ndarray:
    W = np.diag(w)
    lam = settings.epa_prior_weight * max(prior_mean, 0.1)

    AtWA = A.T @ W @ A + lam * np.eye(n_teams)
    AtWb = A.T @ W @ b + lam * prior_mean * np.ones(n_teams)

    try:
        x = np.linalg.solve(AtWA, AtWb)
    except np.linalg.LinAlgError:
        x = np.linalg.lstsq(AtWA, AtWb, rcond=None)[0]

    return x
