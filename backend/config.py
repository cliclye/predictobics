from pydantic_settings import BaseSettings
from functools import lru_cache
import os


class Settings(BaseSettings):
    tba_api_key: str = ""
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/statfrc"
    database_url_sync: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/statfrc"
    redis_url: str = "redis://localhost:6379/0"
    tba_base_url: str = "https://www.thebluealliance.com/api/v3"

    epa_time_decay: float = 0.92
    epa_outlier_z_threshold: float = 2.5
    epa_prior_weight: float = 0.08
    epa_dead_robot_threshold: float = 5.0
    epa_blowout_ratio: float = 3.0

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache()
def get_settings() -> Settings:
    return Settings()
