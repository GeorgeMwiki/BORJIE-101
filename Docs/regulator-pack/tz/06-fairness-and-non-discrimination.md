# 06 — Fairness & Non-Discrimination (Tanzania)

**Document version:** 1.0
**Date:** 2026-05-22
**Owner:** CRO + CCO
**Jurisdiction:** Tanzania
**Frameworks:**
- Constitution of the United Republic of Tanzania, 1977 (Articles 12, 13 — equality, non-discrimination)
- Tanzania Land Act 1999 + Land (Lease) Regulations — equal treatment in residential tenancy
- Persons with Disabilities Act 2010 — anti-discrimination duty
- EEOC "4/5ths rule" (29 CFR § 1607.4(D)) — adopted by analogy as quantitative disparate-impact test
- EU AI Act Title III (high-risk AI) — forward-looking reference
- ISO/IEC TR 24027:2021 — bias in AI systems

> **Note:** Unlike financial services (where ECOA / Reg B prescribes adverse-action notice form), property management in Tanzania has **no equivalent prescriptive AI-decision notice standard**. Borjie adopts a self-imposed standard equivalent to ECOA / Reg B "specific and accurate" reasons for any AI-influenced material decision affecting a tenant.

---

## 1. Why non-discrimination matters in property management

Property management is a sector with documented historical bias (gender, disability, income source, language, area-of-origin). AI introduces new bias vectors: training data reflecting historical exclusions; algorithmic "neutral" features (e.g., neighbourhood ZIP code) that proxy protected attributes; opaque scoring that the tenant cannot challenge.

Borjie commits to fair treatment in three areas where AI directly influences tenant outcomes:

1. **Tenant onboarding / acceptance** — KYC, reference checks, predictive interventions surfacing "risk" labels
2. **Maintenance dispatch prioritisation** — SLA, vendor allocation, urgency scoring
3. **Communication tone & accessibility** — voice agent language defaults, escalation thresholds

## 2. Protected attributes

Borjie's fairness programme covers the following attributes (super-set of Tanzanian constitutional protections):

| Attribute | Source of risk | Statutory basis |
|---|---|---|
| Gender | Bias against women tenants or female-headed households | Constitution Art. 13; LDPC tenant complaints history |
| Age (≥ 18) | Bias against young / elderly tenants | Constitution Art. 13 |
| Disability | Bias against tenants requiring adaptations | Persons with Disabilities Act 2010 |
| Region / area of origin | Bias against tenants from specific regions | Constitution Art. 13 |
| Language (Swahili / English / regional) | Bias against Swahili-only or regional-language speakers | Constitution; conduct risk |
| Religion / ethnicity | Constitutional non-discrimination | Constitution Art. 13 |
| Marital status | Bias against single / single-parent tenants | Conduct risk |
| Income source (formal employment / self-employed / remittance / informal) | Bias against informal-economy tenants | Conduct risk; financial inclusion |

Source-of-truth for protected-attribute enforcement:

- AI safety layer reject-list — `packages/ai-copilot/src/security/prompt-shield.ts`
- PII scrubber categorisation — `packages/ai-copilot/src/security/pii-scrubber.ts` (511 lines)
- Sovereign-action review of decisions affecting tenants — `packages/database/src/schemas/sovereign-action-ledger.schema.ts` + `sovereign-approvals.schema.ts`
- Fairness slice telemetry — emitted to `audit-events.schema.ts` with event class `ai.fairness.slice_metric`

## 3. Fairness metrics

Borjie monitors five fairness metrics per AI model deployment:

1. **Disparate Impact Ratio** (4/5ths rule): selection (acceptance) rate for any protected group must be ≥ 80% of the rate of the highest group.
2. **Equal Opportunity Difference**: difference in true-positive rate between groups must not exceed a configurable threshold (default 0.10).
3. **Demographic Parity Difference**: difference in acceptance rates must not exceed a configurable threshold (default 0.10).
4. **Calibration Error**: per-group expected calibration error (ECE) must not exceed 0.05.
5. **Counterfactual Fairness**: for a sample of decisions, flipping the protected attribute must not flip the decision (sample ≥ 100 cases per quarter).

A "violation" is recorded when any metric breaches its threshold. Violations are categorised:

- `warning` (within 5% of threshold)
- `violation` (over threshold)
- `critical` (over threshold by > 10%)

Critical violations trigger automatic rollback to the previous champion model and a model-risk incident (doc 07).

## 4. Adverse-decision notice — bilingual template

