# Runbook: AiCostPerTenantSpike

| Field | Value |
|---|---|
| Alert | `AiCostPerTenantSpike` |
| Severity | warning |
| Page | finops |

## What this means

A single tenant is burning >$5/h on AI inference for ≥30 min. That's well
above tier unit economics.

## First 5 minutes

1. Open `Cost per Tenant` dashboard.
2. Identify model + tier. Is it an unexpected model (e.g., paid model on a
   free tier)?
3. Look at request rate — is this a prompt-loop or legitimate heavy use?
4. Pull recent traces — common patterns? Same prompt repeating?

## Likely root causes

- Tenant-induced prompt loop (agent re-trying without backoff)
- Model fallback misconfigured (premium model called for cheap tier)
- A skill installed that runs unbounded inference

## Mitigations

- Throttle tenant via cap-enforcer
- Force the model router to downgrade for the tenant (`set tier_override`)
- Disable the offending skill via flag

## Escalation

- >$20/h sustained → SEV-3, page finops + central-command
- Suspected abuse → security review
