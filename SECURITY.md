# Security

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Instead, contact the maintainers privately (e.g. via GitHub Security Advisories for this repository, if enabled, or the contact method listed on the project’s GitHub profile / README).

Include:

- Description of the issue and impact
- Steps to reproduce (if safe to share)
- Affected versions or deployment context (if known)

## Secrets

Never commit:

- The Blue Alliance API keys
- Database connection strings or passwords
- `ADMIN_API_SECRET`, `BULK_INGEST_SECRET`, or other production tokens

Use environment variables and `.env` (listed in `.gitignore`). Use `.env.example` only for **placeholder** names and local defaults.

## Write / admin API

When `ADMIN_API_SECRET` or `BULK_INGEST_SECRET` is set, these routes require the same value in `X-Admin-Secret` or `X-Bulk-Ingest-Secret`: `POST /api/ingest/{year}`, `POST /api/ingest/bulk` (alias: `POST /api/ingest-bulk`), `POST /api/compute/{event_key}`, `POST /api/train/{year}`.

Do **not** put that secret in `REACT_APP_*` on a public site (it would ship in the browser bundle). The hosted UI hides ingest actions when the API is locked and no client secret is configured. For trusted private builds only, `REACT_APP_ADMIN_API_SECRET` can match the server secret so the ingest buttons keep working.

## CORS

Set `CORS_ORIGINS` to a comma-separated list of your frontend origins in production (e.g. your Vercel URL). The default `*` keeps local development simple.
