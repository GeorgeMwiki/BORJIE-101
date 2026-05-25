---
name: eviction-notice
description: Render a jurisdiction-specific eviction notice (TZ/KE/UG/NG) via Typst template. Pure rendering only — invocation requires that the operator skill `eviction-prep` already passed all gates (habitability, four-eye, court moratorium, lease verified). This skill does NOT decide whether eviction is justified; it formats the legally-mandated notice once the decision is made.
tools: Read, Write, Edit, Bash
---

# Eviction Notice Renderer — runtime skill

## ⚠️ Hard gate

This skill assumes the policy decision was already made and approved by the operator skill `eviction-prep`. Calling this skill directly without the prep gates is a constitution C09 violation. Composition root MUST reject direct invocation unless a valid `evictionPrepDecisionId` is presented.

## Inputs

```json
{
  "tenantId": "string",
  "leaseId": "string",
  "jurisdiction": "TZ|KE|UG|NG",
  "evictionPrepDecisionId": "string (uuid, signed by 2 approvers)",
  "language": "en|sw|sheng|lug|hausa",
  "noticeType": "non-payment|breach|term-end"
}
```

## Templates

| Jurisdiction | Template | Statutory ref |
|--------------|----------|---------------|
| TZ | `eviction-notice/tz/template.typ` | Land Act 1999 Sec. 53 |
| KE | `eviction-notice/ke/template.typ` | Land Act 2012 Sec. 152 |
| UG | `eviction-notice/ug/template.typ` | LTA 2022 |
| NG | `eviction-notice/ng/template.typ` | Recovery of Premises Law (state-specific) |

## Pipeline

1. **Verify** the `evictionPrepDecisionId` signature (two approvers, both `estate_manager`+).
2. **Resolve** lease + tenant + property + arrears amount + notice period per `jurisdiction`.
3. **Bind** the data to the matching Typst template.
4. **Render** via `typst-renderer.ts` (spawned typst binary, sandboxed).
5. **Citation verification** — every statutory reference + monetary figure must map to a citation.
6. **Watermark** as DRAFT until served; only the human operator's `serve` action removes the DRAFT mark.
7. **WORM audit** — append-only with the full chain of approvals.

## Hard rules

- **NEVER** render without a valid `evictionPrepDecisionId`.
- **NEVER** auto-serve. The PDF is queued for the operator to deliver via the appropriate channel.
- **ALWAYS** include the tenant's contact details for one final payment plan.
- **ALWAYS** stamp the language version used (mandatory in TZ + KE for tenant comprehension defense).

## Failure modes

- Decision-id signature invalid or stale (>14 days) → REFUSE.
- Template missing for jurisdiction → REFUSE with a code that points to the missing template path.
- Typst render error → escalate to the on-call SRE; do NOT fall back to HTML→PDF for legal notices.

## Outputs

- `eviction-notice-{leaseId}.pdf` (watermarked DRAFT until served)
- `citations-{leaseId}.json`
- Brain-event: `eviction.notice.rendered` (NOT `served`)
