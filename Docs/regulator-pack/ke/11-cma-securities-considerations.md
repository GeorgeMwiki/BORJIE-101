# 11 — CMA-KE — Capital Markets Considerations (Kenya)

**Document version:** 1.0
**Date:** 2026-05-22
**Owner:** CCO + CRO + Head of Strategy
**Jurisdiction:** Kenya
**Audience:** Capital Markets Authority of Kenya (CMA) examiners; CMA-regulated REIT managers, fund managers, pension custodians who are existing or prospective institutional landlord clients of Borjie; legal counsel.
**Frameworks:**
- Capital Markets Act (Cap. 485A)
- CMA Real Estate Investment Trusts (Collective Investment Schemes) Regulations 2013
- CMA Public Offers, Listings and Disclosures Regulations 2023
- CMA Code of Corporate Governance Practices for Issuers of Securities 2015

---

## 1. Why this annex exists

Borjie is **not** a CMA-regulated entity: we do not act as a REIT manager, trustee, fund manager, or any other licensed capital-markets intermediary. We are an operational software platform that property owners — some of whom **are** CMA-regulated — use to manage rental property.

This annex documents (a) the limits of our role, (b) the controls we provide that allow a CMA-regulated landlord to satisfy their outsourcing + disclosure obligations when using Borjie, and (c) the forward-looking position should Borjie in future enable **rent-roll-backed financial products** (e.g., receivables financing, rent-securitisation, REIT operational outsourcing) at scale, in which case Borjie's own regulatory perimeter may shift.

## 2. CMA-regulated client profile

The following client profiles use Borjie today or are reasonably foreseeable:

| Client profile | CMA touchpoint | Borjie role |
|---|---|---|
| REIT Manager (Income / Development) under CMA Reg. 4 / 5 | Annual filings, periodic reports, disclosures of material developments | Operational software for rent collection, lease lifecycle, tenant communication; produces audit trail + reports |
| Pension-fund custodian (RBA-regulated, holding income real estate) | Custodianship obligations; periodic valuation reports | Same operational role |
| Investment-fund manager (CMA-licensed) holding property in fund portfolio | Fund-rule compliance; investor reporting | Same operational role |
| DFI / multilateral landlord (e.g., Shelter Afrique, IFC affordable-housing portfolio) | DFI-level governance | Same |
| Private REIT in formation (D-REIT) | Pre-listing operational readiness | Same; subject to CMA pre-issuance review |

## 3. Outsourcing position (REIT manager's perspective)

A CMA-licensed REIT manager outsourcing operational property management to Borjie must satisfy CMA outsourcing expectations equivalent to CBK/PG/15 (covered in `02-cbk-cybersecurity-mapping.md` Section A). Specifically:

- **Materiality:** rent-collection and tenant-onboarding software is **material** to a REIT's day-to-day operations; institutional landlord clients classify Borjie accordingly.
- **Right of audit:** Borjie supplies this regulator-pack, SOC 2 Type II attestation (annual), and on-demand examiner access per MSA clause 14.
- **Service-level agreement:** documented in `Docs/OPERATIONAL_SLA.md` and per-client MSA, with KPIs covering uptime, payment-rail availability, audit-trail completeness, and incident response SLAs.
- **Sub-contracting consent:** REIT manager receives 30-day prior notice of any sub-processor change (doc 09 §1).
- **Cross-border data:** disclosed per doc 03 §6.
- **Contingency planning:** exit covered by doc 08 §1 (90-day data export, cryptographic erasure certificate).

## 4. Disclosure-friendly evidence sets

Where a CMA-regulated landlord is preparing an investor disclosure or material-developments filing, Borjie can supply structured evidence drawn directly from the audit chain (`packages/database/src/schemas/audit-events.schema.ts`, 120 lines, hash-chained via `packages/ai-copilot/src/security/audit-hash-chain.ts`, 651 lines):

- Rent-collection summary per property / per period
- Vacancy and turnover statistics
- Maintenance-spend and lifecycle history
- Tenant-screening + KYC audit trail (without exposing tenant PII to investor)
- Material-incident log (with PII redacted)
- AI-influenced material decisions affecting tenants (DPA s.35 register; cross-referenced in `06-fairness-and-non-discrimination.md`)

