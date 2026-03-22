#!/usr/bin/env python3
"""
Retrain the ML prediction model on historical match data.

Requires: DATABASE_URL in environment (or .env in project root).

Examples:
  PYTHONPATH=. python scripts/retrain_model.py --year 2025
  PYTHONPATH=. python scripts/retrain_model.py --year 2024
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
    p = argparse.ArgumentParser(description="Retrain the ML prediction model")
    p.add_argument(
        "--year", type=int, required=True,
        help="Target year (trains on year-2 through year)",
    )
    args = p.parse_args()

    from backend.metrics.predictor import train_model, MODEL_PATH

    print(f"Training model for year {args.year} (using data from {args.year - 2}–{args.year})...")
    await train_model(args.year)

    if MODEL_PATH.exists():
        size_kb = MODEL_PATH.stat().st_size / 1024
        print(f"Model saved to {MODEL_PATH} ({size_kb:.1f} KB)")
    else:
        print("Warning: model file was not created (too few training samples?)")


if __name__ == "__main__":
    asyncio.run(main())
