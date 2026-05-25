# Runbook: AiCostGlobalBudgetBurnRate

| Field | Value |
|---|---|
| Alert | `AiCostGlobalBudgetBurnRate` |
| Severity | warning |
| Page | finops |

## What this means

Aggregate platform AI spend is on track to exceed $50k/month at current
1-hour-window burn rate. Budget threshold per platform finance plan.

## First 5 minutes

1. Open `Cost per Tenant` dashboard — top-10 tenants panel
2. Identify dominant tier(s) — is the burn coming from free-tier users
   (unprofitable) or enterprise (covered)?
3. Compare to last week's same-hour rate — is this a one-off spike or a
   sustained trend?

## Likely root causes

- New traffic onboarded that hasn't been priced in
- Model price increase from provider
- Marketing campaign driving free-tier sign-ups
- A skill broadcast that ran against many tenants simultaneously

## Mitigations

- Tighten free-tier caps temporarily
- Switch global model router to cheaper model with manual override on enterprise
- Pause new sign-ups (last resort)

## Escalation

- Projected > $80k/month → page CFO + CTO
- Sustained 24h overshoot → finance ad-hoc review
