"""
Match prediction engine — v2.

Tier 1 — Gaussian Analytical (always available):
    effective_EPA = EPA * consistency * reliability
    Each alliance score ~ N(Σ effective_EPA, Σ variance + noise)
    P(red wins) = Φ((μ_r - μ_b) / √(σ²_r + σ²_b))
    Noise variance auto-calibrated from data.

Tier 2 — ML ensemble (when trained):
    GradientBoosting (sklearn) with 30+ features including:
      - Per-component EPA (auto/teleop/endgame) and gaps
      - Consistency, reliability, strength of schedule
      - Effective EPA (EPA * consistency * reliability)
      - Alliance spread (stdev), max/min team EPA
      - Score variance per alliance
    Falls back to analytical if model load fails.

Monte Carlo event simulation using per-team distributions.
"""

import numpy as np
import pickle
import logging
from pathlib import Path
from dataclasses import dataclass
from typing import Optional
from scipy import stats

from backend.config import get_settings

logger = logging.getLogger(__name__)

MODEL_PATH = Path(__file__).parent / "trained_model.pkl"

# Calibrated noise variance; updated from EPA residuals via set_noise_variance()
_calibrated_noise_variance: Optional[float] = None


def get_noise_variance() -> float:
    """Return calibrated noise variance if available, else config default."""
    if _calibrated_noise_variance is not None:
        return _calibrated_noise_variance
    return get_settings().prediction_noise_variance


def set_noise_variance(val: float):
    """Called by compute.py after EPA to feed data-driven noise into the predictor."""
    global _calibrated_noise_variance
    _calibrated_noise_variance = max(val, 10.0)  # floor to prevent degenerate values


@dataclass
class PredictionResult:
    red_win_prob: float
    blue_win_prob: float
    red_expected_score: float
    blue_expected_score: float
    model_used: str


@dataclass
class AllianceFeatures:
    total_epa: float
    auto_epa: float
    teleop_epa: float
    endgame_epa: float
    avg_consistency: float
    avg_reliability: float
    avg_sos: float
    epa_stdev: float
    total_variance: float = 0.0
    effective_epa: float = 0.0
    max_epa: float = 0.0
    min_epa: float = 0.0
    # Sum of per-team defense-adjusted EPA (from compute_epa); used for mean blend
    defense_adjusted_epa: float = 0.0
    avg_matches_played: float = 0.0
    synergy_bonus: float = 0.0


def build_alliance_features_from_metrics(
    team_keys: list[str],
    metrics: dict,
    synergy: Optional[dict] = None,
) -> AllianceFeatures:
    """
    Build alliance features from a team_key -> TeamEventMetrics map (same math as DB path).
    Per-team effective EPA = sum_i (epa_i * consistency_i * reliability_i), not
    (sum epa) * avg(c) * avg(r), which better separates carry vs inconsistent partners.
    """
    epas = []
    autos = []
    teleops = []
    endgames = []
    consistencies = []
    reliabilities = []
    soss = []
    variances = []
    effective_terms = []
    defense_terms = []
    match_counts = []

    for tk in team_keys:
        m = metrics.get(tk)
        if m:
            e = m.epa_total or 0
            c = m.consistency if m.consistency is not None else 0.5
            r = m.reliability if m.reliability is not None else 1.0
            epas.append(e)
            autos.append(m.epa_auto or 0)
            teleops.append(m.epa_teleop or 0)
            endgames.append(m.epa_endgame or 0)
            consistencies.append(c)
            reliabilities.append(r)
            soss.append(m.strength_of_schedule or 0)
            variances.append(m.score_variance or 0)
            effective_terms.append(e * c * r)
            da = getattr(m, "epa_defense_adjusted", None)
            defense_terms.append(float(da) if da is not None else e)
            match_counts.append(getattr(m, "matches_played", 0) or 0)
        else:
            epas.append(0)
            autos.append(0)
            teleops.append(0)
            endgames.append(0)
            consistencies.append(0.5)
            reliabilities.append(1.0)
            soss.append(0)
            variances.append(100.0)
            effective_terms.append(0.0)
            defense_terms.append(0.0)
            match_counts.append(0)

    raw_sum = sum(epas)
    avg_c = float(np.mean(consistencies))
    avg_r = float(np.mean(reliabilities))
    effective_epa = float(sum(effective_terms))

    # Synergy: sum pair bonuses for teams on this alliance
    syn_bonus = 0.0
    if synergy:
        tks = [tk for tk in team_keys if tk in metrics]
        for i in range(len(tks)):
            for j in range(i + 1, len(tks)):
                pair = tuple(sorted([tks[i], tks[j]]))
                syn_bonus += synergy.get(pair, 0.0)

    return AllianceFeatures(
        total_epa=raw_sum,
        auto_epa=sum(autos),
        teleop_epa=sum(teleops),
        endgame_epa=sum(endgames),
        avg_consistency=avg_c,
        avg_reliability=avg_r,
        avg_sos=float(np.mean(soss)),
        epa_stdev=float(np.std(epas)) if epas else 0.0,
        total_variance=sum(variances),
        effective_epa=effective_epa,
        max_epa=max(epas) if epas else 0,
        min_epa=min(epas) if epas else 0,
        defense_adjusted_epa=float(sum(defense_terms)),
        avg_matches_played=float(np.mean(match_counts)) if match_counts else 0.0,
        synergy_bonus=syn_bonus,
    )


