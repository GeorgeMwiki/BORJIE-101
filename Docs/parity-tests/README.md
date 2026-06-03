# Parity-tests — eval-ops release gates (LP-22)

Deterministic, seeded release-gate suites that emit dated Markdown reports
and exit non-zero on failure so CI can block a regression. Ported in shape
from LITFIN's `scripts/run-{capability-evals,sota-validation}/run-all`.

## Suites

| Suite        | CLI                                          | Output dir                                  |
| ------------ | -------------------------------------------- | ------------------------------------------- |
| `capability` | `tsx scripts/run-capability-evals/run-all.ts` | `Docs/parity-tests/capability/results/<date>/` |
| `sota`       | `tsx scripts/run-sota-validation/run-all.ts`  | `Docs/parity-tests/sota/results/<date>/`       |

Each writes one `<runner-id>.md` per runner plus a `_suite.md` index. The
suite verdict drives the exit code: **0** all pass, **1** any fail, **2**
bad args / fatal.

## Determinism

Runners draw from a seeded `mulberry32` PRNG
(`scripts/eval-ops-lib/seeded-random.ts`). Same `--seed` → byte-identical
metrics; the only run-to-run variation is the wall-clock `Duration` line,
which is excluded from the machine-readable verdict block. This makes a
report diff meaningful and CI failures reproducible.

```bash
tsx scripts/run-capability-evals/run-all.ts --seed 20260603
tsx scripts/run-sota-validation/run-all.ts  --seed 1337 --only latency-slo
```

## Why the dated dirs are git-ignored

The `<date>/` report directories are regenerated on every run — they are
build artifacts, not source. `.gitignore` ignores `*/results/20*/` while
keeping this README and each `results/.gitkeep` tracked.

## Related gates

- `scripts/deploy-preflight.mjs` — cron ↔ handler coverage (every k8s
  `CronJob` maps to a real `services/<name>` worker and vice-versa).
- `packages/observability` model-card renderer — Mitchell et al. 2019
  card body (intended use, metrics, fairness slices) with a four-fifths
  fairness gate.
- `scripts/audit-model-card-coverage.mjs` — checks card-file *existence*
  per jurisdiction (the complementary coverage auditor).
