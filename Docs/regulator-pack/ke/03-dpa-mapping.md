# 03 — Kenya Data Protection Act 2019 — Mapping & DPIAs

**Document version:** 1.0
**Date:** 2026-05-22
**Owner:** Data Protection Officer (DPO)
**Jurisdiction:** Kenya
**Statute:** Data Protection Act 2019 (Cap. 411C); Data Protection (General) Regulations 2021; Data Protection (Compliance and Enforcement) Regulations 2021; Data Protection (Registration of Data Controllers and Data Processors) Regulations 2021.

> **Note on citations:** Section numbering follows the Kenya Gazette publication of Act No. 24 of 2019. Where text is reproduced it is summarised. Examiners should consult the Gazette for the authoritative text. ODPC website: `https://www.odpc.go.ke/`.

---

## 1. Registration (DPA s.18; Reg. 2021)

Borjie is registered with the ODPC as:

- **Data Controller** (for tenant identity and tenant communications)
- **Data Processor** (for property-owner data processed on their behalf)

> TODO: insert ODPC registration certificate number + renewal date.

DPO appointment notified to ODPC per DPA s.24 + Reg. 6 of Compliance and Enforcement Regulations.

## 2. Lawful basis (DPA s.30)

Borjie processes personal data on the following lawful bases:

| Processing | Lawful basis | Notes |
|---|---|---|
| Tenant onboarding (KYC: IPRS lookup, ID OCR, liveness) | Consent + legitimate interest of landlord | Consent captured at signup |
| Rent collection + reconciliation | Contract performance (lease) | |
| Lease lifecycle | Contract performance | |
| Maintenance request handling | Contract performance + legitimate interest | |
| Owner / investor portfolio dashboards | Legitimate interest of property owner | Balancing test documented |
| Voice agent recordings | Explicit consent | Bilingual sw/en |
| Marketing communications | Consent (opt-in) | Withdrawable |
| Audit log | Legal obligation (tax, accounting) | |

Full register at `Docs/COMPLIANCE/lawful-basis-register.json`.

## 3. Principles (DPA s.25)

Identical to TZ-PDPA Article 5 principles (see `tz/03-pdpa-mapping.md` §1). DPA s.25 enumerates: lawfulness, fairness, transparency, purpose-limitation, data-minimisation, accuracy, storage-limitation, integrity-confidentiality, accountability.

## 4. Data subject rights (DPA s.26)

| Right | DPA reference | How exercised | SLA |
|---|---|---|---|
| Information (privacy notice) | s.29 | Privacy notice at signup; layered | Immediate |
| Access | s.26(a) | Self-serve "Export my data" | < 30 days |
| Rectification | s.26(b) | Self-serve profile edit | Immediate (self-serve) |
| Erasure | s.26(c) | Self-serve "Delete my account" → 30-day grace → crypto erasure | < 30 days |
| Restriction | s.26(d) | DPO-routed | < 7 days |
| Object | s.26(e) | DPO-routed | < 7 days |
| Portability | s.34 | JSON / CSV bundle | < 30 days |
| Not be subject to automated decision (s.35) | s.35 | Right to human review on any AI-influenced material decision (see doc 06 §4) | < 7 days |

DPA s.35 specifically grants the right not to be subject to a decision based solely on automated processing. Borjie implements this via the "Challenge a decision" button on any AI-influenced notice + human-in-the-loop on eviction-related, fairness-flagged or stakes-high actions.

## 5. Sensitive personal data (DPA s.44)

DPA s.44 identifies sensitive personal data (race, health, ethnic-social origin, conscience, belief, genetic, biometric, property details, marital status, family details, sex / sexual orientation). Several of these intersect property management directly.

**Borjie handling:**

- **Biometric data (face liveness for KYC):** processed by Smile Identity; explicit consent; hash + match score retained (not raw image); 7-year retention.
- **Property details:** core to the lease purpose; processed under contract.
- **Marital status:** collected only when required by lease (e.g., joint tenancy); never used for AI-influenced decision features (see doc 06).
- **Family details:** collected only where required (e.g., dependents on a residential lease); access scoped + audit-logged.
- **Health data:** **NOT processed**.
- **Ethnic-social origin / belief / sexual orientation:** **prohibited inputs**; AI safety layer rejects.