def _calibrate_win_prob(p: float) -> float:
    """Shrink extreme probabilities toward 0.5 (better Brier on held-out matches)."""
    s = get_settings().prediction_prob_shrink
    p = 0.5 + (p - 0.5) * s
    return float(np.clip(p, 0.02, 0.98))


def _blended_match_mean(alliance: AllianceFeatures) -> float:
    """Gaussian mean for alliance score expectation used in win-probability z-score."""
    mu_eff = alliance.effective_epa if alliance.effective_epa > 0 else alliance.total_epa
    md = alliance.defense_adjusted_epa
    w = float(get_settings().prediction_defense_blend)
    if md > 0 and w > 0:
        base = float((1.0 - w) * mu_eff + w * md)
    else:
        base = float(mu_eff)
    return base + alliance.synergy_bonus


def predict_match(red: AllianceFeatures, blue: AllianceFeatures) -> PredictionResult:
    ana = _predict_analytical(red, blue)
    model = _load_model()
    if model is not None:
        ml = _predict_ml(model, red, blue)
        w = get_settings().prediction_ml_blend_weight
        p_red = w * ml.red_win_prob + (1.0 - w) * ana.red_win_prob
        p_red = _calibrate_win_prob(p_red)
        return PredictionResult(
            red_win_prob=p_red,
            blue_win_prob=1.0 - p_red,
            red_expected_score=ana.red_expected_score,
            blue_expected_score=ana.blue_expected_score,
            model_used="blend_ml_analytical",
        )
    p_red = _calibrate_win_prob(ana.red_win_prob)
    return PredictionResult(
        red_win_prob=p_red,
        blue_win_prob=1.0 - p_red,
        red_expected_score=ana.red_expected_score,
        blue_expected_score=ana.blue_expected_score,
        model_used=ana.model_used,
    )


