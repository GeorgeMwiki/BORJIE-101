# Model Card — Tier-Policy Resolver v1 (F2) — Kenya

**Model ID:** `tier-policy-resolver-v1`
**Version:** 1.0
**Date:** 2026-05-22
**Owner:** Brain / Safety team
**Jurisdiction:** Kenya (KE pack)
**Stakes:** High (gates every high-risk tool invocation; under KE DPA s.35 the resolver is the technical control evidencing that material decisions are not solely automated)
**Status:** Production

---

## Purpose

The Tier-Policy Resolver is the "constitution v2" — a rule-based decision gate that, before any consequential tool call by an AI agent, evaluates whether the call is permitted under the active policy tier for the calling tenant + role + region. In Kenya it is the primary technical control that gives operational meaning to DPA 2019 s.35: any decision that would be "solely automated" is intercepted, recorded, and either escalated for human review or surfaced with a "Challenge" CTA.

## Architecture

Pure rules + assertions; no LLM in the decision path. Inputs:

1. Caller identity + role
2. Active tier (T1 / T2 / T3 / T4) — KE stricter defaults
3. Tool category (read / mutating / financial / privacy-sensitive / agent-internal)
4. Literal-only safety check for high-risk tools
5. Kill-switch state
6. Region flag — KE escalates `stakes = medium` to s.35-eligible

Returns `allow | deny | escalate-to-human` plus structured reason. KE-region denies generate an s.35-challengeable record.

## Training data

None. Deterministic rules; changes follow model lifecycle (doc 05) with code review + tests.

## Inputs

- Caller principal (user, role, tenant, region)
- Tool spec (category, mutation flag, stakes)
- Active tier from `packages/database/src/schemas/identity.schema.ts`
- Kill-switch state
- s.35 review-right relevance flag (KE-specific)

## Outputs

- `decision`
- `reason` (rule ID + rationale)
- `audit_entry` for `audit-events.schema.ts` + `sovereign-action-ledger.schema.ts`
- `s35_challenge_link` (KE-specific)

## Performance

| Metric | Target | Last measured |
|---|---|---|
| Resolution latency p95 | < 5 ms | TODO |
| False-allow rate | 0 | TODO |
| False-deny rate | < 1% | TODO |
| KE s.35 challenge sustain-rate (challenge succeeded) | tracked | TODO |
| Anti-prompt-injection catch-rate | 100% on corpus | TODO |

## Limitations

- Cannot anticipate semantically novel attacks
- Tier upgrade workflow is human-mediated
- Does not perform fairness slice (responsibility of calling agent + Mission-Eval)

## Implementation

| Component | Path:line |
|---|---|
| Core resolver | `packages/central-intelligence/src/policy-gate/tier-policy-resolver.ts` (419 lines) |
| Assertions | `packages/central-intelligence/src/policy-gate/assertions.ts` |
| High-risk-literal-only guard | `packages/central-intelligence/src/policy-gate/high-risk-literal-only.ts` |
| Tests | `packages/central-intelligence/src/policy-gate/__tests__/tier-policy-resolver.test.ts` + `__tests__/policy-gate-edges.test.ts` |
| s.35 challenge route | `services/api-gateway/src/routes/gdpr.router.ts` |

## Monitoring dashboards

| Dashboard | URL placeholder |
|---|---|
| Grafana — KE deny / escalate rate | `https://grafana.borjie.com/d/tier-gate/tier-policy-gate-denies?var-region=KE` |
| Grafana — s.35 challenge sustain-rate | `https://grafana.borjie.com/d/s35-challenges/s35-sustain-rate?var-source=resolver` |

## Privacy & Safety

- No PII beyond principal IDs
- All deny events recorded to `cross_tenant_denials` + unified audit chain
- KE-specific: every deny includes s.35-eligible flag
- Kill-switch fail-closed

## Version history

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial release (F2 wave) — KE | Brain / Safety lead |

## Sign-off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| Model Risk Manager | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/mrm/model-card-ke-tier-policy-v1.0` |
| Brain Team Lead | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/brain/model-card-ke-tier-policy-v1.0` |
| DPO (ODPC-registered) | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/dpo/model-card-ke-tier-policy-v1.0` |
| KE Legal Counsel | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/legalke/model-card-ke-tier-policy-v1.0` |

## Review cadence

- **Quarterly** — Brain + Safety review rules vs incident telemetry
- **Out-of-cycle** — new tool category, new tier, ODPC s.35 enforcement notice, or any prompt-injection incident
