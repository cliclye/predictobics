"""
SQLAlchemy ORM models for the FRC analytics database.

Schema design rationale:
- Teams, Events, Matches are normalized entities matching TBA's data model.
- MatchAlliance is a junction table linking matches to the 3 teams per alliance,
  enabling the linear-algebra approach to EPA (each row = one team's participation).
- TeamEventMetrics stores precomputed per-team-per-event statistics to avoid
  recomputing EPA on every API request.
"""

from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Index,
    UniqueConstraint, Text, JSON
)
from sqlalchemy.orm import relationship
from backend.database import Base
from datetime import datetime


class Team(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(10), unique=True, nullable=False, index=True)  # e.g. "frc254"
    team_number = Column(Integer, nullable=False, index=True)
    name = Column(String(255))
    city = Column(String(100))
    state_prov = Column(String(100))
    country = Column(String(100))
    rookie_year = Column(Integer)

    event_metrics = relationship("TeamEventMetrics", back_populates="team")


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(20), unique=True, nullable=False, index=True)  # e.g. "2024casj"
    name = Column(String(255))
    event_type = Column(Integer)
    year = Column(Integer, nullable=False, index=True)
    city = Column(String(100))
    state_prov = Column(String(100))
    country = Column(String(100))
    start_date = Column(DateTime)
    end_date = Column(DateTime)
    week = Column(Integer)

    matches = relationship("Match", back_populates="event")
    team_metrics = relationship("TeamEventMetrics", back_populates="event")


class Match(Base):
    __tablename__ = "matches"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(40), unique=True, nullable=False, index=True)  # e.g. "2024casj_qm1"
    event_key = Column(String(20), ForeignKey("events.key"), nullable=False, index=True)
    comp_level = Column(String(5), nullable=False)  # qm, ef, qf, sf, f
    set_number = Column(Integer, nullable=False)
    match_number = Column(Integer, nullable=False)
    time = Column(DateTime)

    red_score = Column(Integer)
    blue_score = Column(Integer)
    red_auto_score = Column(Integer)
    blue_auto_score = Column(Integer)
    red_teleop_score = Column(Integer)
    blue_teleop_score = Column(Integer)
    red_endgame_score = Column(Integer)
    blue_endgame_score = Column(Integer)
    red_foul_points = Column(Integer, default=0)
    blue_foul_points = Column(Integer, default=0)

    score_breakdown = Column(JSON)
    winning_alliance = Column(String(5))

    event = relationship("Event", back_populates="matches")
    alliances = relationship("MatchAlliance", back_populates="match")

    __table_args__ = (
        Index("ix_matches_event_comp", "event_key", "comp_level"),
    )


class MatchAlliance(Base):
    """Junction table: one row per team per match."""
    __tablename__ = "match_alliances"

    id = Column(Integer, primary_key=True, autoincrement=True)
    match_key = Column(String(40), ForeignKey("matches.key"), nullable=False, index=True)
    team_key = Column(String(10), nullable=False, index=True)
    alliance = Column(String(5), nullable=False)  # "red" or "blue"
    position = Column(Integer)  # 0, 1, 2

    match = relationship("Match", back_populates="alliances")

    __table_args__ = (
        UniqueConstraint("match_key", "team_key", name="uq_match_team"),
    )


class TeamEventMetrics(Base):
    """Precomputed metrics for a team at a specific event."""
    __tablename__ = "team_event_metrics"

    id = Column(Integer, primary_key=True, autoincrement=True)
    team_key = Column(String(10), ForeignKey("teams.key"), nullable=False, index=True)
    event_key = Column(String(20), ForeignKey("events.key"), nullable=False, index=True)
    year = Column(Integer, nullable=False, index=True)

    epa_total = Column(Float)
    epa_auto = Column(Float)
    epa_teleop = Column(Float)
    epa_endgame = Column(Float)
    epa_defense_adjusted = Column(Float)

    consistency = Column(Float)  # 1 / (1 + stdev), normalized 0-1
    reliability = Column(Float)  # fraction of matches with nonzero contribution
    strength_of_schedule = Column(Float)
    matches_played = Column(Integer, default=0)
    score_variance = Column(Float, default=0.0)

    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    team = relationship("Team", back_populates="event_metrics")
    event = relationship("Event", back_populates="team_metrics")

    __table_args__ = (
        UniqueConstraint("team_key", "event_key", name="uq_team_event"),
    )
