"""FastAPI app entrypoint for the scientific-discovery sidecar.

Wires up routes, CORS, and the healthcheck. The actual causal-inference
work happens in `app/services/dowhy_engine.py` and
`app/services/pcmciplus_engine.py`.

Run locally:

    uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

Or:

    python -m app.main
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __service__, __version__
from app.routes import dowhy_refute, health, pcmciplus, readyz
from app.settings import Settings, load_settings


def _configure_logging(level: str) -> None:
    """Configure root logger once at startup."""
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Run startup / shutdown hooks. We pre-warm imports here so the
    first real request doesn't pay the DoWhy / Tigramite import tax."""
    logger = logging.getLogger("scientific-discovery-sidecar.lifespan")
    logger.info("Sidecar %s starting up.", __version__)
    # Pre-warm heavy imports — best-effort, swallow failure so the
    # service can still report degraded health via /health.
    try:
        import dowhy  # noqa: F401
        app.state.dowhy_loaded = True
    except Exception as exc:  # noqa: BLE001 — boundary point
        logger.warning("DoWhy pre-warm failed: %s", exc)
        app.state.dowhy_loaded = False
    try:
        import tigramite  # noqa: F401
        app.state.tigramite_loaded = True
    except Exception as exc:  # noqa: BLE001 — boundary point
        logger.warning("Tigramite pre-warm failed: %s", exc)
        app.state.tigramite_loaded = False
    yield
    logger.info("Sidecar %s shutting down.", __version__)


def create_app(settings: Settings | None = None) -> FastAPI:
    """App factory — exposed so tests can pass their own settings."""
    cfg = settings or load_settings()
    _configure_logging(cfg.log_level)

    app = FastAPI(
        title=__service__,
        version=__version__,
        description="Causal-inference sidecar for @borjie/scientific-discovery.",
        lifespan=_lifespan,
    )
    app.state.settings = cfg

    if cfg.cors_allow_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(cfg.cors_allow_origins),
            allow_credentials=False,
            allow_methods=["GET", "POST"],
            allow_headers=["content-type"],
        )

    app.include_router(health.router)
    app.include_router(readyz.router)
    app.include_router(dowhy_refute.router)
    app.include_router(pcmciplus.router)

    # Wire Prometheus middleware — must happen before the app starts
    # serving so the FastAPI route table is fully registered. The
    # instrumentator exposes /metrics on the same port as the app,
    # matching the ServiceMonitor scrape config (port 8000).
    _wire_prometheus_metrics(app)

    return app


def _wire_prometheus_metrics(app: FastAPI) -> None:
    """Mount the Prometheus instrumentator and `/metrics` endpoint.

    Import is local so unit tests that stub out the dep (or environments
    with the package missing) degrade to a no-op rather than crashing
    app creation.
    """
    try:
        from prometheus_fastapi_instrumentator import Instrumentator
    except ImportError:  # pragma: no cover — dep missing in dev only
        logging.getLogger("scientific-discovery-sidecar.metrics").warning(
            "prometheus-fastapi-instrumentator not installed; "
            "/metrics will return 404. Install requirements.txt to enable.",
        )
        return

    # `should_group_status_codes=False` keeps `200`, `201` etc distinct
    # so we can spot regression spikes per code. `excluded_handlers`
    # avoids the noisy /health probe drowning out real RED metrics.
    instrumentator = Instrumentator(
        should_group_status_codes=False,
        excluded_handlers=["/health", "/readyz", "/metrics"],
    )
    instrumentator.instrument(app).expose(
        app,
        endpoint="/metrics",
        include_in_schema=False,
        tags=["health"],
    )


app = create_app()


def run() -> None:
    """`scientific-discovery-sidecar` console-script entrypoint."""
    import uvicorn

    cfg = load_settings()
    uvicorn.run(
        "app.main:app",
        host=cfg.host,
        port=cfg.port,
        log_level=cfg.log_level.lower(),
        reload=False,
    )


if __name__ == "__main__":
    run()
