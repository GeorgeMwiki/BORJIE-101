# Scientific-Discovery Python Sidecar — Wire Spec

> Implementation lives in `services/scientific-discovery-sidecar/`.
> This file is the **frozen contract** between the TypeScript clients
> in `packages/scientific-discovery/src/causal-fusion/*` and the
> FastAPI sidecar.

## Service identity

- Name: `scientific-discovery-sidecar`
- Default URL (env): `DISCOVERY_SIDECAR_URL=http://localhost:8000`
- Port: `8000`
- Runtime: Python 3.12 + FastAPI + uvicorn
- Heavy deps: DoWhy, Tigramite, scikit-learn, EconML, numpy, pandas
- Image base: `python:3.12-slim-bookworm`

## Endpoints

### `GET /health`

Liveness probe. No body.

Response `200 OK`:

```json
{
  "ok": true,
  "version": "0.1.0",
  "service": "scientific-discovery-sidecar",
  "checks": {
    "dowhy": "loaded",
    "tigramite": "loaded"
  }
}
```

### `POST /dowhy/refute`

Run DoWhy refutation battery on a candidate DAG.

Request body (matches TS `SidecarRefuteRequest`):

```json
{
  "dag": {
    "nodes": ["rent", "vacancy", "season"],
    "edges": [
      {"from": "rent", "to": "vacancy", "rationale": "price elasticity"},
      {"from": "season", "to": "vacancy"}
    ],
    "candidateEdges": []
  },
  "dataRef": "inline://<csv-or-rows>",
  "treatment": "rent",
  "outcome": "vacancy",
  "estimator": "dowhy_linear"
}
```

`dataRef` is one of:

- `inline://...` followed by a base64-encoded CSV body
- `csv://<absolute-path>` to a CSV file the sidecar can read
- `parquet://<absolute-path>` to a parquet file
- `rows://<json-array-of-objects>` for tiny test fixtures

The sidecar resolves it, loads into a pandas DataFrame, builds a
DoWhy `CausalModel` from `dag.edges`, runs:

1. `random_common_cause` (placebo)
2. `bootstrap_refuter` (subset stability)
3. `dummy_outcome_refuter` (unobserved-confounder approximation)
4. Optional conditional-independence test (kept out of MVP)

Each refuter returns a p-value-like number; the sidecar normalises to
`[0,1]` where `1.0 = ATE survived the refutation cleanly`.

Response `200 OK` (matches TS `SidecarRefuteResponse`):

```json
{
  "scores": {
    "placebo": 0.92,
    "bootstrap": 0.88,
    "unobservedConfounder": 0.71,
    "conditionalIndependence": null
  },
  "diagnostics": "ATE=-0.24; placebo=0.92; bootstrap=0.88; dummy=0.71"
}
```

### `POST /tigramite/pcmciplus`

Run PCMCIplus time-series causal discovery.

Request body (matches TS `SidecarPcmciRequest`):

```json
{
  "variables": ["rent", "vacancy", "season"],
  "dataRef": "inline://<csv-or-rows>",
  "tauMax": 5
}
```

Defaults: `pc_alpha=0.05`, `parents_or_neighbors=ParCorr`,
`tau_min=0`, `tau_max=5`.

Response `200 OK` (matches TS `SidecarPcmciResponse`):

```json
{
  "dag": {
    "nodes": ["rent", "vacancy", "season"],
    "edges": [
      {"from": "season", "to": "vacancy", "rationale": "lag=1, p=0.012"}
    ],
    "candidateEdges": []
  },
  "pValues": [0.012]
}
```

## Error model

- Schema-invalid request → `422 Unprocessable Entity` with Pydantic
  error body.
- Engine crash (DoWhy / Tigramite raised) → `500 Internal Server Error`
  with `{ "detail": "<message>", "engine": "dowhy"|"tigramite" }`.
- Health check failure → `503 Service Unavailable`.

The TS clients (`refutation-client.ts`, `pcmciplus-client.ts`) wrap
these into `SidecarHttpError`, `SidecarSchemaError`, and
`SidecarUnavailableError`.

## Versioning

Bump `version` in `app/main.py` whenever the wire shape changes. The
TS clients ignore it for now — but the planned `health()` API surfaces
it for observability dashboards.
