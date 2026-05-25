# Model Card — Tier-Policy Resolver v1 (F2)

**Model ID:** `tier-policy-resolver-v1`
**Version:** 1.0
**Date:** 2026-05-22
**Owner:** Brain / Safety team
**Jurisdiction:** Tanzania (TZ pack)
**Stakes:** High (gates every high-risk tool invocation)
**Status:** Production

---

## Purpose

The Tier-Policy Resolver is the Borjie "constitution v2" — a rule-based decision gate that, before any consequential tool call by an AI agent, evaluates whether the call is permitted under the active policy tier for the calling tenant + role + region. It is the primary control preventing agent over-reach (e.g., an LLM emitting a refund instruction it should not have), prompt-injection-driven privilege escalation, and unintended cross-tenant action.

## Architecture

Pure rules + assertions; no LLM in the decision path. The resolver evaluates:

1. Caller identity + role (from the gateway-attached principal)
2. Active tier for the tenant (T1 / T2 / T3 / T4)
3. Tool category (read-only / mutating / financial / privacy-sensitive / agent-internal)
4. Literal-only safety check for high-risk tools (anti-prompt-injection)
5. Kill-switch state for the route + agent

The resolver returns `allow | deny | escalate-to-human` plus a structured reason. Denies are recorded to the cross-tenant denial log.

## Training data

**None.** The resolver is deterministic; rule changes follow the standard model-lifecycle (doc 05) with code review + tests.

## Inputs

- Caller principal (user, role, tenant, region)
- Tool spec (category, mutation flag, stakes)
- Active tier (resolved from `packages/database/src/schemas/identity.schema.ts`)
- Kill-switch state from `services/api-gateway/src/composition/cross-portal-killswitch-fanout.ts`

## Outputs

- `decision: allow | deny | escalate-to-human`
- `reason`: structured (rule ID + rationale)
- `audit_entry`: pre-formatted for `audit-events.schema.ts` and `sovereign-action-ledger.schema.ts`

## Performance

| Metric | Target | Last measured |
|---|---|---|
| Resolution latency p95 | < 5 ms | TODO |
| False-allow rate (allowed a forbidden action) | 0 | TODO |
| False-deny rate (denied a legitimate action) | < 1% | TODO |
| Anti-prompt-injection catch-rate (high-risk-literal-only check) | 100% on corpus | TODO |

## Limitations

- Cannot anticipate semantically novel attacks; relies on tier classification + tool spec accuracy
- Tier upgrade workflow is human-mediated; latency in onboarding new tiers
- Does not perform fairness slice; that is the responsibility of the calling agent + Mission-Eval

## Implementation

| Component | Path:line |
|---|---|
| Core resolver | `packages/central-intelligence/src/policy-gate/tier-policy-resolver.ts` (419 lines) |
| Assertions | `packages/central-intelligence/src/policy-gate/assertions.ts` |
| High-risk-literal-only guard | `packages/central-intelligence/src/policy-gate/high-risk-literal-only.ts` |
| Index | `packages/central-intelligence/src/policy-gate/index.ts` |
| Tests | `packages/central-intelligence/src/policy-gate/__tests__/tier-policy-resolver.test.ts` + `__tests__/policy-gate-edges.test.ts` + `__tests__/inviolable-ip-categories.test.ts` + `__tests__/public-inviolable.test.ts` |

## Monitoring dashboards

| Dashboard | URL placeholder |
|---|---|
| Grafana — deny / escalate rate by tool | `https://grafana.borjie.com/d/tier-gate/tier-policy-gate-denies` |
| Grafana — literal-only-guard catches | `https://grafana.borjie.com/d/literal-guard/high-risk-literal-only` |

## Privacy & Safety

- No PII passes through the resolver beyond IDs already attached to the principal
- All deny events recorded to `cross_tenant_denials` and unified audit chain
- Kill-switch is fail-closed (W4-E hardening)

## Version history

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial release (F2 wave) | Brain / Safety lead |

## Sign-off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| Model Risk Manager | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/mrm/model-card-tier-policy-v1.0` |
| Brain Team Lead | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/brain/model-card-tier-policy-v1.0` |
| CISO | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/ciso/model-card-tier-policy-v1.0` |

## Review cadence

- **Quarterly** — Brain + Safety review the rule set against incident telemetry
- **Out-of-cycle** — new tool category, new tier, or any prompt-injection incident