For any AI-influenced material adverse decision affecting a tenant (e.g., declined application via institutional landlord using Borjie's screening output, eviction-warning communication triggered by predictive-interventions agent), Borjie produces a notice in **English and Swahili**.

### English template

```
Notice of Decision — [Tenant name]
Date: [yyyy-mm-dd]    Reference: [REF-XXXXXX]
Landlord: [Property owner name]    On behalf of: [Borjie as decision-support]

Dear [Tenant name],

We have considered your [application / lease renewal / etc.] dated [yyyy-mm-dd].
[Decision: regret-decline / counter-offer / additional-conditions].

The principal reasons for this decision are:

  1. [Specific factor 1, e.g. "Demonstrated income from the documents you provided is
     insufficient to meet the standard rent-to-income ratio of 30%."]
  2. [Specific factor 2]
  3. [Specific factor 3]

This decision was reached with the help of an automated system. You have the right to:
  - Request a human review (contact: [property-manager email])
  - Receive a copy of the data we relied on
  - Provide additional information that may change the decision
  - Complain to the Personal Data Protection Commission (PDPC) if you believe your data was misused.

The standards we apply are non-discriminatory: we do not consider your gender, age,
disability, region, religion, ethnicity, marital status, or language preference.

[Property manager name + signature]
```

### Swahili template

> TODO: complete Swahili translation; reference Tanzania-Swahili reading-level target (Form 4).

## 5. Property-management-specific fairness scenarios

| Scenario | Risk | Control |
|---|---|---|
| **Tenant application screening** | Predictive-interventions model assigns "high arrears risk" using features correlated with informal employment | Audit feature list; exclude proxy features; quarterly disparate-impact test; tenant has right to human review |
| **Maintenance dispatch priority** | Lower-income neighbourhoods get slower SLA because model trained on historical (biased) response times | Slice-level SLA monitoring; equal-treatment SLO across all neighbourhoods |
| **Voice agent language fallback** | Tenant speaking regional language gets shorter / less-helpful response | Test on regional-language corpus; explicit "escalate to human" prompt for low-confidence STT |
| **Rent-pricing surveillance** | Market-rate-surveillance model flags low-rent units in some neighbourhoods as "under-market" → pressure to raise rent → indirect discrimination | Property-owner-controlled; output is informational only; no automatic price change |
| **Eviction-warning automation** | Predictive-interventions triggers warning communication earlier for some demographic | All eviction-related communications require human (property-manager) review; no auto-send |

## 6. Audit & monitoring

- Daily fairness slice job: emits `fairness_metric_event` per model + per protected group
- Weekly DPO review of any `warning` events
- Quarterly Model Risk Committee review of `violation` + `critical` events
- Annual external fairness audit (planned 2027 onwards)

> TODO: insert most recent quarterly fairness report; insert disparate-impact dashboard screenshot.

## 7. Tenant rights & redress

- In-app "Challenge a decision" button on any AI-influenced notice
- Property-manager human review within 7 days
- Escalation to Borjie DPO if review not satisfactory
- Escalation to PDPC (data protection) or LDPC (tenancy) where statutory

---

## Appendix A — Board Sign-Off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| CRO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cro/regulator-pack-tz-06-v1.0` |
| CCO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cco/regulator-pack-tz-06-v1.0` |
| DPO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/dpo/regulator-pack-tz-06-v1.0` |
| Head of Customer Experience | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/hcx/regulator-pack-tz-06-v1.0` |

## Appendix B — Version History

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial scaffold | CRO + CCO |
| 1.1.0 | 2026-05-22 | Fairness enforcement path:line refs (Wave-12) | CRO + CCO |

## Appendix C — Review Cadence

- **Quarterly** — Model Risk Committee + DPO review fairness slice metrics + violation log
- **Out-of-cycle** — triggered by any `critical` fairness violation, regulator notice, or material feature change in `predictive-interventions-wiring.ts`
- **Annual** — external fairness audit (from 2027); board ratification of protected-attribute list

## Appendix D — Fairness Dashboards

| Dashboard | URL placeholder |
|---|---|
| Grafana — disparate impact by model | `https://grafana.borjie.com/d/fairness-di/disparate-impact-by-model` |
| Grafana — equal-opportunity slice | `https://grafana.borjie.com/d/fairness-eo/equal-opportunity-by-protected-group` |
| Grafana — challenge-button click-through and resolution | `https://grafana.borjie.com/d/fairness-challenge/challenge-resolution-time` |
| Mission-Eval — counterfactual fairness sample | `https://mission-eval.borjie.com/project/borjie/dashboards/counterfactual-fairness` |
