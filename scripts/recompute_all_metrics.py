#!/usr/bin/env python3
"""
Re-run EPA / team_event_metrics for every season already in the database.

Use this after changing epa.py, compute.py, or predictor-related DB fields, without
re-downloading all matches from TBA (much faster than bulk_ingest).

Requires: DATABASE_URL in environment (or .env in project root).

Examples:
  PYTHONPATH=. python scripts/recompute_all_metrics.py
  PYTHONPATH=. python scripts/recompute_all_metrics.py --start 2019 --end 2026
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


async def main() -> None:
    from datetime import datetime

    p = argparse.ArgumentParser(description="Recompute team_event_metrics for all events per year")
    p.add_argument("--start", type=int, default=2002, help="First season")
    p.add_argument("--end", type=int, default=None, help="Last season (default: current year)")
    args = p.parse_args()

    end = args.end if args.end is not None else datetime.now().year
    start = max(2002, min(args.start, end))

    from backend.metrics.compute import compute_year_metrics

    years = list(range(start, end + 1))
    ok = 0
    err = 0
    for y in years:
        try:
            await compute_year_metrics(y)
            print(f"  {y}: ok")
            ok += 1
        except Exception as e:
            print(f"  {y}: error — {e}")
            err += 1

    print(f"\nDone. {ok} year(s) recomputed, {err} error(s).")


if __name__ == "__main__":
    asyncio.run(main())
