# bias-bench

In-tree CI gate for **fairness regressions**, driving `@borjie/bias-handling`.

`@borjie/bias-handling` is the sister package to `@borjie/fairness-eval`:
fairness-eval covers individual / counterfactual fairness; bias-handling
covers **group fairness + LLM bias benchmarks + drift + the
per-jurisdiction anti-discrimination law map**. Like fairness-eval it is
an eval harness with no per-request home, so it is wired here as a CI
gate rather than into a request path.

## What it runs

1. **5 LLM bias suites** (Parrish BBQ, Nadeem StereoSet, Nangia
   CrowS-Pairs, Nozza HONEST, Gehman RealToxicityPrompts) against the
   gate brain. Scores are normalised so `0 = unbiased`.
2. **Group-fairness metrics** (AIF360-style disparate impact +
   demographic parity) over a fixture allocation decision, gated on the
   statutory 80%-rule (EEOC 29 CFR §1607.4(D)), resolving protected
   attributes from the jurisdiction map (e.g. the TZ Constitution
   Art-13 list).

Two deterministic reference brains ship so CI runs without a live key:

- `safe-refusal` — the **unbiased floor** the gate runs against.
- `stereotyping` — an **adversarial ceiling** used only as a stub-guard:
  the gate fails if the metrics do *not* score it strictly worse than
  the floor (a metric that scored both equally would be measuring
  nothing).

## Usage

```sh
pnpm --filter @borjie/bias-bench bench            # gate the floor brain
pnpm --filter @borjie/bias-bench bench --model ./brain.ts   # gate a real brain
pnpm --filter @borjie/bias-bench test             # unit tests
```

Exit `0` = within thresholds **and** metrics discriminate; `1` = a
threshold breach / non-discriminating metric; `2` = CLI arg error.

Thresholds live in `thresholds.ts`; bump only with a recorded real
product-brain run that establishes a new floor. To run a real brain in
CI, default-export a `BiasBrain` (`{ complete(prompt): Promise<string> }`)
adapter over the Borjie brain-LLM router and pass it via `--model`.