## 6. Cross-border transfer (DPA s.48–s.50)

DPA s.48 prohibits cross-border transfer unless: (a) adequate safeguards (SCCs / BCRs), (b) consent, (c) necessary for contract, (d) public interest, (e) data subject's vital interest, (f) compelling legitimate interests, or (g) ODPC's notification regime.

**Borjie compliance:**

- Current cross-border transfers are to **EU-resident** providers (Supabase fra1, Vercel fra1) — EU adequacy generally accepted.
- US transfers (Anthropic, OpenAI, Twilio, Smile Identity) rely on EU SCCs + DPA-Kenya-specific addenda.
- Tenant consent captured at signup with explicit mention of cross-border transfer.
- ODPC notification per s.48(4): in preparation. See `Docs/COMPLIANCE/cross-border-transfer-policy.md`.

## 7. Breach notification (DPA s.43)

DPA s.43: notification to ODPC within 72 hours of becoming aware of a breach likely to result in risk to data-subject rights. Affected data subjects to be notified without undue delay.

**Borjie internal target: 24 h from confirmation.** See doc 07 §5.

## 8. DPIAs (DPA s.31)

Same DPIA programme as TZ pack (see `tz/03-pdpa-mapping.md` §6). DPIAs registered with ODPC where required by Reg. 2021.

| DPIA-ID | Processing | Risk score | Status |
|---|---|---|---|
| DPIA-KE-001 | Tenant identity onboarding (IPRS + liveness) | Medium-high | TODO — DPO sign-off pending |
| DPIA-KE-002 | Voice agent — tenant call recording + STT | Medium-high | TODO — DPO sign-off pending |
| DPIA-KE-003 | Predictive interventions agent (cross-ref with DPA s.35 right) | High | TODO — DPO sign-off + fairness review |
| DPIA-KE-004 | Adaptive layout engine | Low-medium | TODO — DPO sign-off pending |

## 9. ODPC enforcement (DPA Part X)

ODPC has enforcement powers including penalty notices up to KES 5,000,000 or 1% of annual turnover, whichever lower (DPA s.63). Borjie controls:

- Field-level encryption, RLS, RBAC, AI safety layer (preventing unlawful processing)
- DPO + CCO four-eyes on ODPC responses
- 24-h SLA for ODPC enquiries

> TODO: insert ODPC contact card + escalation matrix.

## 10. DPA s.35 implementation refs

| Capability | Source-of-truth (path:line) |
|---|---|
| Automated-decision detection (stakes ≥ medium triggers review-right) | `packages/central-intelligence/src/policy-gate/tier-policy-resolver.ts` (419 lines) |
| Challenge button + human-review queue | `services/api-gateway/src/routes/gdpr.router.ts` + `services/api-gateway/src/routes/dsar.router.ts` |
| Sovereign action ledger (recording of every automated decision) | `packages/database/src/schemas/sovereign-action-ledger.schema.ts` (98 lines) |
| Reflexion audit of guideline updates | `packages/database/src/schemas/reflexion-buffer.schema.ts` |

---

## Appendix A — Board Sign-Off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| DPO (ODPC-registered) | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/dpo/regulator-pack-ke-03-v1.0` |
| CCO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cco/regulator-pack-ke-03-v1.0` |
| Legal Counsel | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/legal/regulator-pack-ke-03-v1.0` |
| Board Compliance Committee Chair | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/bcc/regulator-pack-ke-03-v1.0` |

## Appendix B — Version History

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial scaffold | DPO |
| 1.1.0 | 2026-05-22 | s.35 implementation refs (Wave-12) | DPO |

## Appendix C — Review Cadence

- **Annual** — full review by DPO + ODPC re-registration check
- **Out-of-cycle** — ODPC directive, new high-risk processing, s.35 challenge-rate spike
- **Quarterly** — DPO reviews DSAR + s.35 challenge SLAs
