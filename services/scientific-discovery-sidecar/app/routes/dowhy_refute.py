"""POST /dowhy/refute — run DoWhy refutation battery on a candidate DAG."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from app.models.schemas import RefuteRequest, RefuteResponse
from app.services.data_loader import DataRefError
from app.services.dowhy_engine import DoWhyEngineError, run_refutation

router = APIRouter(prefix="/dowhy", tags=["dowhy"])
logger = logging.getLogger(__name__)


@router.post("/refute", response_model=RefuteResponse)
async def dowhy_refute(req: RefuteRequest, request: Request) -> RefuteResponse:
    """Execute the 3-test refutation battery and return normalised scores."""
    settings = request.app.state.settings
    try:
        return run_refutation(
            req,
            max_rows=settings.max_payload_rows,
            bootstrap_samples=settings.bootstrap_samples,
            dowhy_simulations=settings.dowhy_simulations,
        )
    except DataRefError as exc:
        # 400 — caller-fixable.
        raise HTTPException(status_code=400, detail={"dataRef": str(exc)}) from exc
    except DoWhyEngineError as exc:
        # 500 — engine crashed on a structurally-valid request.
        logger.exception("DoWhy engine error")
        raise HTTPException(status_code=500, detail={"engine": "dowhy", "message": str(exc)}) from exc