def _predict_analytical(red: AllianceFeatures, blue: AllianceFeatures) -> PredictionResult:
    mu_r = _blended_match_mean(red)
    mu_b = _blended_match_mean(blue)

    settings = get_settings()
    sigma2_r = red.total_variance + get_noise_variance()
    sigma2_b = blue.total_variance + get_noise_variance()

    # Continuous per-alliance reliability scaling (replaces binary 0.5 threshold)
    rel_scale = settings.prediction_reliability_variance_scale
    sigma2_r *= 1.0 + (1.0 - red.avg_reliability) * rel_scale
    sigma2_b *= 1.0 + (1.0 - blue.avg_reliability) * rel_scale

    # Match-count confidence: fewer matches = higher epistemic uncertainty
    k = settings.prediction_match_count_k
    if red.avg_matches_played > 0:
        sigma2_r *= 1.0 + k / red.avg_matches_played
    if blue.avg_matches_played > 0:
        sigma2_b *= 1.0 + k / blue.avg_matches_played

    combined_sigma = np.sqrt(sigma2_r + sigma2_b)
    if combined_sigma < 1e-6:
        combined_sigma = 12.0

    z = (mu_r - mu_b) / combined_sigma
    z /= max(get_settings().prediction_z_temperature, 1e-6)
    red_win_prob = float(stats.norm.cdf(z))
    red_win_prob = np.clip(red_win_prob, 0.01, 0.99)

    # Expected alliance totals match the same means as the win-probability model
    exp_r = _blended_match_mean(red)
    exp_b = _blended_match_mean(blue)

    return PredictionResult(
        red_win_prob=float(red_win_prob),
        blue_win_prob=float(1.0 - red_win_prob),
        red_expected_score=exp_r,
        blue_expected_score=exp_b,
        model_used="analytical",
    )


def _predict_ml(model, red: AllianceFeatures, blue: AllianceFeatures) -> PredictionResult:
    features = _build_feature_vector(red, blue)
    X = np.array([features])

    try:
        # Graceful fallback if model was trained on a different feature count
        expected = getattr(model, "n_features_in_", None)
        if expected is not None and expected != len(features):
            logger.warning("Model expects %d features, got %d — falling back to analytical",
                           expected, len(features))
            return _predict_analytical(red, blue)
        prob = model.predict_proba(X)[0]
        red_win_prob = float(prob[1])
    except Exception:
        return _predict_analytical(red, blue)

    exp_r = _blended_match_mean(red)
    exp_b = _blended_match_mean(blue)

    return PredictionResult(
        red_win_prob=red_win_prob,
        blue_win_prob=1.0 - red_win_prob,
        red_expected_score=exp_r,
        blue_expected_score=exp_b,
        model_used="ml_ensemble",
    )


def _build_feature_vector(red: AllianceFeatures, blue: AllianceFeatures) -> list[float]:
    r_eff = red.effective_epa if red.effective_epa > 0 else red.total_epa
    b_eff = blue.effective_epa if blue.effective_epa > 0 else blue.total_epa
    return [
        red.total_epa, blue.total_epa,
        r_eff, b_eff,
        red.auto_epa, blue.auto_epa,
        red.teleop_epa, blue.teleop_epa,
        red.endgame_epa, blue.endgame_epa,
        red.avg_consistency, blue.avg_consistency,
        red.avg_reliability, blue.avg_reliability,
        red.avg_sos, blue.avg_sos,
        red.epa_stdev, blue.epa_stdev,
        red.total_variance, blue.total_variance,
        red.max_epa, blue.max_epa,
        red.min_epa, blue.min_epa,
        # Gaps
        red.total_epa - blue.total_epa,
        r_eff - b_eff,
        red.auto_epa - blue.auto_epa,
        red.teleop_epa - blue.teleop_epa,
        red.endgame_epa - blue.endgame_epa,
        red.avg_consistency - blue.avg_consistency,
        red.avg_reliability - blue.avg_reliability,
        # Derived
        np.sqrt(red.total_variance + get_noise_variance()),
        np.sqrt(blue.total_variance + get_noise_variance()),
        red.max_epa - red.min_epa,
        blue.max_epa - blue.min_epa,
        # Defense-adjusted EPA (raw + gap)
        red.defense_adjusted_epa, blue.defense_adjusted_epa,
        red.defense_adjusted_epa - blue.defense_adjusted_epa,
        # Match experience
        red.avg_matches_played, blue.avg_matches_played,
        # EPA component ratios (game-strategy signal)
        red.auto_epa / max(red.total_epa, 1.0),
        blue.auto_epa / max(blue.total_epa, 1.0),
        # SoS gap
        red.avg_sos - blue.avg_sos,
    ]


def _load_model():
    if MODEL_PATH.exists():
        try:
            with open(MODEL_PATH, "rb") as f:
                return pickle.load(f)
        except Exception as e:
            logger.warning(f"Failed to load model: {e}")
    return None


