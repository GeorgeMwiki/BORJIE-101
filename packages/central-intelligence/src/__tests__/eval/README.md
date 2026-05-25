# Nyumba Mind kernel — regression eval harness

A scenario-level regression suite for the Borjie Nyumba Mind
kernel. The unit tests next to this folder prove specific code paths
work; this harness drives a curated corpus of realistic user requests
through `composeSovereign()` end-to-end and tracks aggregate metrics
(mean confidence, drift rate, refusal rate, p95 latency, gate
verdicts) so that a regression — e.g. a policy gate change that
starts refusing too much — surfaces as a CI failure.

The harness is fully deterministic and CI-runnable: no external
services, no real Anthropic calls, no Postgres. Stub sensors return
canned text; in-memory sinks record drift / cot / provenance.

## Layout

```
__tests__/eval/
  scenarios.ts     # corpus — typed, curated input scenarios
  runner.ts        # runEvalScenario / runEvalSuite + aggregate summary
  baseline.json    # checked-in metrics from the latest passing run
  eval.test.ts     # vitest entry point — runs corpus + diffs baseline
  README.md
```

## How it works

Each scenario carries:

- a `ThoughtRequest` (the question the kernel sees),
- a `stubResponse` (what the stub sensor returns), and
- an `expected` clause (decision kind, gate verdicts, text content,
  confidence floor, drift event count).

`runEvalScenario(scenario)` builds a fresh `composeSovereign()` with
the stub sensor and in-memory sinks, calls `kernel.think(request)`,
then runs every assertion in `expected.*` and captures metrics into an
`EvalResult`. `runEvalSuite(corpus)` is a serial loop over the corpus
that produces an `EvalSummary` of aggregate metrics.

The vitest entry point (`eval.test.ts`) does two things:

1. Asserts every scenario passes its individual `expected.*` clauses.
2. Compares the live summary to `baseline.json` and fails when any
   threshold is exceeded.

## Corpus shape (222 scenarios)

The corpus is partitioned into the following category arrays inside
`scenarios.ts`. The first five blocks are the original 32-scenario
smoke test; everything below is the regression-suite expansion.

| Block                      | Count | Purpose                                                              |
| -------------------------- | ----- | -------------------------------------------------------------------- |
| TENANT_SCENARIOS           |   4   | Resident-app baseline coverage                                        |
| OWNER_SCENARIOS            |   4   | Owner-portal baseline coverage                                        |
| ESTATE_SCENARIOS           |   4   | Estate-manager-app baseline coverage                                  |
| HQ_SCENARIOS               |   4   | Platform-HQ baseline coverage                                         |
| REFUSAL_SCENARIOS_ORIGINAL |   5   | Original inviolable refusals                                          |
| DRIFT_SCENARIOS            |   3   | Original drift signals                                                |
| POLICY_SCENARIOS           |   3   | Original policy-gate softens                                          |
| CONFIDENCE_SCENARIOS       |   3   | Original confidence-vector probes                                     |
| MULTILANG_SCENARIOS        |   2   | Original Swahili / mixed-language                                     |
| HAPPY_TENANT_RESIDENT      |  10   | Per-persona happy paths — resident concierge                          |
| HAPPY_ESTATE_MANAGER       |  10   | Per-persona happy paths — estate operations lead                      |
| HAPPY_OWNER_ADVISOR        |  10   | Per-persona happy paths — owner / portfolio voice                     |
| HAPPY_ORG_ADMIN            |  10   | Per-persona happy paths — agency admin (`admin-portal` surface)       |
| HAPPY_SOVEREIGN_ADMIN      |  10   | Per-persona happy paths — Nyumba Mind for HQ                          |
| HAPPY_MARKETING_GUIDE      |  10   | Per-persona happy paths — public marketing surface                    |
| HAPPY_CLASSROOM_TUTOR      |  10   | Per-persona happy paths — classroom tutor                             |
| REFUSAL_EXPANSION          |  30   | Adversarial bulk-PII / cross-tenant / authority / autonomy / public  |
| DRIFT_EXPANSION            |  20   | First-person loss, taboos, buzzwords, fabrication patterns           |
| POLICY_EXPANSION           |  15   | PII redaction, uncited %/money, regulatory-hedge insertion            |
| CONFIDENCE_EXPANSION       |  15   | High / low / ambiguous-stakes hedging                                 |
| MULTILANG_EXPANSION        |  10   | Swahili, code-switch, Sheng, Dholuo                                   |
| MULTITURN_SCENARIOS        |  15   | Multi-turn recall / correction / stakes-escalation                    |
| CAPABILITY_SCENARIOS       |  15   | Domain reasoning (HHI, vacancy clustering, arrears ladder, persona-routing) |
|                            |       |                                                                      |
| **Total**                  | **222** |                                                                    |

