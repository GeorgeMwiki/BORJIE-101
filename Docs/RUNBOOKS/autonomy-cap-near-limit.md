# Runbook: AutonomyCapNearLimit

| Field | Value |
|---|---|
| Alert | `AutonomyCapNearLimit` |
| Severity | warning |
| Page | central-command on-call (low urgency) |

## What this means

A tenant's autonomy-cap usage is >90% of ceiling, sustained ≥15 min. Without
intervention they will hit the ceiling and have traffic shed.

## First 5 minutes

1. Open `Autonomy Cap Usage` dashboard.
2. Identify the tenant and check `predict_linear` ETA — minutes to ceiling?
3. Check the tenant's recent usage pattern — burst (unusual) or trend (legit growth)?

## Decision tree

- **Burst (likely loop/abuse)**: Don't bump ceiling. Investigate via
  `kernel_actions` audit log. Throttle if needed.
- **Trend (legit growth)**: Bump ceiling via admin API; product/finance signs off if going to a higher pricing tier.
- **Aging ceiling**: Schedule a cap-review per quarterly cycle.

## Mitigations

- Send tenant an in-app warning if not already
- Bump ceiling (with approval) via `POST /admin/tenants/:id/cap-ceiling`
- Suggest tier upgrade in customer success ticket

## Escalation

- Tenant hits ceiling → `AutonomyCapBreached` fires (separate runbook)
