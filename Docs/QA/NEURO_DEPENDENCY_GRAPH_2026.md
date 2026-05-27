# NEURO Dependency Graph 2026 — Phase 1 Audit

**Date:** 2026-05-27
**Scope:** 40 cognitive packages targeted by the NEURO-WIRING-SOTA initiative.
**Method:** Parsed `package.json` (`dependencies` + `devDependencies` + `peerDependencies` + `optionalDependencies`) and scanned `src/**/*.{ts,tsx,mts,cts,js,mjs}` for `from '@borjie/...'` and `import('@borjie/...')` statements.
**Machine-readable counterpart:** `Docs/QA/NEURO_DEPENDENCY_GRAPH_2026.json`.

---

## 1. Headline numbers

| Metric | Value |
| ------ | ----- |
| Target packages | 40 |
| Audited (exist) | 37 |
| Missing on disk | 3 |
| Edges to *any* `@borjie/*` peer | 26 |
| Edges *within the 40-package cognitive set* | 2 |
| Critical wires present | 0 of 12 |
| Extra-wire gaps | 21 of 21 missing |
| Packages whose `src/` imports zero `@borjie/*` peers | 20 |

The cognitive substrate is a constellation of largely isolated packages: 37 packages contribute only 2 in-target edges. The substrate has been built as units; the wiring has not yet been drawn.

---

## 2. Packages — presence & shape

### 2.1 Missing on disk (3)

| Package | Notes |
| ------- | ----- |
| `wave-resilience-manager` | Referenced in spec docs (e.g. AGENT_SELF_REVIVAL_SPEC.md) but no `packages/wave-resilience-manager/` directory exists. Must be scaffolded in Phase 3. |
| `research-orchestrator` | Spec under `Docs/DESIGN/DEEP_RESEARCH_SPEC.md` but no `packages/research-orchestrator/`. `research-tools` exists. Must be scaffolded in Phase 3. |
| `voice-agent` | Voice-related code lives in `persona-voice` and `ambient-listener`; no dedicated `voice-agent` package. Will be folded into composition root in Phase 3 (no new package needed unless follow-up turn revises decision). |

### 2.2 Present (37) — all have both `src/` and `package.json`

`agent-platform`, `agent-security-guard`, `ambient-listener`, `anomaly-detection`, `blackboard-intel`, `blackboard-sota`, `blackboard-viz`, `calibration-monitor`, `capability-catalogue`, `causal-inference`, `cognitive-engine`, `cognitive-memory`, `data-analysis`, `data-protection`, `forecasting`, `graph-database`, `graph-rag-router`, `intel-self-improve`, `language-self-improve`, `language-sota`, `loop-quality-gates`, `loop-runner`, `meta-learning-conductor`, `mutation-authority`, `persistent-memory`, `persona-voice`, `post-training-rlvr`, `process-reward-model`, `recommendations`, `research-tools`, `sae-probe`, `swahili-linguistics`, `swarm-coordination`, `tenant-isolation-guard`, `translation-sota`, `user-followup`, `work-cycle`.

---

## 3. Adjacency table — every audited package and its `@borjie/*` neighbours

| Package | Out-edges to `@borjie/*` | In-target? |
| ------- | ------------------------ | ---------- |
| agent-platform | enterprise-hardening | – |
| agent-security-guard | *(none)* | – |
| ambient-listener | *(none)* | – |
| anomaly-detection | *(none)* | – |
| blackboard-intel | audit-hash-chain, observability | – |
| blackboard-sota | *(none)* | – |
| blackboard-viz | *(none)* | – |
| calibration-monitor | *(none)* | – |
| capability-catalogue | observability | – |
| causal-inference | audit-hash-chain, observability | – |
| cognitive-engine | audit-hash-chain | – |
| cognitive-memory | audit-hash-chain | – |
| data-analysis | *(none)* | – |
| data-protection | *(none)* | – |
| forecasting | domain-models, graph-sync | – |
| graph-database | audit-hash-chain, observability | – |
| graph-rag-router | audit-hash-chain | – |
| intel-self-improve | *(none)* | – |
| language-self-improve | *(none)* | – |
| language-sota | audit-hash-chain | – |
| loop-quality-gates | *(none)* | – |
| loop-runner | **loop-quality-gates** | loop-quality-gates |
| meta-learning-conductor | *(none)* | – |
| mutation-authority | audit-hash-chain | – |
| persistent-memory | *(none)* | – |
| persona-voice | *(none)* | – |
| post-training-rlvr | *(none)* | – |
| process-reward-model | audit-hash-chain | – |
| recommendations | *(none)* | – |
| research-tools | ai-copilot, audit-hash-chain | – |
| sae-probe | *(none)* | – |
| swahili-linguistics | audit-hash-chain | – |
| swarm-coordination | audit-hash-chain | – |
| tenant-isolation-guard | observability | – |
| translation-sota | audit-hash-chain | – |
| user-followup | *(none)* | – |
| work-cycle | audit-hash-chain, **cognitive-memory**, observability | cognitive-memory |

