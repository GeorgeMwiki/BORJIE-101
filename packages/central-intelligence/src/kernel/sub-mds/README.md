# Sub-MDs — scoped, reversible task-contracts

This directory hosts the **sub-MDs**: small, scoped agents that ride INSIDE the
MD (Mind-of-Domain) kernel and run a four-stage pipeline:

```
OBSERVE  →  MAP  →  REDESIGN  →  AUTOMATE
```

Sub-MDs are **not autonomous juniors**. They are reversible task-contracts
that the MD hands off, observes, and reclaims. Every artefact produced by
`automate(...)` lands in `draft` / `review-requested` state — the MD's
four-eye flow decides whether to promote it.

## Reliability framing

A 10-step autonomous chain at 85% per-step reliability lands at ~20%
end-to-end. We therefore optimise for **single-step task-quality**, never for
unbounded multi-step autonomy. A sub-MD that touches 10 things is broken
into 10 reversible single-step contracts, not collapsed into one autonomous
loop.

## Pipeline contract

```ts
interface SubMd {
  readonly name: string;
  readonly persona: PersonaIdentity;
  readonly scope: ScopeFilter;
  readonly toolBelt: ReadonlyArray<string>;
  readonly riskTier: RiskTier;

  observe(ctx: SubMdContext): AsyncIterable<ObservedEvent>;
  map(events: ReadonlyArray<ObservedEvent>, ctx: SubMdContext): Promise<ProcessGraph>;
  redesign(graph: ProcessGraph, ctx: SubMdContext): Promise<RedesignProposal>;
  automate(proposal: RedesignProposal, ctx: SubMdContext): Promise<AutomationArtifact>;
  recordOutcome(actual: ActualOutcome, predicted: PredictedOutcome): Promise<void>;
}
```

## Tier-A sub-MDs (this directory)

Tier-A = reversible, human-checkable, evidence-rich, no documented major
failures. Two ship today:

- **`maintenance.dispatch`** — ticket triage → vendor pick → reversible
  dispatch → follow-up. Evidence: 45% emergency-response reduction,
  15-20% spend reduction, 89-96% classification accuracy.
- **`complaint.triage`** — complaint classification (Swahili + English)
  → routing → empathy draft → escalation. Evidence: 89-96% BERT-style
  accuracy, low-stakes.

## Lifecycle

1. **OBSERVE** — subscribe to in-scope events on the bus (with budget cap
   and tenant-scope guard).
2. **MAP** — turn the event list into a `ProcessGraph` (state machine,
   adjacency, SLA breaches).
3. **REDESIGN** — LLM proposes 1-3 reversible improvements with a
   predicted-outcome estimate.
4. **AUTOMATE** — compile the proposal to a draft Skill + cron + monitor
   thresholds + hook list. Status is always `draft` / `review-requested`.
5. **recordOutcome** — closed-loop Reflexion tracking; predicted-vs-actual
   feeds the next redesign cycle.
