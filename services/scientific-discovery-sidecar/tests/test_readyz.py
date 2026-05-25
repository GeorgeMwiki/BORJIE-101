"""Readiness probe tests.

`/readyz` returns 200 when both DoWhy and Tigramite are importable, and
503 when either pre-warm hook failed. The lifespan in `app.main` sets
`app.state.dowhy_loaded` / `app.state.tigramite_loaded`; tests below
patch those flags directly via the TestClient app instance.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings


@pytest.fixture()
def fresh_app() -> TestClient:
    """A fresh app + client per test so we never leak readiness state."""
    settings = Settings(
        host="127.0.0.1",
        port=0,
        log_level="warning",
        bootstrap_samples=10,
        dowhy_simulations=10,
        pcmci_tau_max_default=2,
        pcmci_pc_alpha_default=0.05,
        max_payload_rows=10_000,
        cors_allow_origins=(),
    )
    app = create_app(settings)
    return TestClient(app)


def test_readyz_returns_200_when_dependencies_loaded(fresh_app: TestClient) -> None:
    with fresh_app as client:
        # Lifespan runs inside the `with` block — once it has, override
        # the pre-warm flags to the all-loaded case.
        client.app.state.dowhy_loaded = True
        client.app.state.tigramite_loaded = True
        res = client.get("/readyz")
    assert res.status_code == 200
    body = res.json()
    assert body["ready"] is True
    assert body["checks"]["dowhy"] == "loaded"
    assert body["checks"]["tigramite"] == "loaded"


def test_readyz_returns_503_when_dowhy_missing(fresh_app: TestClient) -> None:
    with fresh_app as client:
        client.app.state.dowhy_loaded = False
        client.app.state.tigramite_loaded = True
        res = client.get("/readyz")
    assert res.status_code == 503
    body = res.json()
    assert body["ready"] is False
    assert body["checks"]["dowhy"] == "missing"
    assert body["checks"]["tigramite"] == "loaded"


def test_readyz_returns_503_when_tigramite_missing(fresh_app: TestClient) -> None:
    with fresh_app as client:
        client.app.state.dowhy_loaded = True
        client.app.state.tigramite_loaded = False
        res = client.get("/readyz")
    assert res.status_code == 503
    body = res.json()
    assert body["ready"] is False
    assert body["checks"]["tigramite"] == "missing"


def test_readyz_returns_503_when_both_missing(fresh_app: TestClient) -> None:
    with fresh_app as client:
        client.app.state.dowhy_loaded = False
        client.app.state.tigramite_loaded = False
        res = client.get("/readyz")
    assert res.status_code == 503
    body = res.json()
    assert body["ready"] is False
    assert body["checks"]["dowhy"] == "missing"
    assert body["checks"]["tigramite"] == "missing"
