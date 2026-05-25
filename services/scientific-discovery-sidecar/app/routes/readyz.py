"""GET /readyz — readiness probe.

`/health` is the *liveness* probe (process is up). `/readyz` is the
*readiness* probe (we can serve real causal-inference traffic). For
this sidecar that means both DoWhy and Tigramite imported cleanly at
startup. If either pre-warm failed we return 503 so the K8s readiness
probe pulls the pod out of rotation until it's restarted.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(tags=["health"])


@router.get("/readyz")
async def readyz(request: Request) -> JSONResponse:
    """Return 200 when DoWhy + Tigramite are both importable, else 503.

    The readiness check is structural — it doesn't run a real inference,
    it just confirms the heavy import-time dependencies are present. If
    the install is broken the pod cannot answer real traffic, so we
    surface that to K8s rather than failing the first user request.
    """
    dowhy_loaded = bool(getattr(request.app.state, "dowhy_loaded", False))
    tigramite_loaded = bool(getattr(request.app.state, "tigramite_loaded", False))
    ready = dowhy_loaded and tigramite_loaded
    body = {
        "ready": ready,
        "checks": {
            "dowhy": "loaded" if dowhy_loaded else "missing",
            "tigramite": "loaded" if tigramite_loaded else "missing",
        },
    }
    status_code = 200 if ready else 503
    return JSONResponse(status_code=status_code, content=body)
