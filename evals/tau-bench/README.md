# Tau-Bench (τ-bench) — Property-Management Edition

A property-management analog of [Sierra's tau-bench](https://github.com/sierra-research/tau-bench)
(retail + airline simulators). BORJIE agents are dropped into a simulated
lease-management environment and graded on goal-completion across long
dialogues with tool use + state.

## Why we ship this in addition to BFCL

- **BFCL** measures single-turn function-calling correctness — what the LLM
  CAN do, in isolation.
- **PMS-bench-1** measures sub-MD vertical task quality with `pass^k`.
- **τ-PM-bench** (this) measures end-to-end agent behaviour against a stateful
  simulator: did the agent navigate a 20-turn rent dispute correctly, with
  the right escalations, the right cited evidence, and the right final
  outcome?

This is where regressions in long-horizon reasoning show up first.

## Scenarios

| Scenario | Description | Avg turns |
|----------|-------------|-----------|
| `arrears-negotiation` | 14-day arrears → payment plan → confirmation | 12 |
| `maintenance-dispatch` | tenant reports leak → triage → vendor → follow-up | 18 |
| `lease-renewal` | 60-day-out renewal offer → counter → sign | 15 |
| `eviction-prep` | confirmed default → notice draft → 4-eye approval | 20 |
| `owner-onboarding` | new owner → portfolio upload → bootstrap | 10 |

Each scenario has a deterministic simulator that hosts the tenant / owner
persona, the property state, and the tool responses. The agent under test
has access to the same tool surface that production agents do.

## Grading

Per τ-bench v2:

- **goal-completion** — did the agent reach the canonical end-state?
- **policy-adherence** — did the agent obey hard rules (Constitution clauses,
  jurisdictional law, 4-eye approval)?
- **efficiency** — turns to completion vs. optimal
- **comms-quality** — LLM-judged tenant/owner comms quality

The pass bar is `goal-completion AND policy-adherence == 1.0 AND turns ≤ 1.5×optimal`.

## Files

- `runner/sim.ts` — environment + tenant / owner / vendor simulators
- `runner/agent-adapter.ts` — wires BORJIE's multi-LLM synthesizer
- `runner/grader.ts` — 4-component scorer
- `runner/scenarios/` — one folder per scenario with seed states + canonical traces
- `runner/run-tau.ts` — runs N scenarios × K seeds, writes a report

## Running

```bash
TAU_SEEDS=5 pnpm --filter @borjie/tau-bench run bench
```

Reports land in `./output/tau-<timestamp>.json` and a Markdown summary at
`./output/tau-<timestamp>.md`.

## Roadmap

- v0.1: scaffold (this commit) — runner + scorer + 1 scenario
- v0.2: 5 scenarios full
- v0.3: jury LLM scoring for comms-quality
- v0.4: red-team variants (tenant tries jailbreak, agent must refuse)
