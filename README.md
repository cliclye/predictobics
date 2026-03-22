# Predictobics — Advanced FRC Analytics Platform

An analytics platform for FIRST Robotics Competition data, featuring component EPA metrics, defense-adjusted ratings, ML-powered match predictions, and Monte Carlo event simulation.

## Refresh all numbers (production / Railway)

After deploying new prediction or EPA logic, **recompute metrics** from data already in Postgres (fast):

```bash
# From project root, with DATABASE_URL set (e.g. railway run)
PYTHONPATH=. python scripts/recompute_all_metrics.py
```

Optional year range:

```bash
PYTHONPATH=. python scripts/recompute_all_metrics.py --start 2019 --end 2026
```

To **re-pull everything from The Blue Alliance** and recompute (slow; full archive refresh):

```bash
PYTHONPATH=. python scripts/bulk_ingest.py --start 2002 --end 2026 --newest-first
```

Requires `DATABASE_URL` and `TBA_API_KEY` in the environment (or `.env`).

---

just go to the website :)