# ──────────────────────────── Training ────────────────────────────

async def train_model(year: int):
    """
    Train a GradientBoosting classifier (sklearn) on historical matches.
    Falls back from XGBoost to sklearn if xgboost isn't available.
    Uses data from (year-2) through (year).
    """
    from sqlalchemy import select
    from backend.database import async_session
    from backend.models.orm import Match, MatchAlliance, TeamEventMetrics

    years_to_use = [y for y in range(year - 2, year + 1) if y >= 2002]

    async with async_session() as session:
        metrics_result = await session.execute(
            select(TeamEventMetrics).where(TeamEventMetrics.year.in_(years_to_use))
        )
        all_metrics = {
            (m.team_key, m.event_key): m
            for m in metrics_result.scalars().all()
        }

        all_matches = []
        for y in years_to_use:
            matches_result = await session.execute(
                select(Match)
                .where(Match.key.like(f"{y}%"))
                .where(Match.comp_level == "qm")
                .where(Match.red_score >= 0)
                .where(Match.winning_alliance.in_(["red", "blue"]))
            )
            all_matches.extend(matches_result.scalars().all())

        alliances = []
        match_keys = [m.key for m in all_matches]
        batch_size = 10000
        for i in range(0, len(match_keys), batch_size):
            batch = match_keys[i:i + batch_size]
            result = await session.execute(
                select(MatchAlliance).where(MatchAlliance.match_key.in_(batch))
            )
            alliances.extend(result.scalars().all())

    alliance_map: dict[str, dict[str, list[str]]] = {}
    for a in alliances:
        alliance_map.setdefault(a.match_key, {}).setdefault(a.alliance, []).append(a.team_key)

    X_list = []
    y_list = []

    for match in all_matches:
        sides = alliance_map.get(match.key, {})
        event_key = match.event_key

        red_teams = sides.get("red", [])
        blue_teams = sides.get("blue", [])
        if len(red_teams) != 3 or len(blue_teams) != 3:
            continue

        red_feat = _aggregate_alliance(red_teams, event_key, all_metrics)
        blue_feat = _aggregate_alliance(blue_teams, event_key, all_metrics)
        if red_feat is None or blue_feat is None:
            continue

        features = _build_feature_vector(red_feat, blue_feat)
        label = 1 if match.winning_alliance == "red" else 0

        X_list.append(features)
        y_list.append(label)

    if len(X_list) < 100:
        logger.warning(f"Only {len(X_list)} samples — too few to train reliably")
        return

    X = np.array(X_list)
    y = np.array(y_list)

    model = _train_sklearn(X, y)
    if model is None:
        logger.error("Training failed")
        return

    with open(MODEL_PATH, "wb") as f:
        pickle.dump(model, f)

    logger.info(f"Trained model on {len(X_list)} matches across years {years_to_use}")


def _train_sklearn(X, y):
    try:
        from xgboost import XGBClassifier
        model = XGBClassifier(
            n_estimators=280, max_depth=4, learning_rate=0.035,
            subsample=0.85, colsample_bytree=0.85, min_child_weight=8,
            reg_alpha=0.15, reg_lambda=1.2, eval_metric="logloss",
        )
        model.fit(X, y)
        logger.info("Trained XGBoost model")
        return model
    except Exception as e:
        logger.warning(f"XGBoost unavailable ({e}), falling back to sklearn GradientBoosting")

    from sklearn.ensemble import GradientBoostingClassifier
    model = GradientBoostingClassifier(
        n_estimators=280, max_depth=4, learning_rate=0.05,
        subsample=0.8, min_samples_leaf=14, max_features=0.75,
    )
    model.fit(X, y)
    logger.info("Trained sklearn GradientBoosting model")
    return model


