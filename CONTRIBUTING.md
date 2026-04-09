# Contributing

Thanks for your interest in Predictobics.

## Getting started

1. Fork the repository and clone it locally.
2. **Backend:** Python 3.10+ recommended (see `runtime.txt` for deploy). Create a virtualenv, install `requirements.txt`, copy `.env.example` to `.env`, and set `TBA_API_KEY` and `DATABASE_URL`.
3. **Frontend:** `cd frontend && npm install && npm start` (expects the API on port 8000 via `proxy` in `package.json`, or set `REACT_APP_API_URL`). To run API + UI together: `cd frontend && npm run dev` (uses `../venv/bin/python`; create the venv at the repo root first).

## Pull requests

- Keep changes focused; open an issue first for large features.
- Match existing style (formatting, naming).
- Do not commit secrets, API keys, or production database URLs. For hosted APIs, set `ADMIN_API_SECRET` (or `BULK_INGEST_SECRET`) and list your frontend origin in `CORS_ORIGINS` (see `SECURITY.md`).

## Data and attribution

Match and event data come from [The Blue Alliance](https://www.thebluealliance.com/) API. Respect their [terms of use](https://www.thebluealliance.com/apidocs) and rate limits.

## License

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE).
