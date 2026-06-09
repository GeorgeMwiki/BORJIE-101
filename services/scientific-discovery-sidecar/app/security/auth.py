"""SEC-1 — shared-secret bearer-token guard.

A FastAPI dependency that requires `Authorization: Bearer <token>` on the
inference routes (`/dowhy/*`, `/tigramite/*`). The probe routes
(`/health`, `/readyz`, `/metrics`) are NOT guarded — K8s liveness /
readiness and the Prometheus scrape must reach them without the secret.

Design notes:
  - The expected token is read from `Settings.auth_token`, which is
    sourced from KMS via the External Secrets Operator
    (`DISCOVERY_SIDECAR_AUTH_TOKEN`). It is NEVER hardcoded.
  - Comparison is constant-time (`hmac.compare_digest`) so a timing
    side-channel cannot leak the token byte-by-byte.
  - When `auth_token` is empty the guard FAILS CLOSED with 503: a
    deployment that forgot to inject the secret must not silently accept
    unauthenticated traffic. Local dev opts out by setting the token to a
    known dev value (the deployment always sets a real one).

Reference: OWASP API Security Top 10 (API2:2023 Broken Authentication);
mTLS via the service mesh is the stronger variant — this bearer guard is
the MVP that works without a mesh.
"""

from __future__ import annotations

import hmac

from fastapi import HTTPException, Request, status

_BEARER_PREFIX = "bearer "


def _extract_bearer(header_value: str | None) -> str | None:
    """Pull the raw token out of an `Authorization: Bearer <token>` header.

    Returns ``None`` when the header is absent or not a bearer scheme.
    """
    if not header_value:
        return None
    stripped = header_value.strip()
    if len(stripped) <= len(_BEARER_PREFIX):
        return None
    if stripped[: len(_BEARER_PREFIX)].lower() != _BEARER_PREFIX:
        return None
    token = stripped[len(_BEARER_PREFIX) :].strip()
    return token or None


async def require_bearer_token(request: Request) -> None:
    """FastAPI dependency — 401 on missing/invalid bearer, 503 if unconfigured.

    Attach via ``dependencies=[Depends(require_bearer_token)]`` on the
    inference routers so the body is never even parsed for an
    unauthenticated caller.
    """
    settings = request.app.state.settings
    expected = getattr(settings, "auth_token", "") or ""

    if not expected:
        # Fail-closed: a service that should be protected but has no token
        # configured must refuse traffic rather than run wide open.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"auth": "sidecar auth token not configured"},
        )

    presented = _extract_bearer(request.headers.get("authorization"))
    if presented is None or not hmac.compare_digest(presented, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"auth": "invalid or missing bearer token"},
            headers={"WWW-Authenticate": "Bearer"},
        )