def _aggregate_alliance(team_keys: list[str], event_key: str,
                         metrics: dict) -> Optional[AllianceFeatures]:
    epas = []
    autos = []
    teleops = []
    endgames = []
    consistencies = []
    reliabilities = []
    soss = []
    variances = []
    match_counts = []

    for tk in team_keys:
        m = metrics.get((tk, event_key))
        if m is None:
            return None
        epas.append(m.epa_total or 0)
        autos.append(m.epa_auto or 0)
        teleops.append(m.epa_teleop or 0)
        endgames.append(m.epa_endgame or 0)
        consistencies.append(m.consistency or 0)
        reliabilities.append(m.reliability or 1)
        soss.append(m.strength_of_schedule or 0)
        variances.append(m.score_variance or 0)
        match_counts.append(getattr(m, "matches_played", 0) or 0)

    raw_sum = sum(epas)
    avg_c = float(np.mean(consistencies))
    avg_r = float(np.mean(reliabilities))

    eff_terms = []
    def_terms = []
    for tk in team_keys:
        m = metrics.get((tk, event_key))
        if m is None:
            continue
        e = m.epa_total or 0
        c = m.consistency if m.consistency is not None else 0.5
        r = m.reliability if m.reliability is not None else 1.0
        eff_terms.append(e * c * r)
        da = getattr(m, "epa_defense_adjusted", None)
        def_terms.append(float(da) if da is not None else e)

    return AllianceFeatures(
        total_epa=raw_sum,
        auto_epa=sum(autos),
        teleop_epa=sum(teleops),
        endgame_epa=sum(endgames),
        avg_consistency=avg_c,
        avg_reliability=avg_r,
        avg_sos=float(np.mean(soss)),
        epa_stdev=float(np.std(epas)),
        total_variance=sum(variances),
        effective_epa=float(sum(eff_terms)) if eff_terms else raw_sum * avg_c * avg_r,
        max_epa=max(epas),
        min_epa=min(epas),
        defense_adjusted_epa=float(sum(def_terms)) if def_terms else 0.0,
        avg_matches_played=float(np.mean(match_counts)) if match_counts else 0.0,
    )


# ──────────────────── Monte Carlo Event Simulation ────────────────────


def _epa_only_ranking_simulation(
    metrics: dict,
    team_keys: list[str],
    n_simulations: int,
) -> dict[str, dict]:
    """
    When qual matches aren't linked in DB or MC yields flat RP, rank teams by
    noisy effective-EPA draws so predicted orderings still work.
    """
    sim_results: dict[str, list[float]] = {tk: [] for tk in team_keys}
    for _ in range(n_simulations):
        for tk in team_keys:
            m = metrics.get(tk)
            if not m:
                sim_results[tk].append(0.0)
                continue
            solo = build_alliance_features_from_metrics([tk], {tk: m})
            mu = _blended_match_mean(solo)
            sigma = float(np.sqrt(max(m.score_variance or 0, 0) + 25.0))
            if sigma < 1e-3:
                sigma = 12.0
            sim_results[tk].append(mu + float(np.random.normal(0, sigma)))

    output: dict[str, dict] = {}
    for tk in team_keys:
        scores = sim_results[tk]
        output[tk] = {
            "avg_rp": float(np.mean(scores)),
            "median_rp": float(np.median(scores)),
            "p90_rp": float(np.percentile(scores, 90)),
            "p10_rp": float(np.percentile(scores, 10)),
        }
    sorted_teams = sorted(output.keys(), key=lambda t: output[t]["avg_rp"], reverse=True)
    for rank, tk in enumerate(sorted_teams, 1):
        output[tk]["avg_rank"] = rank
    return output


