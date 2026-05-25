# 06 — Fairness & Non-Discrimination (Kenya)

**Document version:** 1.0
**Date:** 2026-05-22
**Owner:** CRO + CCO
**Jurisdiction:** Kenya
**Frameworks:**
- Constitution of Kenya, 2010 (Article 27 — equality and freedom from discrimination)
- Landlord and Tenant (Shops, Hotels and Catering Establishments) Act (Cap. 301)
- Rent Restriction Act (Cap. 296)
- Persons with Disabilities Act 2003 (revised)
- HIV and AIDS Prevention and Control Act 2006 — explicit prohibition on discrimination in housing
- Sexual Offences Act 2006
- DPA 2019 s.35 — right not to be subject to automated decision
- EEOC "4/5ths rule" (29 CFR § 1607.4(D)) — adopted by analogy
- EU AI Act Title III — forward-looking reference
- ISO/IEC TR 24027:2021 — bias in AI systems

> **Distinguishing feature from TZ pack:** Kenya's HIV and AIDS Prevention and Control Act 2006 s.31 explicitly prohibits HIV-status-based discrimination in housing. Borjie does not collect health data; this is reinforced in the AI safety layer (`packages/ai-copilot/src/safety/`). Additionally, DPA s.35 creates a statutory right to human review of automated decisions.

---

## 1. Why non-discrimination matters in Kenyan property management

Kenyan property management has well-documented patterns of discrimination on tribal, religious, and ability-to-pay-cash-deposits grounds. The Article 27 list and Persons with Disabilities Act create a statutory baseline. The Landlord and Tenant Act + Rent Restriction Act create procedural safeguards. AI amplifies risk: training data reflects historic exclusions; opaque scoring cannot be challenged; voice-agent dialect coverage may default to dominant variants.

Borjie commits to fair treatment in three areas where AI directly influences tenant outcomes:

1. **Tenant onboarding / acceptance** — KYC, reference checks, predictive arrears risk
2. **Maintenance dispatch prioritisation** — SLA, vendor allocation, urgency scoring
3. **Communication tone & accessibility** — voice agent language defaults, escalation thresholds

## 2. Protected attributes (Kenya)

| Attribute | Source of risk | Statutory basis |
|---|---|---|
| Gender | Bias against women / female-headed households | Constitution Art. 27(4) |
| Pregnancy | Tenant turned away during pregnancy | Constitution Art. 27 |
| Age (≥ 18) | Bias against young or elderly tenants | Constitution Art. 27 |
| Disability | Bias against tenants needing adaptations | Persons with Disabilities Act 2003 |
| HIV status | Statutorily prohibited in housing | HIV and AIDS Prevention and Control Act 2006 s.31 |
| Health (any) | Borjie does not collect | Not processed |
| Ethnicity / tribe | Constitutional non-discrimination | Constitution Art. 27 |
| Religion | Constitutional non-discrimination | Constitution Art. 27 |
| Marital status | Bias against single / single-parent tenants | Constitution Art. 27 |
| Sexual orientation | High-risk in KE; constitutional protection contested but Borjie refuses to use | Constitution Art. 27; Borjie policy |
| Income source | Informal economy bias | Conduct risk; financial inclusion |
| Language / dialect | Sheng / coastal Kiswahili coverage | Constitution; conduct risk |

Source-of-truth (KE):

- AI safety reject-list (incl. HIV non-collection enforcement) — `packages/ai-copilot/src/security/prompt-shield.ts`
- PII scrubber categorisation — `packages/ai-copilot/src/security/pii-scrubber.ts` (511 lines)
- s.35 review-right enforcement — `packages/central-intelligence/src/policy-gate/tier-policy-resolver.ts` (419 lines) + `services/api-gateway/src/routes/gdpr.router.ts`
- Sovereign action ledger — `packages/database/src/schemas/sovereign-action-ledger.schema.ts`
- KE fairness slice telemetry — `audit-events.schema.ts` with `region = 'KE'`

## 3. Fairness metrics

Same five metrics as TZ pack (see `tz/06-fairness-and-non-discrimination.md` §3): Disparate Impact Ratio (4/5ths), Equal Opportunity Difference, Demographic Parity Difference, Calibration Error, Counterfactual Fairness.

Critical violations → auto-rollback + model-risk incident.

## 4. Adverse-decision notice — bilingual template

