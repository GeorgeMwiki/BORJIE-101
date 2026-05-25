# Model Card — Adaptive Layout Engine v1 (UI-1)

**Model ID:** `adaptive-layout-engine-v1`
**Version:** 1.0
**Date:** 2026-05-22
**Owner:** UX team (Brain · UI surface)
**Jurisdiction:** Tanzania (TZ pack)
**Stakes:** Low (cosmetic — UI rearrangement only; no material decisions)
**Status:** Production

---

## Purpose

The Adaptive Layout Engine personalises the order, size and prominence of UI panels in the Borjie customer-app and estate-manager-app based on the user's recent interactions. It surfaces the most-used actions higher and hides rarely-touched panels. The goal is to reduce time-to-task for high-frequency workflows (pay rent, log maintenance, view receipts).

## Architecture

Hybrid: rule-based scorer + light LLM rationale layer.

1. Action-frequency rollup per user (last 30 days) computed nightly into `user_action_stats`.
2. Rule-based ranker assigns a score to each candidate panel.
3. LLM (Claude Haiku) generates a one-line rationale for any panel rearrangement and validates the proposed layout against accessibility rules.
4. Final layout cached for the user for 24 h.

## Training data

**Rule-based primarily — no model training.** The Haiku rationale layer is a frozen foundation model; we do not fine-tune. Inputs to the rule-based ranker are aggregate counts only (no PII passed to the LLM).

## Inputs

- `user_action_stats` (counts per action category, last 30 days)
- `user_role` (tenant / property-mgr / owner)
- `accessibility_preferences` (high contrast, large text, screen reader)
- `device_class` (mobile / tablet / desktop)

## Outputs

- Ordered list of panels with scores
- One-line rationale per move (e.g., "Rent panel moved up because tenant paid 3x last month")
- Accessibility-valid flag

## Performance

| Metric | Target | Last measured |
|---|---|---|
| Time-to-first-meaningful-paint | < 1.5 s | TODO |
| Task-completion-time for top-3 actions | -20% vs. fixed layout | TODO |
| Accessibility WCAG 2.2 AA | 100% pass | TODO |
| Layout-override rate (user manually re-pins) | < 10% | TODO |

## Limitations

- Cold-start: new users see default layout for first 7 days
- Mobile-first design; small desktops may see suboptimal density
- Does not consider time-of-day or seasonal patterns
- Cannot personalise beyond panel ordering (no inter-panel content reorder)

## Monitoring

- Daily job emits `layout_adaptation_event`
- Override-rate dashboard tracked by UX team
- Fairness slice: ensure adaptation effectiveness equal across regions and language preferences (cross-ref doc 06)

## Privacy

- No PII passed to LLM rationale layer (aggregate counts only)
- Action stats are user-scoped; never aggregated across users for personalisation
- DPIA-004 (low-medium risk, TODO sign-off)

## Implementation

| Component | Source-of-truth (path:line) |
|---|---|
| Layout engine + scoring | `packages/dynamic-sections/` + `packages/genui/` |
| Layout persistence | `packages/database/src/schemas/section-layouts.schema.ts` + `blocks.schema.ts` |
| Action-frequency rollup | `packages/database/src/schemas/implicit-feedback-signals.schema.ts` |
| User progressive-disclosure state | `packages/database/src/schemas/progressive-context.schema.ts` |
| Rationale-layer prompt | LLM provider routing in `packages/ai-copilot/src/providers/`; PII never leaves the scrubber `packages/ai-copilot/src/security/pii-scrubber.ts` |

## Monitoring dashboards

| Dashboard | URL placeholder |
|---|---|
| Mission-Eval — layout-override rate | `https://mission-eval.borjie.com/project/borjie/dashboards/ui-layout-override-rate` |
| Grafana — TTFM and task-completion-time slice | `https://grafana.borjie.com/d/ui-perf/ui-performance-by-layout` |

## Version history

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial release (UI-1 wave) | UX team lead |
| 1.0.1 | 2026-05-22 | Implementation path:line refs + dashboards (Wave-12) | UX team lead |

## Sign-off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| Model Risk Manager | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/mrm/model-card-adaptive-layout-v1.0` |
| UX Team Lead | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/ux/model-card-adaptive-layout-v1.0` |
| DPO | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/dpo/model-card-adaptive-layout-v1.0` |

## Review cadence

- **Quarterly** — UX team reviews layout-override rate + task-completion-time
- **Out-of-cycle** — any change to `dynamic-sections` engine, accessibility violation, or DPIA-004 status change

> TODO: collect 30 days of production metrics and update Performance section before next quarterly review.
