# PMS-bench-1

**Internal vertical benchmark suite for Borjie sub-MDs.**

Inspired by τ2-bench. 50 mining-estate operations tasks across 5 scenarios, scored with `pass^k` so a flaky sub-MD can't game us with one lucky run.

## Methodology

For each task fixture, we:

1. Spawn `k` independent runs of the sub-MD against the same fixture (default `k=5`).
2. Each run is scored by 4 scorers:
   - **action-correctness** — did the MD pick the right tool?
   - **escalation-correctness** — did the MD escalate at the right point?
   - **communication-quality** — LLM-judged owner/counterparty comms quality.
   - **cost-efficiency** — resolution-quality / $ spent.
3. A run is a "pass" iff its weighted composite score `>= 0.80`.
4. The task passes if `>= ceil(k * 0.6)` runs pass (i.e. ≤2 failures out of 5).

This is the `pass^k` metric: it stresses tail behaviour, not just averages.

## Scenarios + task counts

| Scenario             | Tasks | Sub-MDs exercised             |
|----------------------|-------|-------------------------------|
| arrears-triage       | 10    | royalty.chaser                |
| maintenance-dispatch | 10    | maintenance.dispatch          |
| kra-filing           | 10    | tra.filing_assistant          |
| lease-renewal        | 10    | offtake.coordinator           |
| complaint-triage     | 10    | complaint.triage              |
| **TOTAL**            | **50**|                               |

The scenario directory names (`arrears-triage`, `kra-filing`, `lease-renewal`, …)
are stable runner keys wired into the sub-MD adapter, the cost-efficiency
budget map and the test suite. The *content* of every fixture is mining-estate
domain (royalty defaults, offtake renewals, TRA royalty returns, equipment
maintenance, site grievances) — only the keys are held fixed.

## Fixture shape

Each task is a YAML file in `tasks/<scenario>/task-NNN.yaml` with:

```yaml
id: arrears-triage-001
scenario: arrears-triage
title: '12-day outstanding royalty, first-time default'
context:
  counterparty:
    id: cpty-001
    name: 'Asha Mwakasege'
    outstanding_days: 12
    history: first-default
  asset:
    id: site-001
    zone: 'Geita Zone'
    pit: 'Pit 4B'
  offtake:
    monthly_royalty_minor: 65000000  # TZS minor units
    currency: TZS
  events:
    - {at: '2026-04-15', kind: 'royalty_return.issued', amount_minor: 65000000}
    - {at: '2026-04-30', kind: 'royalty_return.due', amount_minor: 65000000}
    - {at: '2026-05-12', kind: 'partial_payment', amount_minor: 20000000}
expected_actions:
  - {tool: 'royalty.send_reminder', tone: 'firm-but-empathetic'}
  - {tool: 'royalty.propose_payment_plan', max_installments: 3}
expected_escalation: false
scorer_weights:
  action-correctness: 0.4
  escalation-correctness: 0.2
  communication-quality: 0.3
  cost-efficiency: 0.1
```

## Running

```
pnpm pms-bench:run                  # all scenarios
pnpm pms-bench:run -- --scenario arrears-triage
pnpm pms-bench:run -- --k 3         # 3 runs per task (faster)
```

Output: `evals/pms-bench-1/reports/<timestamp>.md` with per-task pass/fail + aggregate pass^k.

## Phase status

- **Phase E.4 (this wave):** scaffolding + fixtures + scorers + runner skeleton. Real LLM runs are out of scope for this wave.
- **Phase E.5:** actual runs against the live sub-MD population; CI gate that publishes the markdown report on every PR touching `packages/central-intelligence/`.