DPA s.35 creates a right of human review on any automated decision. For any AI-influenced material adverse decision affecting a tenant, Borjie produces a notice in **English and Kiswahili** including the s.35 review CTA.

### English template

```
Notice of Decision — [Tenant name]
Date: [yyyy-mm-dd]    Reference: [REF-XXXXXX]
Landlord: [Property owner name]    On behalf of: [Borjie as decision-support]

Dear [Tenant name],

We have considered your [application / lease renewal / etc.] dated [yyyy-mm-dd].
[Decision: regret-decline / counter-offer / additional-conditions].

The principal reasons for this decision are:

  1. [Specific factor 1]
  2. [Specific factor 2]
  3. [Specific factor 3]

This decision was reached with the help of an automated system. Under Kenya's Data
Protection Act 2019 section 35, you have the right to:
  - Object to an automated decision and request a human review (within 7 days)
  - Receive a copy of the data we relied on
  - Provide additional information that may change the decision
  - Complain to the Office of the Data Protection Commissioner (ODPC)

To exercise your s.35 right, click the "Challenge this decision" button in the
Borjie app or contact [property-manager email].

The standards we apply are non-discriminatory: we do not consider your gender,
pregnancy, age, disability, HIV status, ethnicity, tribe, religion, marital
status, sexual orientation, language, or income source.

[Property manager name + signature]
```

### Kiswahili template

> TODO: complete Kiswahili translation; reference KE-Kiswahili reading-level target.

## 5. Property-management-specific fairness scenarios

Same scenarios as TZ pack with KE overlays:

| Scenario | KE risk overlay |
|---|---|
| **Tenant application screening** | Informal-economy bias particularly material in KE; predictive-interventions agent runs in KE-strict mode (stakes = high) |
| **Maintenance dispatch priority** | Nairobi-tier-1 vs. tier-2 / rural neighbourhoods; slice-level SLA monitoring |
| **Voice agent dialect** | Sheng + coastal Kiswahili must be in adversarial corpus |
| **Rent-pricing surveillance** | Rent Restriction Act applies to controlled tenancies; surveillance output must not push above the controlled rate |
| **Eviction-warning automation** | KE Landlord and Tenant Act creates procedural requirements (Form A notice, tribunal recourse); no auto-send |

## 6. Audit & monitoring

Same cadence as TZ pack. KE-specific:

- ODPC-aware quarterly fairness report
- Slice audit covers KE protected attributes (esp. HIV-non-collection verification — confirm zero records)

## 7. Tenant rights & redress

- In-app "Challenge a decision" button (statutory s.35 right)
- Property-manager human review within 7 days
- Escalation to Borjie DPO if review not satisfactory
- Escalation to ODPC (data protection) or Rent Restriction Tribunal / Business Premises Rent Tribunal (tenancy)

## 8. KE fairness dashboards

| Dashboard | URL placeholder |
|---|---|
| Grafana — KE disparate-impact by model | `https://grafana.borjie.com/d/fairness-di/disparate-impact-by-model?var-region=KE` |
| Grafana — KE s.35 challenge throughput | `https://grafana.borjie.com/d/s35-challenges/s35-challenge-resolution` |
| Mission-Eval — counterfactual fairness sample (KE) | `https://mission-eval.borjie.com/project/borjie/dashboards/counterfactual-fairness-ke` |
| Grafana — HIV-non-collection verification (must be zero) | `https://grafana.borjie.com/d/hiv-zero/hiv-zero-collection-verify` |

> TODO: insert KE quarterly fairness dashboard; insert sample s.35 challenge log.

---

## Appendix A — Board Sign-Off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| CRO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cro/regulator-pack-ke-06-v1.0` |
| CCO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cco/regulator-pack-ke-06-v1.0` |
| DPO (ODPC-registered) | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/dpo/regulator-pack-ke-06-v1.0` |
| Head of Customer Experience | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/hcx/regulator-pack-ke-06-v1.0` |

## Appendix B — Version History

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial scaffold | CRO + CCO |
| 1.1.0 | 2026-05-22 | KE fairness enforcement refs + dashboards (Wave-12) | CRO + CCO |

## Appendix C — Review Cadence

- **Quarterly** — KE-region fairness slice + s.35 challenge review
- **Out-of-cycle** — ODPC notice, critical violation, new KE protected attribute case-law
- **Annual** — external fairness audit (2027+); board ratification of protected-attribute list
