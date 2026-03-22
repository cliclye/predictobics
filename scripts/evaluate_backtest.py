#!/usr/bin/env python3
"""
Run historical backtests against the database (requires ingest + compute for that year).

Examples:
  PYTHONPATH=. python scripts/evaluate_backtest.py --year 2024 --max-events 30
  PYTHONPATH=. python scripts/evaluate_backtest.py --year 2025 --no-walk-forward
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys

# Project root
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


async def main() -> None:
    p = argparse.ArgumentParser(description="Evaluate predictions vs past events")
    p.add_argument("--year", type=int, required=True)
    p.add_argument("--max-events", type=int, default=35)
    p.add_argument(
        "--no-walk-forward",
        action="store_true",
        help="Skip per-match EPA recomputation (only leaky + ranking metrics)",
    )
    args = p.parse_args()

    from backend.metrics.evaluation import evaluate_year

    out = await evaluate_year(
        args.year,
        max_events=args.max_events,
        walk_forward=not args.no_walk_forward,
    )
    print(json.dumps(out, indent=2, default=str))


if __name__ == "__main__":
    asyncio.run(main())
