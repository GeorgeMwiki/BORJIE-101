"""Prometheus /metrics endpoint tests.

The instrumentator mounts /metrics on the same FastAPI app. We assert:
  - GET /metrics returns 200 with text/plain (Prometheus exposition).
  - At least the standard `http_request_duration_seconds*` histogram
    appears in the body once any other handler has been hit.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_metrics_endpoint_returns_prometheus_exposition(client: TestClient) -> None:
    """`/metrics` answers 200 and looks like a Prometheus dump."""
    # Hit /health first so the http_request_duration histogram records
    # at least one observation. (The instrumentator only emits a sample
    # the first time a handler with the right family is invoked.)
    client.get("/health")
    res = client.get("/metrics")
    assert res.status_code == 200
    content_type = res.headers.get("content-type", "")
    # prometheus-fastapi-instrumentator sets `text/plain; version=0.0.4; charset=utf-8`.
    assert content_type.startswith("text/plain"), content_type
    body = res.text
    # The instrumentator's default name. The exact metric family may
    # be `http_request_duration_seconds` or `http_request_duration_highr_seconds`
    # depending on config; either is acceptable signal that the
    # exporter wired up.
    assert "http_request" in body
