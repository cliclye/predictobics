from pydantic import BaseModel
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


class IngestionStatus(BaseModel):
    status: str
    message: str
