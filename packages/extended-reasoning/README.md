# @borjie/extended-reasoning

Phase M-G — Extended Reasoning. Closes the **5 patterns** the L1 deep-reasoning
audit (`.research/l1-deep-reasoning-frontier-audit.md`) explicitly deferred,
each grounded in a concrete BORJIE use case:

| Module | L1 deferral | BORJIE grounding |
|---|---|---|
| `got/` Graph-of-Thoughts | "niche" | Portfolio-level reasoning with shared deps + multi-jurisdiction interlock |
| `lats/` Language Agent Tree Search | "overkill for MD" | Long-horizon multi-month flows (lease renewal, eviction, KRA cycle) |
| `tot/` raw Tree-of-Thoughts | "use Self-Discover instead" | FIXED decision trees (eviction, vendor, KRA-route, tenant-screening) |
| `prm-substrate/` Process Reward Model substrate | "Phase 3 — needs data" | Data collection + runtime scoring harness + eval — drop-in when trained |
| `sot/` Skeleton-of-Thought | "latency not our bottleneck" | Mobile on 3G — halves FMP for long owner-portal briefings |

All five compose with each other and with the K-D / J-* layer. See
`src/__tests__/integration/portfolio-refinance.composition.test.ts` for
the end-to-end portfolio-refinance decision that uses all 5 patterns.

## Module APIs (1-line summaries)

```ts
import { runGoT } from '@borjie/extended-reasoning/got';
import { runLATS } from '@borjie/extended-reasoning/lats';
import { runToT, EVICTION_DECISION_TREE, VENDOR_SELECTION_TREE, KRA_FILING_TREE, TENANT_SCREENING_TREE } from '@borjie/extended-reasoning/tot';
import { scoreStepWithPRM, emitPrmTrainingSample, runPrmEval } from '@borjie/extended-reasoning/prm-substrate';
import { runSoT } from '@borjie/extended-reasoning/sot';
```

## Scope

- BORJIE-only — LITFIN is a separate concern.
- All modules are pure TS with no runtime LLM dependency at the type level:
  callers inject a `model` adapter (`(prompt) => Promise<string>`), enabling
  fast deterministic tests.
