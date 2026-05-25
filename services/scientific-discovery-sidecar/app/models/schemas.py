"""Pydantic schemas that mirror the TS-side Zod contracts.

The source of truth is:
  - `packages/scientific-discovery/src/types.ts`
  - `packages/scientific-discovery/src/causal-fusion/refutation-client.ts`
  - `packages/scientific-discovery/src/causal-fusion/pcmciplus-client.ts`
  - `packages/scientific-discovery/src/sidecar/python-sidecar-spec.md`

Field names use camelCase to match the TS Zod wire schemas exactly —
do NOT auto-convert to snake_case here.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ─────────────────────────────────────────────────────────────────────
# Shared DAG primitives
# ─────────────────────────────────────────────────────────────────────


class DagEdge(BaseModel):
    """A single directed edge in a causal DAG."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    from_node: str = Field(..., alias="from", min_length=1)
    to_node: str = Field(..., alias="to", min_length=1)
    rationale: Optional[str] = None


class CandidateEdge(BaseModel):
    """An edge the proposer is uncertain about — the sidecar tests these first."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    from_node: str = Field(..., alias="from", min_length=1)
    to_node: str = Field(..., alias="to", min_length=1)


class CausalDag(BaseModel):
    """DAG over named variables.

    The Zod schema requires `nodes.min(2)`; we mirror that to fail-fast
    on degenerate calls.
    """

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    nodes: list[str] = Field(..., min_length=2)
    edges: list[DagEdge] = Field(default_factory=list)
    candidateEdges: list[CandidateEdge] = Field(default_factory=list)

    @field_validator("nodes")
    @classmethod
    def _no_blank_nodes(cls, v: list[str]) -> list[str]:
        if any(not n.strip() for n in v):
            raise ValueError("nodes must be non-blank")
        return v


# ─────────────────────────────────────────────────────────────────────
# Refutation contract — POST /dowhy/refute
# ─────────────────────────────────────────────────────────────────────


Estimator = Literal[
    "dowhy_linear",
    "dml",
    "causal_forest",
    "causalpy_synthetic_control",
    "causalpy_its",
    "pcmciplus",
]


class RefuteRequest(BaseModel):
    """Request body for POST /dowhy/refute. Mirrors TS `SidecarRefuteRequest`."""

    model_config = ConfigDict(extra="forbid")

    dag: CausalDag
    dataRef: str = Field(..., min_length=1)
    treatment: str = Field(..., min_length=1)
    outcome: str = Field(..., min_length=1)
    estimator: Estimator = "dowhy_linear"


class RefutationScores(BaseModel):
    """Three required + one optional refutation score, all in [0, 1]."""

    model_config = ConfigDict(extra="forbid")

    placebo: float = Field(..., ge=0.0, le=1.0)
    bootstrap: float = Field(..., ge=0.0, le=1.0)
    unobservedConfounder: float = Field(..., ge=0.0, le=1.0)
    conditionalIndependence: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class RefuteResponse(BaseModel):
    """Response for POST /dowhy/refute. Mirrors TS `SidecarRefuteResponse`."""

    model_config = ConfigDict(extra="forbid")

    scores: RefutationScores
    diagnostics: str


# ─────────────────────────────────────────────────────────────────────
# PCMCIplus contract — POST /tigramite/pcmciplus
# ─────────────────────────────────────────────────────────────────────


class PcmciRequest(BaseModel):
    """Request body for POST /tigramite/pcmciplus."""

    model_config = ConfigDict(extra="forbid")

    variables: list[str] = Field(..., min_length=2)
    dataRef: str = Field(..., min_length=1)
    tauMax: int = Field(default=5, ge=0, le=24)

    @field_validator("variables")
    @classmethod
    def _no_blank_vars(cls, v: list[str]) -> list[str]:
        if any(not s.strip() for s in v):
            raise ValueError("variables must be non-blank")
        return v


class PcmciResponse(BaseModel):
    """Response for POST /tigramite/pcmciplus. Mirrors TS `SidecarPcmciResponse`."""

    model_config = ConfigDict(extra="forbid")

    dag: CausalDag
    pValues: list[float] = Field(default_factory=list)

    @field_validator("pValues")
    @classmethod
    def _p_values_in_unit_interval(cls, v: list[float]) -> list[float]:
        for p in v:
            if not (0.0 <= p <= 1.0):
                raise ValueError(f"pValue {p} outside [0,1]")
        return v


# ─────────────────────────────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────────────────────────────


class HealthChecks(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dowhy: Literal["loaded", "missing"]
    tigramite: Literal["loaded", "missing"]


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: bool
    version: str
    service: str
    checks: HealthChecks
