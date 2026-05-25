# Four-Eye Approval — Admin Review Runbook

> Audience: platform admin (`SUPER_ADMIN` / `PLATFORM_ADMIN`) reviewing
> kernel-proposed high-risk actions. Every approval is signed and
> permanently audit-logged.

## Overview

The brain proposes actions across five risk tiers. Tiers
`mutate`, `destroy`, `billing`, and `external-comm` require a
second human signature before the kernel actuates them. Tier
`read` executes immediately. The pending queue is a finite,
expiring backlog — left to lapse, items time out and the
brain re-plans.

## View pending approvals

```bash
curl -fsS "$API_BASE_URL/api/v1/approvals/pending" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.data[]'
```

The admin Central Command surface (`apps/admin-platform-portal/`)
renders the same queue as a card list with one-click approve / recall.

## Risk-tier glossary

| Tier | Examples | Approval required? | Notes |
|---|---|---|---|
| `read` | List leases, summarize tenant, query analytics | No | Logged for replay only |
| `mutate` | Create lease, update tenant profile, edit invoice | YES | Reversible writes |
| `destroy` | Cancel lease, refund payment, archive property, RTBF erase | YES + 30s cool-off | Irreversible. Double-checks DSAR cascade. |
| `billing` | Initiate disbursement, charge mobile money, void invoice | YES + 4-eyes | Money movement. Auto-bound by `PLATFORM_FEE_PERCENT`. |
| `external-comm` | Send WhatsApp/SMS/Email to >1 recipient | YES | Spam + reputation guardrail |

> The mapping lives in
> `packages/central-intelligence/src/kernel/risk-tier.ts`. Tiers are
> assigned per-tool in `kernel/tool-spec/hq-tools/*.ts`.

## Plan-artifact interpretation

Every pending approval ships a `planArtifact` object:

```json
{
  "id": "appr_01HX...",
  "tier": "destroy",
  "tool": "platform.cancel_lease",
  "actor": "kernel:agency-executor",
  "proposedAt": "2026-05-18T14:23:01Z",
  "expiresAt": "2026-05-18T14:38:01Z",
  "planArtifact": {
    "intent": "User asked to terminate lease #L-2026-441 effective today.",
    "downstreamEffects": [
      "Lease status: active → cancelled",
      "Outstanding invoices: 2 (TZS 740,000) — flagged for write-off",
      "Tenant notification: 1 WhatsApp + 1 email queued",
      "Cohort signal: tenant attrition cohort +1"
    ],
    "blastRadius": "single_tenant",
    "reversibility": "irreversible_after_billing_cycle_close"
  }
}
```

Approve only when:

1. The intent matches what the admin actually asked the brain.
2. The downstream effects are acceptable (read every bullet).
3. The blast radius is within the operator's authority.
4. The reversibility tier is consistent with the operator's confidence.

## Approve

Via Central Command UI: click "Approve" on the card. The brain
resumes the executor at the awaiting-approval step.

Programmatic:

```bash
curl -X POST "$API_BASE_URL/api/v1/approvals/$ID/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"signature":"<HMAC of approval id + admin secret>"}'
```

The kernel verifies the signature, marks the approval `executed=true`,
and replay-protection ensures the same approval cannot be re-played
even if the network duplicates the call.

## Recall

If the operator realizes the approval was a mistake before the kernel
actuates, recall via:

```bash
curl -X POST "$API_BASE_URL/api/v1/approvals/$ID/recall" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Wrong tenant id; will re-propose."}'
```

Recall before `executed=true` is always safe — no DB writes have
occurred yet. Recall after `executed=true` returns 409 and the
operator must use the per-tool compensation path (e.g.
`platform.reverse_disbursement` for billing tier).

## Replay-protection (`executed` flag) semantics

The `executed` flag on `sovereign_approvals` is the single source of
truth that an approval has been actuated. Once set:

- A second approve attempt returns 409 `APPROVAL_ALREADY_EXECUTED`.
- A recall attempt returns 409 `APPROVAL_ALREADY_EXECUTED`.
- The executor's own retry loop reads this flag first and short-circuits.

This protects against duplicate execution from network retries,
operator double-clicks, and replay attacks against captured tokens.

## What NOT to approve — checklist

- [ ] Plan-artifact mentions a tenant the admin doesn't recognize
- [ ] Blast radius is `platform_wide` for a routine ask
- [ ] Downstream effects include >5 destructive bullets
- [ ] The intent does not match the conversation history
- [ ] Money movement >`PLATFORM_MAX_AUTO_DISBURSEMENT_USD`
- [ ] Approval was triggered by a tool the admin doesn't recognize
- [ ] Persona drift event was raised in the last 24h for this brain

Any of the above → recall + re-prompt the brain with sharper intent.

## Escalation pathway

| Suspicion | Action |
|---|---|
| Brain proposing destructive ops without provocation | Recall; flip killswitch to `read-only`; page security |
| Approval queue growing > 50 items unattended | Page on-call admin |
| Approval queue empty for > 24h on a normally-busy tenant | Check `kernel_goals` — executor may be wedged |
| Recall of an `executed=true` approval | Engage payments-ops or compliance, depending on tier |

## Related

- `Docs/RUNBOOKS/killswitch.md` — emergency stop
- `Docs/RUNBOOKS/audit-chain-verification.md` — when to require deeper review
- `packages/central-intelligence/src/kernel/four-eye-approval.ts`
- `packages/database/src/schemas/sovereign-action-ledger.schema.ts`
