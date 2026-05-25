"""Tigramite PCMCIplus engine.

PCMCIplus (Runge et al.) is the state-of-the-art algorithm for
time-series causal discovery — it handles *both* lagged
(`X_{t-k} → Y_t`) and contemporaneous (`X_t → Y_t`) causal links over
panels.

Pipeline:

  1. Resolve `dataRef` → pandas DataFrame
  2. Drop / coerce non-numeric columns
  3. Pack into a `tigramite.data_processing.DataFrame`
  4. Run `PCMCI.run_pcmciplus(tau_max=…, pc_alpha=…)`
  5. Translate the link-matrix back into our `CausalDag` shape,
     attaching `lag=K, p=…` rationale per edge.

References:
  - https://github.com/jakobrunge/tigramite
  - Runge et al., "Discovering causal structure with reproducible
    confidence", Nature Comm. 2019.
"""

from __future__ import annotations

import logging
import warnings
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from app.models.schemas import (
    CausalDag,
    DagEdge,
    PcmciRequest,
    PcmciResponse,
)
from app.services.data_loader import load_dataframe

logger = logging.getLogger(__name__)


class PcmciEngineError(RuntimeError):
    """Raised when Tigramite fails to run PCMCIplus."""


@dataclass(frozen=True)
class _DiscoveredEdge:
    from_var: str
    to_var: str
    lag: int
    p_value: float


def run_pcmciplus(
    req: PcmciRequest,
    *,
    max_rows: int,
    pc_alpha: float,
) -> PcmciResponse:
    """Entry point.

    Args:
        req: Validated request.
        max_rows: Hard cap on DataFrame rows.
        pc_alpha: Significance threshold for PCMCI (default 0.05).
    """
    df_full = load_dataframe(req.dataRef, max_rows=max_rows)
    df = _project_and_clean(df_full, req.variables)

    edges = _run_tigramite(
        df=df,
        variables=list(req.variables),
        tau_max=req.tauMax,
        pc_alpha=pc_alpha,
    )

    dag = _edges_to_dag(req.variables, edges)
    p_values = [e.p_value for e in edges]

    return PcmciResponse(dag=dag, pValues=p_values)


# ─────────────────────────────────────────────────────────────────────
# Data prep
# ─────────────────────────────────────────────────────────────────────


def _project_and_clean(df: pd.DataFrame, variables: list[str] | tuple[str, ...]) -> pd.DataFrame:
    """Keep only the requested variables, coerce to numeric, drop NaN rows."""
    missing = [v for v in variables if v not in df.columns]
    if missing:
        raise PcmciEngineError(f"dataRef is missing required columns: {missing}")
    sub = df[list(variables)].copy()
    for col in sub.columns:
        sub[col] = pd.to_numeric(sub[col], errors="coerce")
    sub = sub.dropna()
    if len(sub) < 8:
        raise PcmciEngineError(
            f"PCMCIplus needs at least 8 clean rows after NaN removal; got {len(sub)}"
        )
    return sub


# ─────────────────────────────────────────────────────────────────────
# Tigramite invocation
# ─────────────────────────────────────────────────────────────────────


def _run_tigramite(
    *,
    df: pd.DataFrame,
    variables: list[str],
    tau_max: int,
    pc_alpha: float,
) -> list[_DiscoveredEdge]:
    """Run PCMCIplus and translate its output into our edge list."""
    try:
        from tigramite import data_processing as pp
        from tigramite.independence_tests.parcorr import ParCorr
        from tigramite.pcmci import PCMCI
    except ImportError as exc:  # pragma: no cover — install-time problem
        raise PcmciEngineError(f"Tigramite not installed: {exc}") from exc

    data = df.to_numpy(dtype=float)
    n_samples, n_vars = data.shape
    if n_vars != len(variables):
        raise PcmciEngineError(
            f"internal: data has {n_vars} cols but {len(variables)} variables requested"
        )

    # Effective tau_max can't exceed n_samples - a safety margin; cap
    # to keep Tigramite from blowing up on tiny test fixtures.
    effective_tau = min(tau_max, max(1, n_samples // 4))

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            dataframe = pp.DataFrame(
                data,
                var_names=list(variables),
                missing_flag=999.0,
            )
            cond_test = ParCorr(significance="analytic")
            pcmci = PCMCI(
                dataframe=dataframe,
                cond_ind_test=cond_test,
                verbosity=0,
            )
            results: dict[str, Any] = pcmci.run_pcmciplus(
                tau_max=effective_tau,
                pc_alpha=pc_alpha,
            )
        except Exception as exc:  # noqa: BLE001
            raise PcmciEngineError(f"PCMCIplus failed: {exc}") from exc

    return _translate_results(results, variables, pc_alpha=pc_alpha)


def _translate_results(
    results: dict[str, Any],
    variables: list[str],
    *,
    pc_alpha: float,
) -> list[_DiscoveredEdge]:
    """Convert Tigramite's `p_matrix` / `graph` into our edge list.

    Tigramite returns:
      - `p_matrix`: shape (n_vars, n_vars, tau_max+1)
      - `graph`: shape (n_vars, n_vars, tau_max+1) of link types
        ('-->','<--','o-o','x-x','')

    For our purposes:
      - lag=0 contemporaneous edges that are '-->' (i.e. i causes j)
      - lag>0 lagged edges that are '-->' (i_{t-lag} causes j_t)
    """
    p_matrix = results.get("p_matrix")
    graph = results.get("graph")
    if p_matrix is None or graph is None:
        return []

    p_matrix = np.asarray(p_matrix)
    graph = np.asarray(graph)
    n_vars = len(variables)
    if p_matrix.shape[0] != n_vars or graph.shape[0] != n_vars:
        return []

    edges: list[_DiscoveredEdge] = []
    tau_dim = p_matrix.shape[2]

    for i in range(n_vars):
        for j in range(n_vars):
            for tau in range(tau_dim):
                link = str(graph[i, j, tau])
                if link != "-->":
                    continue
                # Skip self-loops at lag 0; PCMCIplus shouldn't emit them
                # but defend anyway.
                if i == j and tau == 0:
                    continue
                p = float(p_matrix[i, j, tau])
                if not (0.0 <= p <= 1.0):
                    continue
                if p > pc_alpha:
                    continue
                edges.append(
                    _DiscoveredEdge(
                        from_var=variables[i],
                        to_var=variables[j],
                        lag=int(tau),
                        p_value=p,
                    )
                )

    return edges


# ─────────────────────────────────────────────────────────────────────
# Edge → DAG mapping
# ─────────────────────────────────────────────────────────────────────


def _edges_to_dag(variables: list[str] | tuple[str, ...], edges: list[_DiscoveredEdge]) -> CausalDag:
    """Render PCMCIplus's lagged edge set into our `CausalDag` shape.

    We collapse lag-space into a single edge per (from, to) pair, taking
    the *smallest* p-value across all lags. The rationale string records
    the winning lag.
    """
    seen: dict[tuple[str, str], _DiscoveredEdge] = {}
    for edge in edges:
        key = (edge.from_var, edge.to_var)
        existing = seen.get(key)
        if existing is None or edge.p_value < existing.p_value:
            seen[key] = edge

    dag_edges = [
        DagEdge(
            **{
                "from": e.from_var,
                "to": e.to_var,
                "rationale": f"lag={e.lag}, p={e.p_value:.4f}",
            }
        )
        for e in seen.values()
    ]

    return CausalDag(
        nodes=list(variables),
        edges=dag_edges,
        candidateEdges=[],
    )
