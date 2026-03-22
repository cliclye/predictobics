#!/usr/bin/env python3
"""
Foreground bulk ingestion: pull many seasons of events + matches + EPA into PostgreSQL.

Uses the same logic as POST /api/ingest/bulk but runs in your terminal (survives
server restarts better for long jobs; use Railway `railway run` or SSH).

Requires: DATABASE_URL, TBA_API_KEY in environment (or .env in project root).

Examples:
  PYTHONPATH=. python scripts/bulk_ingest.py --start 2015 --end 2026
  PYTHONPATH=. python scripts/bulk_ingest.py --start 2002 --end 2024 --no-newest-first
  PYTHONPATH=. python scripts/bulk_ingest.py --start 2024 --end 2026 --skip-teams
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


async def main() -> None:
    p = argparse.ArgumentParser(description="Bulk-ingest FRC seasons from TBA")
    p.add_argument("--start", type=int, default=2002, help="First season (default 2002)")
    p.add_argument("--end", type=int, default=None, help="Last season (default: current year)")
    p.add_argument(
        "--skip-teams",
        action="store_true",
        help="Do not refresh the global team list first (faster if teams already ingested)",
    )
    p.add_argument(
        "--no-compute",
        action="store_true",
        help="Skip EPA computation (only raw matches/events)",
    )
    p.add_argument(
        "--newest-first",
        action="store_true",
        help="Process 2026, 2025, ... (useful to get recent data visible sooner)",
    )
    p.add_argument(
        "--pause",
        type=float,
        default=1.0,
        help="Seconds to sleep between seasons (default 1.0)",
    )
    args = p.parse_args()

    from datetime import datetime

    end = args.end if args.end is not None else datetime.now().year

    from backend.ingestion.pipeline import bulk_ingest_years

    summary = await bulk_ingest_years(
        args.start,
        end,
        refresh_teams_first=not args.skip_teams,
        compute_metrics=not args.no_compute,
        newest_first=args.newest_first,
        pause_between_years_sec=args.pause,
    )
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    asyncio.run(main())
