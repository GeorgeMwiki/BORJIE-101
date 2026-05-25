# Model Card — Reflexion + Sleep Consolidation v1 (F11)

**Model ID:** `reflexion-sleep-v1`
**Version:** 1.0
**Date:** 2026-05-22
**Owner:** Brain team
**Jurisdiction:** Tanzania (TZ pack)
**Stakes:** High (governs how the kernel's long-term memory + behavioural guidelines evolve)
**Status:** Production

---

## Purpose

The Reflexion + Sleep Consolidation component is the kernel's memory-governance layer. During the day, every agent run writes a structured reflection (what was attempted, what worked, what failed) to a per-tenant reflexion buffer. Nightly, a 4-pass "sleep" job dedupes, extracts patterns, updates guidelines, and prunes stale entries. This is Borjie's closed-loop self-improvement mechanism (R-MOAT-6) and a material model-risk surface because guideline updates can subtly change agent behaviour across all subsequent runs.

## Architecture

| Phase | Operation |
|---|---|
| Write | Each agent run records a Reflexion entry (success / failure / hypothesised cause) to the buffer |
| Pass 1 — Dedupe + cluster | Group structurally identical reflections; keep latest per cluster |
| Pass 2 — Extract patterns | LLM identifies recurring failure modes + recurring success patterns |
| Pass 3 — Update guidelines | Patterns become candidate guideline updates; queued for human (Brain team) review before take-effect |
| Pass 4 — Prune stale | Reflections older than retention threshold + superseded by guideline pruned |

Patterns awaiting human review do not affect production behaviour.

## Training data

**No training in the traditional sense.** Guidelines are versioned text; behaviour change is mediated by prompt-context rather than weights. Reflection corpus is per-tenant; tenant data never crosses tenant boundaries via this path (enforced by tenant-isolation guard).

## Inputs

- Reflexion buffer rows for the day (per tenant)
- Active guideline set
- Online judge feedback signals
- Memory layer state from `packages/ai-copilot/src/memory/` + `dp-memory/`

## Outputs

- Updated reflexion buffer (deduped + pruned)
- Guideline-update queue for human review
- Daily reflexion summary (for ops dashboards)
- Audit-chain entries for every guideline change

## Performance

| Metric | Target | Last measured |
|---|---|---|
| Sleep job latency (per tenant) | < 5 min | TODO |
| Guideline-update human-acceptance rate | > 60% | TODO |
| Hallucination-rate reduction post-guideline-update | > 5% | TODO |
| Stale-entry prune rate per cycle | tracked | TODO |

## Limitations

- Quality of guideline updates depends on Reflexion corpus quality; manipulation by adversarial input is mitigated by tier-policy + scrubber
- Guideline updates require human approval before production effect (intentional, to prevent runaway self-modification)
- Cross-tenant pattern mining is forbidden; this is enforced architecturally (per-tenant buffers) and policy-wise

## Implementation

| Component | Path:line |
|---|---|
| Reflexion recorder | `packages/central-intelligence/src/kernel/reflexion/reflexion-recorder.ts` |
| Reflexion writer | `packages/central-intelligence/src/kernel/reflexion/reflexion-writer.ts` |
| Reflexion retriever | `packages/central-intelligence/src/kernel/reflexion/reflexion-retriever.ts` |
| Reflexion loader | `packages/central-intelligence/src/kernel/reflexion/reflexion-loader.ts` |
| Index | `packages/central-intelligence/src/kernel/reflexion/index.ts` |
| Nightly sleep entry-point | `packages/central-intelligence/src/kernel/reflexion/sleep/nightly-sleep.ts` (230 lines) |
| Pass 1 — dedupe cluster | `pass-1-dedupe-cluster.ts` |
| Pass 2 — extract patterns | `pass-2-extract-patterns.ts` |
| Pass 3 — update guidelines | `pass-3-update-guidelines.ts` |
| Pass 4 — prune stale | `pass-4-prune-stale.ts` |
| Storage | `packages/database/src/schemas/reflexion-buffer.schema.ts` + `services/reflexion-buffer.service.ts` |
| Sandbox for guideline-update preview | `packages/central-intelligence/src/kernel/sandbox/sandbox-policy.ts` |

## Monitoring dashboards

| Dashboard | URL placeholder |
|---|---|
| Grafana — sleep job duration per tenant | `https://grafana.borjie.com/d/sleep-perf/sleep-job-duration` |
| Grafana — guideline-update human-acceptance rate | `https://grafana.borjie.com/d/guidelines/guideline-update-acceptance` |
| Mission-Eval — hallucination rate pre/post guideline | `https://mission-eval.borjie.com/project/borjie/dashboards/halluc-pre-post-guideline` |
| Langfuse — sleep trace explorer | `https://langfuse.borjie.com/project/borjie-prod/traces?tag=sleep` |

## Privacy & Safety

- Per-tenant buffers; reflexion data never crosses tenant boundaries; isolation enforced by `packages/ai-copilot/src/security/tenant-isolation.ts` (373 lines)
- All guideline changes recorded in `audit-events.schema.ts` with category `ai.guidelines.update`
- Human approval required before guideline take-effect; kill-switch fail-closed

## Version history

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial release (F11 wave) | Brain Team Lead |

## Sign-off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| Model Risk Manager | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/mrm/model-card-reflexion-v1.0` |
| Brain Team Lead | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/brain/model-card-reflexion-v1.0` |
| CISO | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/ciso/model-card-reflexion-v1.0` |
| DPO | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/dpo/model-card-reflexion-v1.0` |

## Review cadence

- **Daily (automated)** — sleep job runs nightly; daily ops review of latency + acceptance rate
- **Quarterly** — Brain + Model Risk Committee review aggregate guideline-update history
- **Out-of-cycle** — any rollback of a guideline, sleep-job failure > 24 h, or tenant-isolation incident
