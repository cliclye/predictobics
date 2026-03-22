# Heroku-style process file. Ensure dependencies are installed (e.g. via buildpack or Dockerfile).
web: PYTHONPATH=. uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}
