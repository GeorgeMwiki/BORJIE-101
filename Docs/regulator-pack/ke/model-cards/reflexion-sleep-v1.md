# Model Card — Reflexion + Sleep Consolidation v1 (F11) — Kenya

**Model ID:** `reflexion-sleep-v1`
**Version:** 1.0
**Date:** 2026-05-22
**Owner:** Brain team
**Jurisdiction:** Kenya (KE pack)
**Stakes:** High (memory governance; behavioural drift surface)
**Status:** Production

---

## Purpose

The Reflexion + Sleep Consolidation component is the kernel's memory-governance layer. Daytime: every agent run writes a reflection to a per-tenant buffer. Nightly: a 4-pass sleep job dedupes, extracts patterns, drafts guideline updates (queued for human review), and prunes stale entries. KE-specific: every guideline change is auditable per DPA s.31 (accountability principle) and reviewable per s.35 when guideline changes materially affect tenant-facing automated decisions.

## Architecture

| Phase | Operation |
|---|---|
| Write | Reflection entry per run (success / failure / hypothesised cause) |
| Pass 1 — Dedupe + cluster | Group identical reflections; keep latest |
| Pass 2 — Extract patterns | LLM identifies recurring failure / success modes |
| Pass 3 — Update guidelines | Patterns become candidate guideline updates; **human (Brain team + DPO for KE) review required before take-effect** |
| Pass 4 — Prune stale | Old / superseded reflections pruned |

KE-specific: guideline changes affecting decisioning surfaces flagged to DPO before take-effect.

## Training data

None in the traditional sense. Guidelines are versioned text. Per-tenant buffers; tenant data never crosses tenant boundaries (architecturally enforced).

## Inputs

- Daily Reflexion buffer (per KE tenant)
- Active guideline set
- Online judge feedback (KE corpus)
- Memory layer state

## Outputs

- Updated Reflexion buffer
- Guideline-update queue (with KE flag where relevant)
- Daily summary
- Audit-chain entries for every guideline change (KE-region tagged)

## Performance

| Metric | Target | Last measured |
|---|---|---|
| Sleep job latency per KE tenant | < 5 min | TODO |
| Guideline-update human-acceptance rate | > 60% | TODO |
| Hallucination-rate reduction post-guideline (KE) | > 5% | TODO |
| KE-flagged guideline-update DPO review SLA | < 7 days | TODO |

## Limitations

- Quality of guideline updates bounded by reflexion corpus quality
- Adversarial-input manipulation risk; mitigated by tier-policy + scrubber
- Human-approval gate intentionally prevents runaway self-modification
- Cross-tenant pattern mining forbidden (architectural)

## Implementation

| Component | Path:line |
|---|---|
| Recorder | `packages/central-intelligence/src/kernel/reflexion/reflexion-recorder.ts` |
| Writer | `packages/central-intelligence/src/kernel/reflexion/reflexion-writer.ts` |
| Retriever | `packages/central-intelligence/src/kernel/reflexion/reflexion-retriever.ts` |
| Loader | `packages/central-intelligence/src/kernel/reflexion/reflexion-loader.ts` |
| Nightly sleep | `packages/central-intelligence/src/kernel/reflexion/sleep/nightly-sleep.ts` (230 lines) |
| Passes 1-4 | `sleep/pass-1-dedupe-cluster.ts`, `pass-2-extract-patterns.ts`, `pass-3-update-guidelines.ts`, `pass-4-prune-stale.ts` |
| Storage | `packages/database/src/schemas/reflexion-buffer.schema.ts` + `services/reflexion-buffer.service.ts` |
| Sandbox preview | `packages/central-intelligence/src/kernel/sandbox/sandbox-policy.ts` |

## Monitoring dashboards

| Dashboard | URL placeholder |
|---|---|
| Grafana — KE sleep job duration | `https://grafana.borjie.com/d/sleep-perf/sleep-job-duration?var-region=KE` |
| Grafana — KE guideline-update acceptance | `https://grafana.borjie.com/d/guidelines/guideline-update-acceptance?var-region=KE` |
| Mission-Eval — KE halluc pre/post guideline | `https://mission-eval.borjie.com/project/borjie/dashboards/halluc-pre-post-guideline?var-region=KE` |
| Langfuse — KE sleep traces | `https://langfuse.borjie.com/project/borjie-prod/traces?tag=sleep&region=KE` |

## Privacy & Safety

- Per-tenant buffers; isolation enforced by `packages/ai-copilot/src/security/tenant-isolation.ts` (373 lines)
- All guideline changes recorded in `audit-events.schema.ts` with `ai.guidelines.update` + KE region tag
- Human approval required before take-effect; kill-switch fail-closed
- KE-specific: DPO review on any guideline change affecting automated decisions

## Version history

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial release (F11 wave) — KE | Brain Team Lead |

## Sign-off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| Model Risk Manager | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/mrm/model-card-ke-reflexion-v1.0` |
| Brain Team Lead | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/brain/model-card-ke-reflexion-v1.0` |
| CISO | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/ciso/model-card-ke-reflexion-v1.0` |
| DPO (ODPC-registered) | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/dpo/model-card-ke-reflexion-v1.0` |

## Review cadence

- **Daily (automated)** — sleep job runs nightly; ops review of latency
- **Quarterly** — Brain + Model Risk Committee review aggregate KE guideline-update history
- **Out-of-cycle** — any rollback, sleep-job failure > 24 h, or tenant-isolation incident