All disclosure packets are produced from immutable hash-chained records (`audit-trail.router.ts` + `admin-audit.router.ts`) and accompanied by a chain-verification report.

## 5. Forward-looking — rent-roll-backed financial products

If Borjie in future enables rent-roll-backed financial products (e.g., receivables financing for landlords, rent-tokenisation, lessor-finance underwriting that uses our credit-rating outputs from `packages/ai-copilot/src/credit-rating/` + `packages/central-intelligence/src/credit-scoring/alt-data-credit-model.ts`), the regulatory perimeter materially changes. Specifically:

- Receivables financing may bring Borjie within CMA Securities Act if structured as a public offer
- Tokenised rent-roll instruments would engage CMA's digital-asset framework (in development as of 2026)
- Tenant-credit underwriting outputs feeding such products engage both **DPA s.35** (automated decision affecting individuals) and **CMA suitability** (where the credit output is used to set investor-facing terms)

Borjie's current position: **no rent-roll-backed financial product is offered or planned for the next 12 months**. Any decision to enable such products requires (a) Board resolution, (b) external counsel opinion, (c) CMA engagement, (d) update of this annex + doc 01 §7 (Out of Scope), (e) DPIA-KE plus s.35 control review.

## 6. CMA-aligned implementation references

| Capability | Source-of-truth (path:line) |
|---|---|
| Audit chain (immutable hash-chained) | `packages/ai-copilot/src/security/audit-hash-chain.ts` (651 lines) + schemas |
| Sovereign-action ledger | `packages/database/src/schemas/sovereign-action-ledger.schema.ts` (98 lines) |
| Cross-tenant denial telemetry | `packages/database/src/schemas/cross-tenant-denials.schema.ts` (52 lines) |
| Tier-policy gate | `packages/central-intelligence/src/policy-gate/tier-policy-resolver.ts` (419 lines) |
| Credit-rating engine (gated; production wiring) | `packages/ai-copilot/src/credit-rating/` + `packages/central-intelligence/src/credit-scoring/alt-data-credit-model.ts` |
| Composition root | `services/api-gateway/src/composition/` (all `*-wiring.ts` files with kill-switches) |
| Reports — KE-formatted | `services/reports/src/compliance/ke-kra-formatter.ts` |
| Cross-portal kill-switch fan-out | `services/api-gateway/src/composition/cross-portal-killswitch-fanout.ts` |

## 7. Dashboards

| Dashboard | URL placeholder |
|---|---|
| Grafana — Daraja STK + Pesalink + KCB Buni + Equity Eazzy availability | `https://grafana.borjie.com/d/ke-banks/ke-bank-rail-availability` |
| Grafana — KE rent-collection reconciliation breaks | `https://grafana.borjie.com/d/ke-recon/ke-recon-breaks` |
| Grafana — KE audit-chain integrity | `https://grafana.borjie.com/d/audit-chain/audit-chain-integrity?var-region=KE` |
| Mission-Eval — KE credit-rating fairness slice | `https://mission-eval.borjie.com/project/borjie/dashboards/credit-rating-fairness?var-region=KE` |

---

## Appendix A — Board Sign-Off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| CCO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cco/regulator-pack-ke-11-v1.0` |
| CRO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cro/regulator-pack-ke-11-v1.0` |
| Head of Strategy | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/strat/regulator-pack-ke-11-v1.0` |
| KE Legal Counsel | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/legalke/regulator-pack-ke-11-v1.0` |
| Board Compliance Committee Chair | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/bcc/regulator-pack-ke-11-v1.0` |

## Appendix B — Version History

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial CMA-KE annex (Wave-12) | CCO + CRO |

## Appendix C — Review Cadence

- **Annual** — CCO + CRO review against current CMA / CMA-Capital-Markets-Tribunal guidance
- **Out-of-cycle** — any Board resolution toward rent-roll-backed financial products, new CMA digital-asset framework publication, or onboarding of any pre-listing D-REIT client
- **Quarterly** — CCO reviews CMA-regulated client roster + disclosure-evidence requests fulfilled
