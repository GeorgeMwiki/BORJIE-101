# PMS-bench-1

**Internal vertical benchmark suite for Borjie sub-MDs.**

Inspired by τ2-bench. 50 property-management tasks across 5 scenarios, scored with `pass^k` so a flaky sub-MD can't game us with one lucky run.

## Methodology

For each task fixture, we:

1. Spawn `k` independent runs of the sub-MD against the same fixture (default `k=5`).
2. Each run is scored by 4 scorers:
   - **action-correctness** — did the MD pick the right tool?
   - **escalation-correctness** — did the MD escalate at the right point?
   - **communication-quality** — LLM-judged owner/tenant comms quality.
   - **cost-efficiency** — resolution-quality / $ spent.
3. A run is a "pass" iff its weighted composite score `>= 0.80`.
4. The task passes if `>= ceil(k * 0.6)` runs pass (i.e. ≤2 failures out of 5).

This is the `pass^k` metric: it stresses tail behaviour, not just averages.

## Scenarios + task counts

| Scenario             | Tasks | Sub-MDs exercised             |
|----------------------|-------|-------------------------------|
| arrears-triage       | 10    | arrears-md                    |
| maintenance-dispatch | 10    | maintenance-md                |
| kra-filing           | 10    | tax-md, kra-md                |
| lease-renewal        | 10    | lease-md, renewal-md          |
| complaint-triage     | 10    | concierge-md, complaint-md    |
| **TOTAL**            | **50**|                               |

## Fixture shape

Each task is a YAML file in `tasks/<scenario>/task-NNN.yaml` with:

```yaml
id: arrears-triage-001
scenario: arrears-triage
title: '12-day arrears, first-time delinquency'
context:
  tenant:
    id: tnt-001
    name: 'Asha Mwakasege'
    arrears_days: 12
    history: first-delinquency
  property:
    id: prop-001
    block: 'Block A'
    unit: '4B'
  lease:
    monthly_rent_minor: 65000000  # TZS minor units
    currency: TZS
  events:
    - {at: '2026-04-15', kind: 'invoice.issued', amount_minor: 65000000}
    - {at: '2026-04-30', kind: 'invoice.due', amount_minor: 65000000}
    - {at: '2026-05-12', kind: 'partial_payment', amount_minor: 20000000}
expected_actions:
  - {tool: 'arrears.send_reminder', tone: 'firm-but-empathetic'}
  - {tool: 'arrears.propose_payment_plan', max_installments: 3}
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
