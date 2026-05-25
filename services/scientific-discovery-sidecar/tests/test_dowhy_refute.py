"""POST /dowhy/refute — request validation + real-engine round-trip."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.conftest import HAS_DOWHY, rows_data_ref, synthetic_refute_rows


def _well_formed_request(rows_ref: str | None = None) -> dict:
    """A request body matching the TS-side `SidecarRefuteRequest` shape."""
    return {
        "dag": {
            "nodes": ["x", "y", "z"],
            "edges": [
                {"from": "x", "to": "y", "rationale": "treatment → outcome"},
                {"from": "z", "to": "x"},
                {"from": "z", "to": "y"},
            ],
            "candidateEdges": [],
        },
        "dataRef": rows_ref or rows_data_ref(synthetic_refute_rows()),
        "treatment": "x",
        "outcome": "y",
        "estimator": "dowhy_linear",
    }


# ─────────────────────────────────────────────────────────────────────
# Schema-level: these MUST work even without DoWhy installed.
# ─────────────────────────────────────────────────────────────────────


def test_rejects_missing_treatment(client: TestClient) -> None:
    body = _well_formed_request()
    body.pop("treatment")
    res = client.post("/dowhy/refute", json=body)
    assert res.status_code == 422


def test_rejects_blank_dag_nodes(client: TestClient) -> None:
    body = _well_formed_request()
    body["dag"]["nodes"] = ["x", "   "]
    res = client.post("/dowhy/refute", json=body)
    assert res.status_code == 422


def test_rejects_dag_with_one_node(client: TestClient) -> None:
    body = _well_formed_request()
    body["dag"]["nodes"] = ["x"]
    res = client.post("/dowhy/refute", json=body)
    assert res.status_code == 422


def test_rejects_unknown_estimator(client: TestClient) -> None:
    body = _well_formed_request()
    body["estimator"] = "not_a_real_estimator"
    res = client.post("/dowhy/refute", json=body)
    assert res.status_code == 422


def test_rejects_malformed_data_ref(client: TestClient) -> None:
    body = _well_formed_request(rows_ref="not-a-scheme://anything")
    res = client.post("/dowhy/refute", json=body)
    assert res.status_code == 400
    assert "dataRef" in res.json()["detail"]


# ─────────────────────────────────────────────────────────────────────
# Engine round-trip — requires DoWhy.
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.skipif(not HAS_DOWHY, reason="DoWhy not installed")
def test_real_refutation_returns_valid_scores(client: TestClient) -> None:
    res = client.post("/dowhy/refute", json=_well_formed_request())
    assert res.status_code == 200, res.text
    body = res.json()
    assert set(body.keys()) == {"scores", "diagnostics"}

    scores = body["scores"]
    assert set(scores.keys()) >= {"placebo", "bootstrap", "unobservedConfounder"}
    for name in ("placebo", "bootstrap", "unobservedConfounder"):
        v = scores[name]
        assert isinstance(v, (int, float))
        assert 0.0 <= v <= 1.0, f"{name}={v} out of [0,1]"

    # The diagnostics field should mention the estimator + ATE.
    assert "ATE" in body["diagnostics"]
    assert "estimator=dowhy_linear" in body["diagnostics"]


@pytest.mark.skipif(not HAS_DOWHY, reason="DoWhy not installed")
def test_inline_csv_data_ref(client: TestClient) -> None:
    import io

    import pandas as pd

    rows = synthetic_refute_rows()
    buf = io.StringIO()
    pd.DataFrame(rows).to_csv(buf, index=False)
    body = _well_formed_request(rows_ref="inline://" + buf.getvalue())
    res = client.post("/dowhy/refute", json=body)
    assert res.status_code == 200, res.text


# ─────────────────────────────────────────────────────────────────────
# Engine module — direct unit test of normalisation helpers.
# ─────────────────────────────────────────────────────────────────────


def test_clamp_and_safe_float_helpers() -> None:
    from app.services.dowhy_engine import _clamp_unit, _safe_float

    assert _clamp_unit(-0.5) == 0.0
    assert _clamp_unit(1.7) == 1.0
    assert _clamp_unit(0.42) == 0.42

    assert _safe_float("3.14") == 3.14
    assert _safe_float(float("nan")) is None
    assert _safe_float(float("inf")) is None
    assert _safe_float("not a number") is None


def test_dag_to_gml_emits_directed_graph() -> None:
    from app.models.schemas import CausalDag, DagEdge
    from app.services.dowhy_engine import _dag_to_gml

    dag = CausalDag(
        nodes=["a", "b", "c"],
        edges=[
            DagEdge(**{"from": "a", "to": "b"}),
            DagEdge(**{"from": "b", "to": "c"}),
        ],
    )
    gml = _dag_to_gml(dag)
    assert "directed 1" in gml
    assert 'label "a"' in gml
    assert 'label "b"' in gml
    assert 'label "c"' in gml
    # Should contain 3 node blocks and 2 edge blocks.
    assert gml.count("node [") == 3
    assert gml.count("edge [") == 2


@pytest.mark.skipif(not HAS_DOWHY, reason="DoWhy not installed")
def test_engine_validates_missing_columns() -> None:
    """The engine should reject requests whose treatment/outcome are
    absent from the resolved DataFrame (not a Pydantic-catchable error)."""
    from app.models.schemas import RefuteRequest
    from app.services.dowhy_engine import DoWhyEngineError, run_refutation

    rows = synthetic_refute_rows(50)
    body = _well_formed_request(rows_ref=rows_data_ref(rows))
    body["treatment"] = "not_in_data"
    req = RefuteRequest.model_validate(body)
    with pytest.raises(DoWhyEngineError) as exc:
        run_refutation(req, max_rows=10_000, bootstrap_samples=5, dowhy_simulations=5)
    assert "not_in_data" in str(exc.value)
