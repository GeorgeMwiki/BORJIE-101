"""SEC-1 — bearer-token guard on the inference routes.

Asserts:
  - probe routes (/health, /readyz) stay OPEN (no token needed),
  - /dowhy/* and /tigramite/* reject a missing/wrong bearer with 401,
  - a correct bearer is accepted (reaches the handler — here we assert it
    gets PAST the guard by checking we no longer get 401),
  - a sidecar with NO token configured fails CLOSED with 503.

These tests are engine-independent: a 422 (schema) or 400 (dataRef) is a
perfectly good "got past auth" signal, so we never need DoWhy/Tigramite
installed to prove the guard works.
"""

from __future__ import annotations

import dataclasses

from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings
from tests.conftest import TEST_AUTH_TOKEN, rows_data_ref, synthetic_refute_rows


def _refute_body() -> dict:
    return {
        "dag": {
            "nodes": ["x", "y", "z"],
            "edges": [{"from": "x", "to": "y"}],
            "candidateEdges": [],
        },
        "dataRef": rows_data_ref(synthetic_refute_rows(20)),
        "treatment": "x",
        "outcome": "y",
        "estimator": "dowhy_linear",
    }


def _pcmci_body() -> dict:
    return {
        "variables": ["a", "b", "c"],
        "dataRef": rows_data_ref(synthetic_refute_rows(20)),
        "tauMax": 2,
    }


def _bare_client(settings: Settings) -> TestClient:
    """A client with NO default Authorization header."""
    return TestClient(create_app(settings))


# ─────────────────────────────────────────────────────────────────────
# Probe routes stay open.
# ─────────────────────────────────────────────────────────────────────


def test_health_is_open_without_token(test_settings: Settings) -> None:
    with _bare_client(test_settings) as c:
        assert c.get("/health").status_code == 200


def test_readyz_is_open_without_token(test_settings: Settings) -> None:
    with _bare_client(test_settings) as c:
        # 200 or 503 (engines missing) — but NEVER 401: it is unguarded.
        assert c.get("/readyz").status_code in {200, 503}


# ─────────────────────────────────────────────────────────────────────
# Inference routes require the bearer.
# ─────────────────────────────────────────────────────────────────────


def test_dowhy_rejects_missing_token(test_settings: Settings) -> None:
    with _bare_client(test_settings) as c:
        res = c.post("/dowhy/refute", json=_refute_body())
        assert res.status_code == 401
        assert res.json()["detail"]["auth"]


def test_tigramite_rejects_missing_token(test_settings: Settings) -> None:
    with _bare_client(test_settings) as c:
        res = c.post("/tigramite/pcmciplus", json=_pcmci_body())
        assert res.status_code == 401


def test_dowhy_rejects_wrong_token(test_settings: Settings) -> None:
    with _bare_client(test_settings) as c:
        res = c.post(
            "/dowhy/refute",
            json=_refute_body(),
            headers={"Authorization": "Bearer not-the-right-token"},
        )
        assert res.status_code == 401


def test_dowhy_rejects_non_bearer_scheme(test_settings: Settings) -> None:
    with _bare_client(test_settings) as c:
        res = c.post(
            "/dowhy/refute",
            json=_refute_body(),
            headers={"Authorization": f"Basic {TEST_AUTH_TOKEN}"},
        )
        assert res.status_code == 401


def test_dowhy_accepts_correct_token(test_settings: Settings) -> None:
    """A valid bearer gets PAST the guard. We don't need the engine to
    succeed — anything other than 401 proves auth passed."""
    with _bare_client(test_settings) as c:
        res = c.post(
            "/dowhy/refute",
            json=_refute_body(),
            headers={"Authorization": f"Bearer {TEST_AUTH_TOKEN}"},
        )
        assert res.status_code != 401


# ─────────────────────────────────────────────────────────────────────
# Fail-closed when no token is configured.
# ─────────────────────────────────────────────────────────────────────


def test_unconfigured_token_fails_closed_with_503(test_settings: Settings) -> None:
    no_token = dataclasses.replace(test_settings, auth_token="")
    with _bare_client(no_token) as c:
        res = c.post(
            "/dowhy/refute",
            json=_refute_body(),
            headers={"Authorization": f"Bearer {TEST_AUTH_TOKEN}"},
        )
        assert res.status_code == 503


# ─────────────────────────────────────────────────────────────────────
# Constant-time helper unit test.
# ─────────────────────────────────────────────────────────────────────


def test_extract_bearer_parsing() -> None:
    from app.security.auth import _extract_bearer

    assert _extract_bearer("Bearer abc123") == "abc123"
    assert _extract_bearer("bearer abc123") == "abc123"
    assert _extract_bearer("Bearer    spaced  ") == "spaced"
    assert _extract_bearer("Basic abc123") is None
    assert _extract_bearer("abc123") is None
    assert _extract_bearer("") is None
    assert _extract_bearer(None) is None
    assert _extract_bearer("Bearer ") is None
