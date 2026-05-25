"""GET /health returns 200 + the contract shape."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app import __service__, __version__


def test_health_returns_200_and_service_metadata(client: TestClient) -> None:
    res = client.get("/health")
    assert res.status_code == 200

    body = res.json()
    assert body["ok"] is True
    assert body["version"] == __version__
    assert body["service"] == __service__
    assert "checks" in body
    assert set(body["checks"].keys()) == {"dowhy", "tigramite"}
    assert body["checks"]["dowhy"] in {"loaded", "missing"}
    assert body["checks"]["tigramite"] in {"loaded", "missing"}


def test_health_response_schema_is_stable(client: TestClient) -> None:
    """Guards the TS-side wire contract — the JSON shape must not drift."""
    res = client.get("/health")
    body = res.json()
    # No extra top-level keys; if this fails we've added something
    # the TS client doesn't know about.
    assert set(body.keys()) == {"ok", "version", "service", "checks"}