## Adding a scenario

Open `scenarios.ts`, copy any existing entry, change:

- `id` — stable, dot-separated, do NOT renumber once shipped.
- `description` — one line of intent.
- `category` — one of `tenant | owner | estate | hq | refusal | drift
  | policy | confidence | multilang | happy | multi-turn | capability`.
- `request` — the `ThoughtRequest` to drive through the kernel.
- `stubResponse.text` — exactly what the stub sensor returns.
- `expected` — the assertions the runner enforces:

  | Field                    | Meaning                                                                       |
  | ------------------------ | ----------------------------------------------------------------------------- |
  | `kind`                   | `'answer' \| 'softened' \| 'refusal'` — the decision shape we expect          |
  | `minConfidence`          | overall-confidence floor (only on non-refusal)                                |
  | `maxLatencyMs`           | wall-clock budget for `kernel.think()`                                        |
  | `mustContain`            | every string here must appear in the redacted output                          |
  | `mustNotContain`         | none of these may appear in the output                                        |
  | `expectedGate`           | `'inviolable' \| 'drift' \| 'policy' \| 'cognitive-load'` — which gate acted  |
  | `expectedDriftCount`     | minimum drift events recorded during the turn                                 |
  | `expectedSubstring`      | single-substring sugar for capability scenarios (must appear)                 |
  | `expectedNotSubstring`   | single-substring sugar for capability scenarios (must NOT appear)             |

Multi-turn scenarios additionally carry `priorTurns` — an
`Array<{role: 'user' | 'assistant'; content: string}>`. The runner
surfaces these via `priorTurnsLoader` so the kernel mixes them into
the sensor call args identical to production.

Append the new scenario into the appropriate category array. Re-run
the suite (see below); when it passes, refresh the baseline.

## Refreshing the baseline

After a deliberate kernel change you expect to shift the aggregate
numbers, regenerate the baseline:

```bash
EVAL_WRITE_BASELINE=1 pnpm -C packages/central-intelligence test
```

This writes `baseline.next.json` next to `baseline.json`. Diff the
two; when satisfied, `mv baseline.next.json baseline.json` and
commit.

To skip the baseline diff for a run (e.g. on a fresh clone before
the baseline has stabilised):

```bash
EVAL_NO_BASELINE=1 pnpm -C packages/central-intelligence test
```

If `baseline.json` does not yet exist (first run on a fresh clone),
the harness writes it automatically and does not assert against it
that turn.

## Regression thresholds

The thresholds the suite enforces (live in `eval.test.ts`):

| Metric              | Bound                                  |
| ------------------- | -------------------------------------- |
| `meanConfidence`    | may not drop by more than `0.05`       |
| `refusalRate`       | may not move by more than `0.10`       |
| `driftRate`         | may not move by more than `0.10`       |
| `p95LatencyMs`      | may not rise above `2x` baseline       |

These are intentionally slack while the harness matures. Tighten them
once the corpus and the kernel both stabilise.

## Running

The harness is a single vitest file and is included in the package's
default test run:

```bash
pnpm -C packages/central-intelligence test
```

Filter to just the eval test:

```bash
pnpm -C packages/central-intelligence test src/__tests__/eval/eval.test.ts
```

## Continuous integration

The harness runs on every PR via `.github/workflows/kernel-eval.yml`.
The workflow uses the deterministic stub sensor (no Anthropic / no
network) so it is fast and free; failures block merges so kernel
regressions surface on the PR diff.
