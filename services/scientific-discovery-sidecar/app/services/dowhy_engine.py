"""DoWhy refutation engine.

Pipeline:

  1. Resolve `dataRef` → pandas DataFrame
  2. Build a DoWhy `CausalModel` from `dag.edges`, declaring
     `treatment` and `outcome`
  3. Identify estimand
  4. Estimate ATE using the requested estimator
  5. Run three refutation tests:
       - random_common_cause   (placebo)
       - bootstrap_refuter     (subset stability)
       - dummy_outcome_refuter (unobserved-confounder approximation)
  6. Normalise each refuter's verdict into a `[0,1]` score where:
        1.0 = ATE was robust to the perturbation (DAG survived)
        0.0 = ATE collapsed under the perturbation (DAG dropped)

The score uses the refuter's reported `p_value` when available
(it is the prob-of-no-effect under the perturbation; high p_value
under placebo / dummy is a *good* sign, since we expect no effect
after randomising the cause; under bootstrap a high p_value means
the original estimate sits inside the bootstrap CI). When the
underlying refuter doesn't report a p_value we fall back to a
relative-effect-shift metric.
"""

from __future__ import annotations

import logging
import math
import warnings
from dataclasses import dataclass
from typing import Any

import networkx as nx
import pandas as pd

from app.models.schemas import (
    CausalDag,
    RefutationScores,
    RefuteRequest,
    RefuteResponse,
)
from app.services.data_loader import load_dataframe

logger = logging.getLogger(__name__)


class DoWhyEngineError(RuntimeError):
    """Raised when DoWhy fails to build a model or run a refuter."""


# DoWhy → DoWhy method-name map (CausalModel.estimate_effect).
_METHOD_BY_ESTIMATOR: dict[str, str] = {
    "dowhy_linear": "backdoor.linear_regression",
    "dml": "backdoor.econml.dml.LinearDML",
    "causal_forest": "backdoor.econml.dml.CausalForestDML",
    # The non-DoWhy estimators still need *some* DoWhy method to
    # produce an estimate for refutation. Default to linear.
    "causalpy_synthetic_control": "backdoor.linear_regression",
    "causalpy_its": "backdoor.linear_regression",
    "pcmciplus": "backdoor.linear_regression",
}


@dataclass(frozen=True)
class _RefuterOutcome:
    """Normalised single-refuter outcome."""

    score: float
    diagnostic: str


def run_refutation(
    req: RefuteRequest,
    *,
    max_rows: int,
    bootstrap_samples: int,
    dowhy_simulations: int,
) -> RefuteResponse:
    """Top-level entry point.

    Args:
        req: Validated request.
        max_rows: Hard cap on DataFrame size (DoS guard).
        bootstrap_samples: Sample budget for `bootstrap_refuter`.
        dowhy_simulations: Simulation budget for placebo + dummy refuters.
    """
    df = load_dataframe(req.dataRef, max_rows=max_rows)
    _validate_columns_present(df, req)

    method_name = _METHOD_BY_ESTIMATOR.get(req.estimator, "backdoor.linear_regression")

    # DoWhy + statsmodels are *noisy* — suppress their warnings so the
    # diagnostics field carries signal, not boilerplate.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model, identified_estimand, estimate = _fit_dowhy_model(
            df=df,
            dag=req.dag,
            treatment=req.treatment,
            outcome=req.outcome,
            method_name=method_name,
        )

        placebo = _run_placebo(model, identified_estimand, estimate, dowhy_simulations)
        bootstrap = _run_bootstrap(model, identified_estimand, estimate, bootstrap_samples)
        dummy = _run_dummy_outcome(model, identified_estimand, estimate, dowhy_simulations)

    diagnostics = (
        f"estimator={req.estimator}; method={method_name}; "
        f"ATE={getattr(estimate, 'value', float('nan')):.4f}; "
        f"{placebo.diagnostic}; {bootstrap.diagnostic}; {dummy.diagnostic}"
    )

    return RefuteResponse(
        scores=RefutationScores(
            placebo=placebo.score,
            bootstrap=bootstrap.score,
            unobservedConfounder=dummy.score,
            conditionalIndependence=None,
        ),
        diagnostics=diagnostics,
    )


# ─────────────────────────────────────────────────────────────────────
# DoWhy model fitting
# ─────────────────────────────────────────────────────────────────────


