from pydantic_settings import BaseSettings
from functools import lru_cache
import os


class Settings(BaseSettings):
    tba_api_key: str = ""
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/statfrc"
    database_url_sync: str = ""
    redis_url: str = ""
    tba_base_url: str = "https://www.thebluealliance.com/api/v3"

    epa_time_decay: float = 0.92
    epa_outlier_z_threshold: float = 2.5
    epa_prior_weight: float = 0.08
    epa_dead_robot_threshold: float = 5.0
    epa_blowout_ratio: float = 3.0

    # Match win-probability calibration (tuned vs walk-forward backtests; env override)
    prediction_prob_shrink: float = 0.92
    prediction_z_temperature: float = 1.04
    prediction_ml_blend_weight: float = 0.42
    # Blend sum of per-team defense-adjusted EPA into the Gaussian mean (0 = off).
    # Applies to match win % / score expectations and Monte Carlo event simulation.
    prediction_defense_blend: float = 0.28
    # Default noise variance for Gaussian model; auto-calibrated from EPA residuals when available
    prediction_noise_variance: float = 92.0
    # Continuous reliability variance scaling: variance *= 1 + (1-reliability) * this
    prediction_reliability_variance_scale: float = 1.0
    # Match-count confidence: variance *= 1 + k / matches_played (fewer matches = wider uncertainty)
    prediction_match_count_k: float = 3.0

    # Optional: require this value in X-Bulk-Ingest-Secret header for POST /ingest/bulk
    bulk_ingest_secret: str = ""
    # Optional: if set (or if bulk_ingest_secret is set), all write/admin POSTs require
    # X-Admin-Secret or X-Bulk-Ingest-Secret matching that shared secret.
    admin_api_secret: str = ""

    # Comma-separated allowed browser origins, or "*" for any (default). Prefer
    # listing your Vercel + custom domains in production.
    cors_origins: str = "*"
    # Optional regex (e.g. https://.*\\.vercel\\.app) merged with cors_origins when not "*".
    # Helps Vercel preview URLs without listing every branch.
    cors_origin_regex: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    def get_async_db_url(self) -> str:
        url = self.database_url
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        if "sslmode=" not in url and ("railway" in url or "supabase" in url or "neon" in url):
            sep = "&" if "?" in url else "?"
            url += f"{sep}ssl=require"
        return url


@lru_cache()
def get_settings() -> Settings:
    return Settings()
