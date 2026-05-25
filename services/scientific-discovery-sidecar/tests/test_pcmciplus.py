"""POST /tigramite/pcmciplus — request validation + real-engine round-trip."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.conftest import HAS_TIGRAMITE, rows_data_ref, synthetic_pcmci_rows


def _well_formed_request(rows_ref: str | None = None) -> dict:
    return {
        "variables": ["a", "b", "c"],
        "dataRef": rows_ref or rows_data_ref(synthetic_pcmci_rows()),
        "tauMax": 3,
    }


# ─────────────────────────────────────────────────────────────────────
# Schema-level
# ─────────────────────────────────────────────────────────────────────


def test_rejects_too_few_variables(client: TestClient) -> None:
    body = _well_formed_request()
    body["variables"] = ["a"]
    res = client.post("/tigramite/pcmciplus", json=body)
    assert res.status_code == 422


def test_rejects_negative_tau_max(client: TestClient) -> None:
    body = _well_formed_request()
    body["tauMax"] = -1
    res = client.post("/tigramite/pcmciplus", json=body)
    assert res.status_code == 422


def test_rejects_tau_max_too_large(client: TestClient) -> None:
    body = _well_formed_request()
    body["tauMax"] = 1000
    res = client.post("/tigramite/pcmciplus", json=body)
    assert res.status_code == 422


def test_rejects_blank_variable_name(client: TestClient) -> None:
    body = _well_formed_request()
    body["variables"] = ["a", " "]
    res = client.post("/tigramite/pcmciplus", json=body)
    assert res.status_code == 422


def test_rejects_malformed_data_ref(client: TestClient) -> None:
    body = _well_formed_request(rows_ref="weird://nothing")
    res = client.post("/tigramite/pcmciplus", json=body)
    assert res.status_code == 400


# ─────────────────────────────────────────────────────────────────────
# Engine round-trip — requires Tigramite.
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.skipif(not HAS_TIGRAMITE, reason="Tigramite not installed")
def test_pcmciplus_returns_valid_dag(client: TestClient) -> None:
    res = client.post("/tigramite/pcmciplus", json=_well_formed_request())
    assert res.status_code == 200, res.text
    body = res.json()
    assert set(body.keys()) == {"dag", "pValues"}

    dag = body["dag"]
    assert set(dag["nodes"]) == {"a", "b", "c"}
    # PCMCIplus may not always find every edge, but it should not
    # invent variables we didn't pass.
    for edge in dag["edges"]:
        assert edge["from"] in {"a", "b", "c"}
        assert edge["to"] in {"a", "b", "c"}

    # pValues parallel to dag.edges, all in [0, 1].
    assert len(body["pValues"]) == len(dag["edges"])
    for p in body["pValues"]:
        assert 0.0 <= p <= 1.0


@pytest.mark.skipif(not HAS_TIGRAMITE, reason="Tigramite not installed")
def test_pcmciplus_recovers_a_to_b_edge_on_var1_dgp(client: TestClient) -> None:
    """The VAR(1) DGP encodes a→b and b→c. PCMCIplus should find at least one of them."""
    res = client.post("/tigramite/pcmciplus", json=_well_formed_request())
    assert res.status_code == 200, res.text
    edges = res.json()["dag"]["edges"]
    recovered = {(e["from"], e["to"]) for e in edges}
    # Be lenient — finite samples + ParCorr can miss; recovering at
    # least one true edge is a strong signal the engine works.
    true_edges = {("a", "b"), ("b", "c")}
    assert recovered & true_edges, (
        f"PCMCIplus failed to recover ANY of the true edges {true_edges}; "
        f"got {recovered}"
    )


# ─────────────────────────────────────────────────────────────────────
# Engine module — direct unit test of helpers that don't need Tigramite.
# ─────────────────────────────────────────────────────────────────────


def test_project_and_clean_drops_nans() -> None:
    import pandas as pd

    from app.services.pcmciplus_engine import _project_and_clean

    df = pd.DataFrame(
        {
            "a": list(range(20)),
            "b": [float(i) for i in range(20)],
            "extra": ["x"] * 20,
        }
    )
    df.loc[5, "a"] = None
    out = _project_and_clean(df, ["a", "b"])
    assert list(out.columns) == ["a", "b"]
    assert len(out) == 19  # dropped the NaN row


def test_project_and_clean_raises_on_missing_column() -> None:
    import pandas as pd
    import pytest

    from app.services.pcmciplus_engine import PcmciEngineError, _project_and_clean

    df = pd.DataFrame({"a": range(20)})
    with pytest.raises(PcmciEngineError):
        _project_and_clean(df, ["a", "nope"])


def test_edges_to_dag_collapses_lag_space_taking_min_p() -> None:
    from app.services.pcmciplus_engine import _DiscoveredEdge, _edges_to_dag

    edges = [
        _DiscoveredEdge("a", "b", lag=1, p_value=0.03),
        _DiscoveredEdge("a", "b", lag=2, p_value=0.01),  # winner — smaller p
        _DiscoveredEdge("b", "c", lag=1, p_value=0.04),
    ]
    dag = _edges_to_dag(["a", "b", "c"], edges)
    assert set(dag.nodes) == {"a", "b", "c"}

    # Only 2 collapsed edges, not 3.
    assert len(dag.edges) == 2

    by_pair = {(e.from_node, e.to_node): e for e in dag.edges}
    assert (("a", "b") in by_pair) and (("b", "c") in by_pair)
    assert "lag=2" in by_pair[("a", "b")].rationale
    assert "p=0.0100" in by_pair[("a", "b")].rationale