def _validate_columns_present(df: pd.DataFrame, req: RefuteRequest) -> None:
    cols = set(df.columns)
    missing = []
    for var in (req.treatment, req.outcome, *req.dag.nodes):
        if var not in cols:
            missing.append(var)
    if missing:
        raise DoWhyEngineError(
            f"dataRef is missing required columns: {sorted(set(missing))}"
        )


def _fit_dowhy_model(
    *,
    df: pd.DataFrame,
    dag: CausalDag,
    treatment: str,
    outcome: str,
    method_name: str,
) -> tuple[Any, Any, Any]:
    """Build a DoWhy CausalModel + identify + estimate.

    Returns (model, identified_estimand, estimate).
    """
    try:
        from dowhy import CausalModel
    except ImportError as exc:  # pragma: no cover — install-time problem
        raise DoWhyEngineError(f"DoWhy not installed: {exc}") from exc

    graph_gml = _dag_to_gml(dag)

    try:
        model = CausalModel(
            data=df,
            treatment=treatment,
            outcome=outcome,
            graph=graph_gml,
        )
    except Exception as exc:  # noqa: BLE001
        raise DoWhyEngineError(f"DoWhy CausalModel build failed: {exc}") from exc

    try:
        identified_estimand = model.identify_effect(proceed_when_unidentifiable=True)
    except Exception as exc:  # noqa: BLE001
        raise DoWhyEngineError(f"DoWhy identify_effect failed: {exc}") from exc

    try:
        estimate = model.estimate_effect(
            identified_estimand,
            method_name=method_name,
        )
    except Exception as exc:  # noqa: BLE001
        # Some estimators (e.g. EconML DML) need extra deps; fall back
        # to linear regression so the refutation battery still runs.
        if method_name != "backdoor.linear_regression":
            logger.warning(
                "estimator %s failed (%s) — falling back to linear regression",
                method_name,
                exc,
            )
            try:
                estimate = model.estimate_effect(
                    identified_estimand,
                    method_name="backdoor.linear_regression",
                )
            except Exception as inner_exc:  # noqa: BLE001
                raise DoWhyEngineError(
                    f"DoWhy estimate_effect failed after fallback: {inner_exc}"
                ) from inner_exc
        else:
            raise DoWhyEngineError(f"DoWhy estimate_effect failed: {exc}") from exc

    return model, identified_estimand, estimate


def _dag_to_gml(dag: CausalDag) -> str:
    """Render the DAG as a GML graph string DoWhy can parse.

    DoWhy's GML parser is strict; we keep node ids quoted and use the
    standard `directed 1` flag.
    """
    g = nx.DiGraph()
    for node in dag.nodes:
        g.add_node(node)
    for edge in dag.edges:
        g.add_edge(edge.from_node, edge.to_node)

    lines: list[str] = ["graph [", "  directed 1"]
    # GML requires integer ids — keep a node->id map so edges line up.
    id_by_name: dict[str, int] = {}
    for idx, name in enumerate(g.nodes):
        id_by_name[name] = idx
        lines.append("  node [")
        lines.append(f"    id {idx}")
        lines.append(f'    label "{name}"')
        lines.append("  ]")
    for src, dst in g.edges:
        lines.append("  edge [")
        lines.append(f"    source {id_by_name[src]}")
        lines.append(f"    target {id_by_name[dst]}")
        lines.append("  ]")
    lines.append("]")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────
# Refuter wrappers — each returns a [0,1] score where higher = better.
# ─────────────────────────────────────────────────────────────────────


def _run_placebo(model: Any, estimand: Any, estimate: Any, num_simulations: int) -> _RefuterOutcome:
    """random_common_cause: add a noise variable and re-estimate.

    A *good* result is the new estimate being statistically
    indistinguishable from the original (the noise variable shouldn't
    affect ATE). DoWhy reports a p_value where a *high* p_value means
    "no rejection of the null that the new estimate matches".
    """
    try:
        refuter = model.refute_estimate(
            estimand,
            estimate,
            method_name="random_common_cause",
            num_simulations=num_simulations,
        )
    except Exception as exc:  # noqa: BLE001
        return _RefuterOutcome(score=0.0, diagnostic=f"placebo=ERR({exc})")

    score = _extract_high_p_score(refuter, estimate)
    return _RefuterOutcome(
        score=score,
        diagnostic=f"placebo={score:.3f}",
    )


