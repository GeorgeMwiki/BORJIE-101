# @borjie/cognitive-composition

**Wave NEURO-WIRING-SOTA, Phase 3.**

Composition root that wires the 12 cognitive subsystems into a single named
pipeline and owns the operator-grade 12-wire health probe.

Persona: Mr. Mwikila. Brand: Borjie.

See `Docs/DESIGN/NEURO_WIRING_SOTA_2026.md` for the full design — this
package is the implementation of §6 (composition root) and §8 (12-wire
health probe + migration 0076).

## What it does

- **`createCognitiveComposition(deps)`** returns a composer with two methods:
  - `compose(input)` → runs the full 9-stage pipeline and returns a
    `CognitiveOutput` with provenance + confidence label.
  - `wireHealth()` → runs the 12-wire health probe (each probe bounded by
    `PROBE_TIMEOUT_MS = 2000ms`) and persists the result to the
    `cognitive_wiring_health` table.

## The 12 wires

| # | Wire | Source package |
|---|------|----------------|
| 1 | `cognitive-engine.inference`           | `@borjie/cognitive-engine` |
| 2 | `cognitive-memory.episodic`            | `@borjie/cognitive-memory` |
| 3 | `cognitive-memory.semantic`            | `@borjie/cognitive-memory` |
| 4 | `cognitive-memory.procedural`          | `@borjie/cognitive-memory` |
| 5 | `cognitive-memory.reflective`          | `@borjie/cognitive-memory` |
| 6 | `extended-reasoning.cot`               | `@borjie/extended-reasoning` |
| 7 | `reasoning-substrate.compile`          | `@borjie/reasoning-substrate` |
| 8 | `central-intelligence.kernel`          | `@borjie/central-intelligence` |
| 9 | `calibration-monitor.confidence`       | `@borjie/calibration-monitor` |
| 10 | `conformal-calibration-online.update` | `@borjie/conformal-calibration-online` |
| 11 | `audit-hash-chain.append`             | `@borjie/audit-hash-chain` |
| 12 | `brain-llm-router.cascade`            | `@borjie/brain-llm-router` |

Status classification per probe:

- **ok** — resolved, latency ≤ 800ms
- **degraded** — resolved, latency > 800ms
- **down** — rejected or timed out (≥ 2000ms)

## Dependency injection

The package never imports the heavy upstream subsystems directly — it
defines port interfaces (`InferencePort`, `MemoryTierPort`, `CotPort`, …)
that callers satisfy with thin adapters. This keeps the workspace dep
graph acyclic and the unit/integration tests fast.

## Migration

The companion table lives in `packages/database/drizzle/0076_cognitive_wiring_health.sql`
and is tenant-scoped via the canonical `current_setting('app.tenant_id', true)`
GUC RLS policy from migration 0003.
