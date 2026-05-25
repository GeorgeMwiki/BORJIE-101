"""POST /tigramite/pcmciplus — Tigramite PCMCIplus time-series causal discovery."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from app.models.schemas import PcmciRequest, PcmciResponse
from app.services.data_loader import DataRefError
from app.services.pcmciplus_engine import PcmciEngineError, run_pcmciplus

router = APIRouter(prefix="/tigramite", tags=["tigramite"])
logger = logging.getLogger(__name__)


@router.post("/pcmciplus", response_model=PcmciResponse)
async def pcmciplus(req: PcmciRequest, request: Request) -> PcmciResponse:
    """Run PCMCIplus on the requested variables and return the discovered DAG."""
    settings = request.app.state.settings
    try:
        return run_pcmciplus(
            req,
            max_rows=settings.max_payload_rows,
            pc_alpha=settings.pcmci_pc_alpha_default,
        )
    except DataRefError as exc:
        raise HTTPException(status_code=400, detail={"dataRef": str(exc)}) from exc
    except PcmciEngineError as exc:
        logger.exception("PCMCIplus engine error")
        raise HTTPException(
            status_code=500, detail={"engine": "tigramite", "message": str(exc)}
        ) from exc
