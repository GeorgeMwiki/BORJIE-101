"""Shared pytest fixtures.

`client` is a FastAPI TestClient that pre-warms the lifespan hooks so
`app.state.dowhy_loaded` and `app.state.tigramite_loaded` are populated
before any health test asserts on them.
"""

from __future__ import annotations

import importlib.util
import json
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings


def _has_module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


HAS_DOWHY = _has_module("dowhy")
HAS_TIGRAMITE = _has_module("tigramite")


@pytest.fixture(scope="session")
def test_settings() -> Settings:
    """Small, test-friendly settings (low simulation counts to keep
    pytest fast even on the real engines)."""
    return Settings(
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


@pytest.fixture()
def client(test_settings: Settings) -> Iterator[TestClient]:
    app = create_app(test_settings)
    with TestClient(app) as c:
        yield c


# ─────────────────────────────────────────────────────────────────────
# Synthetic-data fixtures.
# Use simple linear DGPs so the refutation + PCMCIplus engines have
# real signal to recover.
# ─────────────────────────────────────────────────────────────────────


def synthetic_refute_rows(n: int = 200, seed: int = 7) -> list[dict[str, float]]:
    """X causes Y; Z is a confounder. ATE of X on Y ≈ 0.5."""
    import numpy as np

    rng = np.random.default_rng(seed)
    z = rng.normal(0, 1, n)
    x = 0.3 * z + rng.normal(0, 1, n)
    y = 0.5 * x + 0.4 * z + rng.normal(0, 0.5, n)
    return [{"x": float(x[i]), "y": float(y[i]), "z": float(z[i])} for i in range(n)]


def synthetic_pcmci_rows(n: int = 200, seed: int = 7) -> list[dict[str, float]]:
    """3-variable VAR(1):
        a_t = 0.4 * a_{t-1} + e_a
        b_t = 0.5 * a_{t-1} + 0.3 * b_{t-1} + e_b      (a -> b, lag 1)
        c_t = 0.6 * b_{t-1} + 0.2 * c_{t-1} + e_c      (b -> c, lag 1)
    """
    import numpy as np

    rng = np.random.default_rng(seed)
    a = np.zeros(n)
    b = np.zeros(n)
    c = np.zeros(n)
    for t in range(1, n):
        a[t] = 0.4 * a[t - 1] + rng.normal(0, 1)
        b[t] = 0.5 * a[t - 1] + 0.3 * b[t - 1] + rng.normal(0, 1)
        c[t] = 0.6 * b[t - 1] + 0.2 * c[t - 1] + rng.normal(0, 1)
    return [{"a": float(a[i]), "b": float(b[i]), "c": float(c[i])} for i in range(n)]


def rows_data_ref(rows: list[dict[str, float]]) -> str:
    return "rows://" + json.dumps(rows)
