from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class TeamResponse(BaseModel):
    key: str
    team_number: int
    name: Optional[str] = None
    city: Optional[str] = None
    state_prov: Optional[str] = None
    country: Optional[str] = None
    rookie_year: Optional[int] = None


class TeamMetricsResponse(BaseModel):
    team_key: str
    event_key: str
    year: int
    epa_total: Optional[float] = None
    epa_auto: Optional[float] = None
    epa_teleop: Optional[float] = None
    epa_endgame: Optional[float] = None
    epa_defense_adjusted: Optional[float] = None
    consistency: Optional[float] = None
    reliability: Optional[float] = None
    strength_of_schedule: Optional[float] = None
    matches_played: int = 0


class TeamDetailResponse(BaseModel):
    team: TeamResponse
    metrics: list[TeamMetricsResponse]


class EventResponse(BaseModel):
    key: str
    name: Optional[str] = None
    year: int
    city: Optional[str] = None
    state_prov: Optional[str] = None
    country: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    week: Optional[int] = None


class EventRankingEntry(BaseModel):
    rank: int
    team_key: str
    team_number: int
    team_name: Optional[str] = None
    epa_total: Optional[float] = None
    epa_auto: Optional[float] = None
    epa_teleop: Optional[float] = None
    epa_endgame: Optional[float] = None
    epa_defense_adjusted: Optional[float] = None
    consistency: Optional[float] = None
    reliability: Optional[float] = None
    matches_played: int = 0


class MatchPredictionRequest(BaseModel):
    red_teams: list[str]  # e.g. ["frc254", "frc1678", "frc973"]
    blue_teams: list[str]
    event_key: str


class MatchPredictionResponse(BaseModel):
    red_win_prob: float
    blue_win_prob: float
    red_expected_score: float
    blue_expected_score: float
    model_used: str
    # Component EPA breakdown per alliance (optional — populated when EPA data exists)
    red_auto_epa: Optional[float] = None
    red_teleop_epa: Optional[float] = None
    red_endgame_epa: Optional[float] = None
    blue_auto_epa: Optional[float] = None
    blue_teleop_epa: Optional[float] = None
    blue_endgame_epa: Optional[float] = None
    # Effective EPA (EPA × consistency × reliability) per alliance
    red_effective_epa: Optional[float] = None
    blue_effective_epa: Optional[float] = None
    # Predicted margin (red − blue)
    predicted_margin: Optional[float] = None


class SimulationTeamResult(BaseModel):
    team_key: str
    avg_rank: int
    avg_rp: float
    median_rp: float
    p90_rp: float
    p10_rp: float


class MatchResponse(BaseModel):
    key: str
    comp_level: str
    set_number: int
    match_number: int
    time: Optional[datetime] = None
    red_score: Optional[int] = None
    blue_score: Optional[int] = None
    winning_alliance: Optional[str] = None
    red_teams: list[str] = []
    blue_teams: list[str] = []
    red_predicted_score: Optional[float] = None
    blue_predicted_score: Optional[float] = None
    red_win_prob: Optional[float] = None


class TeamSeasonBundleResponse(BaseModel):
    """Single response for team page: metrics plus all event matches and event metadata (avoids N+1 API calls)."""

    team: TeamResponse
    metrics: list[TeamMetricsResponse]
    event_matches: dict[str, list[MatchResponse]]
    event_infos: dict[str, EventResponse]


class PredictedRankEntry(BaseModel):
    rank: int
    team_key: str
    team_number: int
    team_name: Optional[str] = None
    epa_total: Optional[float] = None
    predicted_rp: float = 0.0
    predicted_record: str = ""
    win_pct: float = 0.0
    # Played qualification record when available (from TBA results in DB)
    actual_qual_record: Optional[str] = None


class PredictedAlliance(BaseModel):
    number: int
    captain: str
    pick1: str
    pick2: str
    captain_num: int = 0
    pick1_num: int = 0
    pick2_num: int = 0
    alliance_epa: float = 0.0


class PlayoffMatch(BaseModel):
    round_name: str
    match_num: int
    red_alliance: int
    blue_alliance: int
    red_win_prob: float
    winner: int


class EventPredictionResponse(BaseModel):
    predicted_rankings: list[PredictedRankEntry]
    predicted_alliances: list[PredictedAlliance]
    playoff_bracket: list[PlayoffMatch]
    predicted_winner: int
    predicted_winner_teams: list[str] = []
    event_year: int = 0
    alliance_skip_first_pick: bool = False
    alliance_selection_note: str = ""
    ranking_method_note: str = ""


class PlayoffPredictionAlliance(BaseModel):
    number: int
    teams: list[str] = []
    team_numbers: list[int] = []
    alliance_epa: float = 0.0


class PlayoffPredictionResponse(BaseModel):
    alliances: list[PlayoffPredictionAlliance]
    playoff_bracket: list[PlayoffMatch]
    predicted_winner: int
    predicted_winner_teams: list[str] = []


class IngestionStatus(BaseModel):
    status: str
    message: str


class BulkIngestRequest(BaseModel):
    """Pre-pull many seasons (events + matches + EPA). Can run a long time."""

    start_year: int = 2002
    end_year: int = Field(default_factory=lambda: datetime.now().year)
    refresh_teams_first: bool = True
    compute_metrics: bool = True
    newest_first: bool = False
    pause_between_years_sec: float = 1.0


class BulkIngestQueued(BaseModel):
    status: str = "started"
    message: str
    start_year: int
    end_year: int


class ServerInfoResponse(BaseModel):
    """Public deployment hints for the SPA (no secrets)."""

    write_secret_required: bool = False
