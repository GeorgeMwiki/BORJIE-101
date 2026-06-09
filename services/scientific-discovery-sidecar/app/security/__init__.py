"""Security primitives for the scientific-discovery sidecar.

SEC-1 — shared-secret bearer guard for the inference routes. The gateway
(and the proactive-triggers-worker, via the TS sidecar client) presents
`Authorization: Bearer <DISCOVERY_SIDECAR_AUTH_TOKEN>` on every
`/dowhy/*` and `/tigramite/*` call. The probe routes (`/health`,
`/readyz`, `/metrics`) stay open so K8s and Prometheus can reach them
without the secret.
"""

from .auth import require_bearer_token

__all__ = ["require_bearer_token"]
