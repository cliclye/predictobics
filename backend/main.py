"""
Predictobics — FRC Analytics Platform

Entry point for the FastAPI application. Serves both the API and the
static React frontend build. Includes a background scheduler that
auto-refreshes match data from TBA every 2 minutes.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from backend.database import init_db
from backend.api.routes import router
from backend.api.district_locks_router import router as district_locks_router
from backend.config import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

logger = logging.getLogger(__name__)

REFRESH_INTERVAL = 120


def _cors_middleware_kwargs() -> dict:
    """Starlette: use * OR explicit origins; optional regex for e.g. all Vercel previews."""
    settings = get_settings()
    raw = (settings.cors_origins or "").strip()
    regex = (settings.cors_origin_regex or "").strip()
    if not raw or raw == "*":
        return {
            "allow_origins": ["*"],
            "allow_credentials": False,
        }
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    if not origins:
        return {
            "allow_origins": ["*"],
            "allow_credentials": False,
        }
    out: dict = {
        "allow_origins": origins,
        "allow_credentials": True,
    }
    if regex:
        out["allow_origin_regex"] = regex
    return out


async def _auto_refresh_loop():
    """Background loop: refresh active events every REFRESH_INTERVAL seconds."""
    await asyncio.sleep(10)
    while True:
        try:
            from backend.ingestion.pipeline import refresh_active_events
            year = datetime.utcnow().year
            refreshed = await refresh_active_events(year)
            if refreshed:
                logger.info(f"Auto-refresh: updated {len(refreshed)} events")
        except Exception as e:
            logger.error(f"Auto-refresh error: {e}")
        await asyncio.sleep(REFRESH_INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await init_db()
        logger.info("Database schema ready")
    except Exception as e:
        logger.exception("Database init failed — TBA-only routes may still work; fix DATABASE_URL: %s", e)
    task = asyncio.create_task(_auto_refresh_loop())
    logger.info(f"Started auto-refresh scheduler (every {REFRESH_INTERVAL}s)")
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="Predictobics",
    description="Advanced FRC analytics platform with EPA metrics and match predictions",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_methods=["*"],
    allow_headers=["*"],
    **_cors_middleware_kwargs(),
)


@app.get("/api/health", tags=["meta"])
async def api_health():
    """No DB required — use to verify Railway/public URL and CORS from the browser."""
    return {"status": "ok"}


app.include_router(router, prefix="/api")
app.include_router(district_locks_router, prefix="/api")

# Serve React frontend in production
frontend_build = Path(__file__).parent.parent / "frontend" / "build"
if frontend_build.exists():
    app.mount("/static", StaticFiles(directory=frontend_build / "static"), name="static")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        file_path = frontend_build / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(frontend_build / "index.html")
