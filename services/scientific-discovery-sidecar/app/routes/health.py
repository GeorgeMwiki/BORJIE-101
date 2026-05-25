"""GET /health — liveness probe + dependency status."""

from __future__ import annotations

from fastapi import APIRouter, Request

from app import __service__, __version__
from app.models.schemas import HealthChecks, HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    """Return service identity + dependency status."""
    dowhy_state = "loaded" if getattr(request.app.state, "dowhy_loaded", False) else "missing"
    tigramite_state = (
        "loaded" if getattr(request.app.state, "tigramite_loaded", False) else "missing"
    )
    checks = HealthChecks(dowhy=dowhy_state, tigramite=tigramite_state)
    return HealthResponse(
        ok=True,
        version=__version__,
        service=__service__,
        checks=checks,
    )