async def simulate_event(event_key: str, n_simulations: int = 1000) -> dict[str, dict]:
    from sqlalchemy import select
    from backend.database import async_session
    from backend.models.orm import Match, MatchAlliance, TeamEventMetrics

    async with async_session() as session:
        metrics_result = await session.execute(
            select(TeamEventMetrics).where(TeamEventMetrics.event_key == event_key)
        )
        metrics = {m.team_key: m for m in metrics_result.scalars().all()}

        matches_result = await session.execute(
            select(Match)
            .where(Match.event_key == event_key)
            .where(Match.comp_level == "qm")
            .order_by(Match.match_number)
        )
        matches = matches_result.scalars().all()

        match_keys = [m.key for m in matches]
        if match_keys:
            alliances_result = await session.execute(
                select(MatchAlliance).where(MatchAlliance.match_key.in_(match_keys))
            )
            alliances_list = alliances_result.scalars().all()
        else:
            alliances_list = []

    alliance_map: dict[str, dict[str, list[str]]] = {}
    for a in alliances_list:
        alliance_map.setdefault(a.match_key, {}).setdefault(a.alliance, []).append(a.team_key)

    unplayed = [m for m in matches if m.winning_alliance is None or m.winning_alliance == ""]
    played = [m for m in matches if m.winning_alliance and m.winning_alliance != ""]

    all_teams: set[str] = set()
    for sides in alliance_map.values():
        for team_list in sides.values():
            all_teams.update(team_list)

    # If QM rows exist but alliance rows failed to load, or schedule not ingested yet,
    # still predict from every team that has EPA metrics for this event.
    if not all_teams and metrics:
        all_teams = set(metrics.keys())

    if not all_teams:
        return {}

    base_rp: dict[str, float] = {tk: 0.0 for tk in all_teams}
    for m in played:
        sides = alliance_map.get(m.key, {})
        winner = m.winning_alliance
        for color in ("red", "blue"):
            rp = 2.0 if color == winner else (1.0 if winner == "" else 0.0)
            for tk in sides.get(color, []):
                base_rp[tk] += rp

    sim_results: dict[str, list[float]] = {tk: [] for tk in all_teams}

    for _ in range(n_simulations):
        rp = dict(base_rp)
        for m in unplayed:
            sides = alliance_map.get(m.key, {})
            red_teams = sides.get("red", [])
            blue_teams = sides.get("blue", [])

            red_feat = build_alliance_features_from_metrics(red_teams, metrics)
            blue_feat = build_alliance_features_from_metrics(blue_teams, metrics)

            mu_r = _blended_match_mean(red_feat)
            mu_b = _blended_match_mean(blue_feat)

            r_var = red_feat.total_variance
            b_var = blue_feat.total_variance
            sigma_r = float(np.sqrt(max(r_var, 0) + get_noise_variance()))
            sigma_b = float(np.sqrt(max(b_var, 0) + get_noise_variance()))
            if sigma_r < 1e-6:
                sigma_r = 12.0
            if sigma_b < 1e-6:
                sigma_b = 12.0

            red_score = float(np.random.normal(mu_r, sigma_r))
            blue_score = float(np.random.normal(mu_b, sigma_b))

            if red_score > blue_score:
                for tk in red_teams:
                    rp[tk] = rp.get(tk, 0) + 2.0
            elif blue_score > red_score:
                for tk in blue_teams:
                    rp[tk] = rp.get(tk, 0) + 2.0
            else:
                # Tie: both alliances receive 1 RP
                for tk in red_teams:
                    rp[tk] = rp.get(tk, 0) + 1.0
                for tk in blue_teams:
                    rp[tk] = rp.get(tk, 0) + 1.0

        for tk in all_teams:
            sim_results[tk].append(rp.get(tk, 0))

    output: dict[str, dict] = {}
    for tk in all_teams:
        scores = sim_results[tk]
        output[tk] = {
            "avg_rp": float(np.mean(scores)),
            "median_rp": float(np.median(scores)),
            "p90_rp": float(np.percentile(scores, 90)),
            "p10_rp": float(np.percentile(scores, 10)),
        }

    # Degenerate: no RP variance (e.g. missing alliance data on all unplayed matches).
    if len(output) > 1:
        vals = [v["avg_rp"] for v in output.values()]
        if float(np.std(vals)) < 1e-6:
            output = _epa_only_ranking_simulation(metrics, list(all_teams), n_simulations)

    sorted_teams = sorted(output.keys(), key=lambda t: output[t]["avg_rp"], reverse=True)
    for rank, tk in enumerate(sorted_teams, 1):
        output[tk]["avg_rank"] = rank

    return output
