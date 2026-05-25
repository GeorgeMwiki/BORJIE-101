# scientific-discovery-sidecar

FastAPI service that powers the causal-inference back end for
`@borjie/scientific-discovery`.

The TypeScript clients in
`packages/scientific-discovery/src/causal-fusion/` (`refutation-client.ts`,
`pcmciplus-client.ts`) speak HTTP to this service; they never import
Python.

## Endpoints

| Method | Path                    | Purpose                                                  |
|--------|-------------------------|----------------------------------------------------------|
| GET    | `/health`               | Liveness + dependency status                             |
| POST   | `/dowhy/refute`         | DoWhy refutation battery (placebo + bootstrap + dummy)   |
| POST   | `/tigramite/pcmciplus`  | PCMCIplus time-series causal discovery                   |

The wire contract lives at
`packages/scientific-discovery/src/sidecar/python-sidecar-spec.md`.

## Local dev

Without Docker:

```bash
cd services/scientific-discovery-sidecar
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

With Docker:

```bash
cd services/scientific-discovery-sidecar
docker compose up --build
```

Either way, point the TS client at the sidecar:

```bash
export DISCOVERY_SIDECAR_URL=http://localhost:8000
```

## Tests

```bash
pip install -r requirements.txt
pytest -q
```

Tests that exercise the real DoWhy / Tigramite engines are
auto-skipped when those packages aren't installed; the schema +
data-loader + helper tests always run.

## Environment variables

| Var                                       | Default     | Purpose                                |
|-------------------------------------------|-------------|----------------------------------------|
| `DISCOVERY_SIDECAR_HOST`                  | `0.0.0.0`   | uvicorn bind host                      |
| `DISCOVERY_SIDECAR_PORT`                  | `8000`      | uvicorn port                           |
| `DISCOVERY_SIDECAR_LOG_LEVEL`             | `info`      | Root logger level                      |
| `DISCOVERY_SIDECAR_BOOTSTRAP_SAMPLES`     | `50`        | bootstrap_refuter sample budget        |
| `DISCOVERY_SIDECAR_DOWHY_SIMULATIONS`     | `50`        | placebo + dummy refuter budget         |
| `DISCOVERY_SIDECAR_PCMCI_TAU_MAX`         | `5`         | Default max lag for PCMCIplus          |
| `DISCOVERY_SIDECAR_PCMCI_ALPHA`           | `0.05`      | Default significance threshold         |
| `DISCOVERY_SIDECAR_MAX_ROWS`              | `500000`    | Hard cap on dataRef row count          |
| `DISCOVERY_SIDECAR_CORS_ORIGINS`          | _(empty)_   | CSV list of allowed CORS origins       |

## Architecture

```
app/
  main.py              FastAPI app factory + lifespan
  settings.py          env-driven Settings dataclass
  routes/
    health.py          GET /health
    dowhy_refute.py    POST /dowhy/refute
    pcmciplus.py       POST /tigramite/pcmciplus
  models/
    schemas.py         Pydantic mirrors of the TS Zod wire types
  services/
    data_loader.py     dataRef:// scheme resolver → pandas DataFrame
    dowhy_engine.py    DoWhy CausalModel + refutation battery
    pcmciplus_engine.py  Tigramite PCMCIplus driver
tests/
  conftest.py          shared FastAPI TestClient + synthetic data
  test_health.py
  test_dowhy_refute.py
  test_pcmciplus.py
  test_data_loader.py
```

## dataRef scheme

The TS client passes a `dataRef` string. The sidecar resolves it:

- `inline://<csv-text-or-base64>` — small ad-hoc CSV
- `rows://<json-array-of-objects>` — for tests / tiny fixtures
- `csv://<absolute-path>` — local CSV file
- `parquet://<absolute-path>` — local parquet file

URL schemes are intentionally NOT supported — the sidecar must never
fetch over the network on behalf of a caller.

## Refutation score normalisation

DoWhy refuters report assorted scalars (`p_value`, `new_effect`,
`refutation_result`). We normalise to `[0, 1]` where **higher = the
DAG survived the test more confidently**:

- **placebo** (`random_common_cause`) — high `p_value` means adding a
  noise variable did not move the ATE → DAG kept.
- **bootstrap** (`bootstrap_refuter`) — small `|new − orig| / |orig|`
  means the estimate is stable under resampling → DAG kept.
- **unobservedConfounder** (`dummy_outcome_refuter`) — high `p_value`
  on the dummy outcome means the ATE collapses when we randomise the
  outcome, i.e. the original effect was real → DAG kept.

## PCMCIplus output

Tigramite emits a `p_matrix` + `graph` over `(n_vars, n_vars,
tau_max+1)`. We:

1. Keep only edges with link type `-->` and `p ≤ pc_alpha`.
2. Collapse lag-space — one `(from, to)` edge per pair, taking the
   smallest p-value. The losing lag is recorded in the edge's
   `rationale` field, e.g. `"lag=2, p=0.0123"`.
