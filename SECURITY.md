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
- `BULK_INGEST_SECRET` or other production tokens

Use environment variables and `.env` (listed in `.gitignore`). Use `.env.example` only for **placeholder** names and local defaults.
