"""
HTTP client for The Blue Alliance API v3.

Handles authentication, ETag caching (per TBA docs), and rate-limit-friendly
sequential requests. ETags are stored in-memory; a Redis-backed version would
be trivial to add for persistence across restarts.
"""

import httpx
from typing import Any
from backend.config import get_settings

settings = get_settings()

_etag_cache: dict[str, str] = {}
_response_cache: dict[str, Any] = {}


async def tba_get(path: str) -> Any | None:
    """
    GET a TBA API v3 endpoint. Returns parsed JSON or None on 304/error.

    Uses If-None-Match / ETag headers to respect TBA's caching guidance,
    reducing bandwidth and server load for both sides.
    """
    url = f"{settings.tba_base_url}{path}"
    headers = {"X-TBA-Auth-Key": settings.tba_api_key}

    if path in _etag_cache:
        headers["If-None-Match"] = _etag_cache[path]

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url, headers=headers)

    if resp.status_code == 304:
        return _response_cache.get(path)

    if resp.status_code != 200:
        return None

    etag = resp.headers.get("ETag")
    if etag:
        _etag_cache[path] = etag

    data = resp.json()
    _response_cache[path] = data
    return data


async def get_teams_page(page: int) -> list[dict]:
    return await tba_get(f"/teams/{page}") or []


async def get_team(team_key: str) -> dict | None:
    return await tba_get(f"/team/{team_key}")


async def get_events_by_year(year: int) -> list[dict]:
    return await tba_get(f"/events/{year}") or []


async def get_event_teams(event_key: str) -> list[dict]:
    return await tba_get(f"/event/{event_key}/teams") or []


async def get_event_matches(event_key: str) -> list[dict]:
    return await tba_get(f"/event/{event_key}/matches") or []


async def get_match(match_key: str) -> dict | None:
    return await tba_get(f"/match/{match_key}")


async def get_event_rankings(event_key: str) -> dict | None:
    return await tba_get(f"/event/{event_key}/rankings")


async def get_districts_for_year(year: int) -> list[dict]:
    return await tba_get(f"/districts/{year}") or []


async def get_district_rankings(district_key: str, year: int) -> list[dict] | dict | None:
    """
    TBA v3: GET /district/{district_key}/rankings — year is encoded in district_key (e.g. 2026pnw).
    Response is a JSON array of District_Ranking objects (not {rankings: [...]}).
    """
    return await tba_get(f"/district/{district_key}/rankings")


async def get_district_events_list(district_key: str, year: int) -> list[dict]:
    """TBA v3: GET /district/{district_key}/events — no year suffix."""
    return await tba_get(f"/district/{district_key}/events") or []


async def get_event_awards(event_key: str) -> list[dict]:
    return await tba_get(f"/event/{event_key}/awards") or []
