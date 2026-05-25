---
name: monthly-owner-report
description: Generate a monthly owner report for a single property owner in BORJIE. Pulls collections, vacancy, maintenance spend, NOI, and AI-narrated summary for the prior calendar month. Renders DOCX + PDF via Carbone, applies per-tenant brand, attaches Anthropic Citations span-IDs to every numeric figure. Triggered on a cron (1st of month 09:00 owner-local) or on demand from the owner portal.
tools: Read, Write, Edit, Bash, Grep
---

# Monthly Owner Report — runtime skill

## Inputs

```json
{
  "ownerId": "string",
  "tenantId": "string",
  "periodMonth": "YYYY-MM",
  "currency": "TZS|KES|UGX|NGN|RWF|ZAR|USD",
  "brandProfileId": "string|null"
}
```

## Pipeline

1. **Resolve** owner + properties + units + leases owned by `ownerId` in `tenantId`.
2. **Pull period data** (deterministic — no AI in this stage):
   - rent collected (per `rent-collected-metric.ts`)
   - vacancy days per unit (vacancy-filled metric)
   - maintenance spend (from `maintenance:list_*`)
   - operating expenses + property tax accruals
3. **Compute NOI, occupancy %, gross-yield, MoM deltas.**
4. **Narrative generation** via multi-LLM synthesizer (Opus + GPT-5 + DeepSeek), max 250 words, with the structured period data as the SINGLE source of truth. Every numeric claim must reference a row id (citation API).
5. **Render** via Carbone template `monthly-owner-report/<jurisdiction>.docx` with brand-profile substitution.
6. **Citation verification** — every numeric in the rendered DOCX must map to a citation; any orphan numeric ⇒ FAIL.
7. **PDF derivative** via `pdf-from-html-renderer.ts` (Puppeteer headless) for emailing.
8. **Hand to email** — queue via existing notifications service. Subject: "<Property Name> — <Month Year>".
9. **WORM audit** — append-only entry per generated report in `worm-audit.ts`.

## Hard rules

- **NEVER** narrate a numeric figure that does not have a row-id citation.
- **NEVER** include another owner's data in this report (RLS-enforced + verified in this skill).
- **ALWAYS** show MoM deltas, not just absolute values (owners react to direction).

## Failure modes

- Citation verification fail → quarantine the report, alert the operator with the missing citation list.
- Carbone server unavailable → fall back to HTML→PDF Puppeteer path; surface a warning in the WORM log.
- Multi-LLM synthesizer fails (synthesizerFallback=true) → annotate the report with "AI-narrative-degraded" and degrade to the highest-confidence proposer.

## Outputs

- `report-{ownerId}-{periodMonth}.docx`
- `report-{ownerId}-{periodMonth}.pdf`
- `citations-{ownerId}-{periodMonth}.json` (audit + verification record)
- Brain-event: `report.monthly-owner.delivered`

## SLO

- Cron-mode latency P95 ≤ 90 seconds per report.
- On-demand mode latency P95 ≤ 8 seconds (citation verify is the tail; Carbone render is ~1s).
- Failure rate ≤ 0.5% per month; failures alert SRE + the owner-relations team.