In-target edges (2):
1. `loop-runner → loop-quality-gates`
2. `work-cycle → cognitive-memory`

---

## 4. The 12 critical wires — status

| # | Source | Destination | Status |
| - | ------ | ----------- | ------ |
| 1 | cognitive-engine | capability-catalogue | MISSING |
| 2 | capability-catalogue | meta-learning-conductor | MISSING |
| 3 | meta-learning-conductor | post-training-rlvr | MISSING |
| 4 | post-training-rlvr | calibration-monitor | MISSING |
| 5 | calibration-monitor | loop-quality-gates | MISSING |
| 6 | swarm-coordination | blackboard-sota | MISSING |
| 7 | blackboard-sota | cognitive-memory | MISSING |
| 8 | cognitive-memory | loop-runner | MISSING |
| 9 | loop-runner | wave-resilience-manager | MISSING (destination not on disk) |
| 10 | mutation-authority | loop-quality-gates | MISSING |
| 11 | ambient-listener | cognitive-memory | MISSING |
| 12 | tenant-isolation-guard | *every cognitive package* | MISSING — 0 of 36 peers consume it |

**Zero of the twelve critical wires are present today.** All 12 must be drawn in Phase 3 via the composition root.

---

## 5. Extra expected wires — also missing

| Source | Destination | Reason |
| ------ | ----------- | ------ |
| graph-rag-router | graph-database | RAG router must read from the graph store |
| graph-rag-router | cognitive-memory | RAG router caches retrieved snippets into working memory |
| research-tools | graph-rag-router | Research tools route via RAG before LLM calls |
| forecasting | data-analysis | Forecasting builds on tabular analysis primitives |
| recommendations | data-analysis | Same |
| anomaly-detection | data-analysis | Same |
| causal-inference | data-analysis | Same |
| intel-self-improve | blackboard-intel | Intel self-improvement must read the intel blackboard |
| blackboard-viz | blackboard-sota | Viz layer renders the SOTA blackboard state |
| language-self-improve | language-sota | Self-improvement loops back into the SOTA language layer |
| translation-sota | language-sota | Translation depends on the base language layer |
| swahili-linguistics | language-sota | Swahili builds on base language stack |
| persona-voice | language-sota | Persona voice consumes language layer |
| ambient-listener | language-sota | Listener parses audio via the language layer |
| user-followup | cognitive-memory | Follow-ups read prior interactions from memory |
| work-cycle | loop-runner | Work cycle drives loop execution |
| process-reward-model | post-training-rlvr | PRM signal feeds RLVR |
| sae-probe | calibration-monitor | SAE features feed calibration |
| agent-security-guard | tenant-isolation-guard | Security guard must enforce tenant isolation |
| agent-platform | agent-security-guard | Platform spawns guarded agents |
| data-protection | tenant-isolation-guard | Data protection enforces tenant rules |

**21 of 21 extra expected wires are missing.**

---

## 6. Top 10 src → dst pairs to fix first

Prioritised by Phase 3 implementation order (highest leverage first):

1. `tenant-isolation-guard` → *every package* (cross-tenant blast radius)
2. `cognitive-engine` → `capability-catalogue` (the front door)
3. `capability-catalogue` → `meta-learning-conductor` (capability tuning)
4. `meta-learning-conductor` → `post-training-rlvr` (learning loop)
5. `post-training-rlvr` → `calibration-monitor` (uncertainty)
6. `calibration-monitor` → `loop-quality-gates` (quality enforcement)
7. `swarm-coordination` → `blackboard-sota` (multi-agent shared state)
8. `blackboard-sota` → `cognitive-memory` (consolidation)
9. `cognitive-memory` → `loop-runner` (memory-driven execution)
10. `ambient-listener` → `cognitive-memory` (sensory ingestion)

---

## 7. Notes on method

- Edges are detected from two sources: declared `workspace:*` deps and actual `import` statements. We take the **union** so an in-source import not yet declared still counts (and vice versa).
- We did not yet walk transitive edges — Phase 3 will use the composition root to express transitive dependency without bloating direct `package.json` files.
- We did not yet inspect runtime registry patterns (e.g. plugin-registry, anti-corruption-layer); the spec section 7 in `NEURO_WIRING_SOTA_2026.md` discusses these and their effect on apparent edge counts.
- `tenant-isolation-guard` has zero in-bound edges; this is the single most urgent gap from a security and architectural soundness perspective.
- This audit was run against the working tree at HEAD `b8e5a3c` (May 27 2026). Re-running on a different revision may yield different edge counts. Phase 5 will install a weekly CI re-run to surface drift.

---

## 8. Outputs

| File | Purpose |
| ---- | ------- |
| `Docs/QA/NEURO_DEPENDENCY_GRAPH_2026.json` | Machine-readable adjacency, gap lists, summary |
| `Docs/QA/NEURO_DEPENDENCY_GRAPH_2026.md` | This document — human review |
| `Docs/DESIGN/NEURO_WIRING_SOTA_2026.md` | Phase 1+2 spec consuming this audit |