def _run_bootstrap(
    model: Any, estimand: Any, estimate: Any, num_simulations: int
) -> _RefuterOutcome:
    """bootstrap_refuter: resample rows and re-estimate.

    Stable estimate ⇒ small spread across bootstrap samples ⇒
    *small* relative shift between new estimate and original ⇒
    high score.
    """
    try:
        refuter = model.refute_estimate(
            estimand,
            estimate,
            method_name="bootstrap_refuter",
            num_simulations=num_simulations,
        )
    except Exception as exc:  # noqa: BLE001
        return _RefuterOutcome(score=0.0, diagnostic=f"bootstrap=ERR({exc})")

    score = _extract_stability_score(refuter, estimate)
    return _RefuterOutcome(
        score=score,
        diagnostic=f"bootstrap={score:.3f}",
    )


def _run_dummy_outcome(
    model: Any, estimand: Any, estimate: Any, num_simulations: int
) -> _RefuterOutcome:
    """dummy_outcome_refuter: simulate an unobserved confounder by
    replacing outcome with random noise; new estimate should be ~0.

    DoWhy returns a p_value where *high* p_value means we cannot
    reject the null "new estimate is zero".
    """
    try:
        refuter = model.refute_estimate(
            estimand,
            estimate,
            method_name="dummy_outcome_refuter",
            num_simulations=num_simulations,
        )
    except Exception as exc:  # noqa: BLE001
        return _RefuterOutcome(score=0.0, diagnostic=f"dummy=ERR({exc})")

    # `dummy_outcome_refuter` can return a list of results — pick the first.
    primary = refuter[0] if isinstance(refuter, list) and refuter else refuter

    score = _extract_zero_effect_score(primary, estimate)
    return _RefuterOutcome(
        score=score,
        diagnostic=f"unobservedConfounder={score:.3f}",
    )


# ─────────────────────────────────────────────────────────────────────
# Score extraction helpers
# ─────────────────────────────────────────────────────────────────────


def _safe_float(value: Any) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def _clamp_unit(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x


def _refuter_p_value(refuter: Any) -> float | None:
    """Pull a p_value off a DoWhy refuter, regardless of where it hangs.

    Different DoWhy versions expose it as either a top-level attribute
    or under a `refutation_result` dict.
    """
    direct = _safe_float(getattr(refuter, "p_value", None))
    if direct is not None:
        return direct
    result_obj = getattr(refuter, "refutation_result", None)
    if isinstance(result_obj, dict):
        return _safe_float(result_obj.get("p_value"))
    return None


def _extract_high_p_score(refuter: Any, estimate: Any) -> float:
    """For placebo / dummy refuters: high p_value = DAG survived."""
    p_value = _refuter_p_value(refuter)
    if p_value is not None:
        return _clamp_unit(p_value)

    # Fallback: relative shift in ATE — small shift = good.
    return _extract_stability_score(refuter, estimate)


def _extract_zero_effect_score(refuter: Any, estimate: Any) -> float:
    """For dummy_outcome: a high p_value supports "no effect" — DAG survived.

    Fallback uses |new_estimate| / (|orig_estimate| + eps); small
    new-estimate ⇒ high score.
    """
    p_value = _refuter_p_value(refuter)
    if p_value is not None:
        return _clamp_unit(p_value)

    new_val = _safe_float(getattr(refuter, "new_effect", None))
    orig_val = _safe_float(getattr(estimate, "value", None))
    if new_val is None or orig_val is None:
        return 0.5  # neutral when nothing measurable came back
    denom = abs(orig_val) + 1e-9
    ratio = abs(new_val) / denom
    # Smaller ratio = better; map [0, 1] → [1, 0], clip at 0.
    return _clamp_unit(1.0 - min(ratio, 1.0))


def _extract_stability_score(refuter: Any, estimate: Any) -> float:
    """For bootstrap: small |new - orig| / |orig| ⇒ high score."""
    new_val = _safe_float(getattr(refuter, "new_effect", None))
    orig_val = _safe_float(getattr(estimate, "value", None))
    if new_val is None or orig_val is None:
        # Try p_value as a last resort.
        p_value = _safe_float(getattr(refuter, "p_value", None))
        return _clamp_unit(p_value) if p_value is not None else 0.5

    denom = abs(orig_val) + 1e-9
    shift = abs(new_val - orig_val) / denom
    # shift==0 → score 1.0, shift==1 (estimate doubled) → score 0.0.
    return _clamp_unit(1.0 - min(shift, 1.0))
