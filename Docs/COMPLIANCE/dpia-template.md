# Data Protection Impact Assessment — Template

_Required by: GDPR Art. 35, PDPA TZ s. 23, DPA KE s. 31, NDPA NG s. 28._

A DPIA must be performed BEFORE any "likely to result in a high risk" processing
begins. It is a living document — revisit on material change.

---

## DPIA-{ID}: {Processing-Activity Name}

| Metadata | |
|---|---|
| DPIA ID | DPIA-YYYY-NNNN |
| Version | 1.0 |
| Date | YYYY-MM-DD |
| Author (DPO) | `<DPO_CONTACT>` |
| Sign-off (Controller) | `<CONTROLLER_OFFICER>` |
| Jurisdictions in scope | TZ / KE / NG / EU / ... |
| Linked codebase modules | e.g., `packages/central-intelligence/src/credit-scoring/` |

## 1. Description of the processing

### 1.1 Nature, scope, context, purposes

- **Nature**: What kind of processing? (e.g., automated tenant credit scoring)
- **Scope**: How much? (e.g., all tenants applying for a lease)
- **Context**: Operational setting (e.g., consumer-facing rental marketplace)
- **Purpose**: Why? (e.g., reduce default risk for property owners; speed lease approval)

### 1.2 Data flows

| Source | Data categories | Recipient | Purpose | Retention |
|---|---|---|---|---|
| customers table | basic PII, KRA PIN, income | scoring model | inference | 7 years |
| payments history | rent payment events | scoring model | feature input | 7 years |
| ... | ... | ... | ... | ... |

(Use the data-flow diagram tool: `<DFD_LINK>`.)

### 1.3 Lawful basis

| Activity | Basis | Statute |
|---|---|---|
| Credit-scoring inference | Legitimate interest (Art. 6(1)(f)) | GDPR + PDPA s. 7(f) + DPA s. 30(1)(f) + NDPA s. 25(1)(f) |
| Cross-border transfer | SCC + consent | GDPR Art. 46 + Art. 49(1)(a) |

## 2. Necessity & proportionality

- Is the processing necessary for the purpose? **Justify** rather than assert.
- Could the purpose be achieved with less data? **What was minimised away?**
- Is the processing the least-intrusive way to achieve the purpose?
- Are there opt-out mechanisms? Granularity? Defaults?

## 3. Consultation

- Internal: engineering, legal, security
- External: data subjects (where practical via beta panels)
- Regulator pre-consultation (Art. 36): required when DPIA concludes
  residual high risk

## 4. Risk assessment

Identify each risk; rate likelihood (1–5) × severity (1–5):

| Risk | Likelihood | Severity | Score | Mitigation |
|---|---|---|---|---|
| Re-identification via inference | 3 | 4 | 12 | k-anonymity ≥5 on aggregates; no per-feature exposure to lender |
| Model drift causing unfair decisions | 4 | 4 | 16 | Quarterly fairness audit; protected-class regression test |
| Bias against women / informal-economy workers | 4 | 5 | 20 | Disparate-impact test; manual override threshold; appeals route |
| Credential compromise → PII exfiltration | 2 | 5 | 10 | Field-level encryption; quarterly key rotation; MFA on admins |
| Cross-border surveillance access | 2 | 4 | 8 | SCC + TIA + supplementary measures |

(For each risk ≥ 12: an explicit mitigation. Risks ≥ 20: explicit residual-risk
sign-off by the controller's officer.)

## 5. Mitigations

For each mitigation listed above:
- **Owner**: who implements
- **Implementation date**: when in place
- **Verification method**: how we know it works
- **Code reference**: where in the codebase

Example:

| Mitigation | Owner | Date | Verification | Code |
|---|---|---|---|---|
| Disparate-impact regression test | ML lead | 2026-06 | Weekly CI run | `packages/central-intelligence/src/credit-scoring/__tests__/fairness.test.ts` |
| Manual override + appeal route | Product lead | 2026-07 | Customer-app UI walkthrough | `apps/customer-app/src/app/scoring/appeal/` |

## 6. Auto-decision-making (Art. 22 / s. 37 / s. 35 / s. 40)

If the processing involves a decision based **solely** on automated processing
that produces legal effects or similarly significant effects:

- [ ] Subject informed at point of collection
- [ ] Subject has right to obtain human review (`<APPEAL_ROUTE>`)
- [ ] Subject has right to express their point of view
- [ ] Subject has right to contest the decision
- [ ] Explainability mechanism in place: `<EXPLANATION_DOC>`

## 7. International transfer

If transfer leaves the jurisdiction:
- Mechanism: SCC / adequacy / BCR / Art. 49 derogation
- TIA reference: `<TIA_DOC>`
- Supplementary measures: list

## 8. Sub-processor list (if novel)

| Sub-processor | Role | Location | DPA on file |
|---|---|---|---|
| `<SUB_PROCESSOR_1>` | ... | ... | ✓ |

## 9. Conclusion

- [ ] Residual risk is acceptable
- [ ] Residual risk is high — Art. 36 / s. 31 pre-consultation with regulator required
- [ ] Processing must be redesigned before launch

Sign-off:

| Role | Name | Date | Signature |
|---|---|---|---|
| DPO | `<DPO_NAME>` | | `<SIGNATURE>` |
| Controller | `<CONTROLLER_NAME>` | | `<SIGNATURE>` |
| ML lead | `<ML_LEAD>` | | `<SIGNATURE>` |

## 10. Review cadence

- Next review date: YYYY-MM-DD (≤12 months)
- Trigger-driven reviews: any material change to model, data, scope, or regulator landscape

---

## Appendix A — DPIA register

The full DPIA register (all DPIAs across the platform) lives at:
`<DPIA_REGISTER_PATH>` — typically the legal repo, mirrored as a hash digest
in the sovereign-action-ledger for tamper evidence.

## Appendix B — Codebase touchpoints

- DPIA-driving activities should declare their DPIA-ID in the package
  `README.md` (or service-level docstring)
- ML-bound activities additionally surface DPIA-ID in their model card
