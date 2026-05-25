# Borjie — Regulator Pack

**Version:** 1.0
**Date:** 2026-05-22
**Audience:** Tanzania regulators (BoT, TRA, NIDA, PDPC), Kenya regulators (CBK, KRA, ODPC), property-owner counsel, internal audit, external auditors (SOC 2 Type II), institutional landlords (NHC, pension-fund custodians) doing vendor due diligence.
**Maintainer:** Borjie Compliance Office (compliance@borjie.com)
**Classification:** Confidential — Regulator & Partner Distribution

---

## How to Use This Pack

This pack is the canonical evidence bundle for any examination, supervisory visit, or vendor due-diligence review of the Borjie property-management platform. Each numbered document is self-contained but cross-references neighbouring docs where useful.

Borjie is a **multi-tenant property-management SaaS** operating across East Africa. We are **not a financial institution** — we do not hold deposits, do not lend, and do not act as a payment service provider in our own name. Where we touch money (rent collection via M-Pesa / Airtel Money / GePG / KCB Buni / Pesalink), we do so as a technical conduit and reconciliation layer; the underlying licensed PSPs / banks hold the regulated function. Where we touch sensitive personal data (national IDs, lease terms, biometric KYC, financial standing) we are a **data controller for tenant identity** and a **data processor for property owner data**.

### Recommended reading paths

- **Bank of Tanzania (BoT) / Central Bank of Kenya (CBK) — payments hygiene review:** start with `tz/02` or `ke/02`, then `tz/07` / `ke/07` (incident response) and `tz/08` / `ke/08` (BCM/DR).
- **PDPC (TZ) / ODPC (KE) data-protection audit:** start with `tz/03` or `ke/03`, then `tz/09` / `ke/09` (sub-processors) and `tz/10` / `ke/10` (audit trail).
- **AML / KYC / tenant-identity review:** start with `tz/04` or `ke/04`.
- **AI / model-risk review (where AI is used in pricing, fraud, maintenance prioritisation, voice agent):** start with `tz/05` / `ke/05` and `tz/06` / `ke/06`.
- **Institutional landlord vendor onboarding (NHC, pension funds, DFIs):** start with `tz/01` or `ke/01`, then `09`, `08`, and the public SLA (`Docs/OPERATIONAL_SLA.md`).

Every "our implementation" claim in this pack references a real source-code file path in this monorepo. Examiners may request that the Borjie engineering team open any cited file during the review.

---

## Structure

```
Docs/regulator-pack/
  README.md                  ← this file
  tz/                        ← Tanzania pack (primary jurisdiction)
    01-system-overview.md
    02-bot-cybersecurity-mapping.md
    03-pdpa-mapping.md
    04-aml-kyc-controls.md
    05-model-risk-management.md
    06-fairness-and-non-discrimination.md
    07-incident-response.md
    08-business-continuity-and-DR.md
    09-vendors-and-subprocessors.md
    10-audit-trail-and-evidence.md
    model-cards/
      adaptive-layout-engine-v1.md   (UI-1)
      three-agent-debate-v1.md       (P-10)
      online-judge-v1.md             (P-9)
      tier-policy-resolver-v1.md     (F2)
      lats-search-v1.md              (F9)
      reflexion-sleep-v1.md          (F11)
  ke/                        ← Kenya pack (secondary jurisdiction)
    01..10 (parallel structure, KE regulators substituted)
    11-cma-securities-considerations.md  (KE-only, capital markets annex)
    model-cards/ (parallel — six cards mirroring tz/)
```

---

## Documents

| # | Tanzania | Kenya | Purpose |
|---|---|---|---|
| 01 | [System Overview](./tz/01-system-overview.md) | [System Overview](./ke/01-system-overview.md) | What Borjie is, jurisdictions, risk taxonomy, governance |
| 02 | [BoT Cybersecurity Mapping](./tz/02-bot-cybersecurity-mapping.md) | [CBK Cybersecurity Mapping](./ke/02-cbk-cybersecurity-mapping.md) | Per-section mapping to BoT / CBK supervisory expectations |
| 03 | [PDPA-TZ Mapping](./tz/03-pdpa-mapping.md) | [DPA-KE Mapping](./ke/03-dpa-mapping.md) | Data-protection statute mapping; DPIA template |
| 04 | [AML / KYC Controls](./tz/04-aml-kyc-controls.md) | [AML / KYC Controls](./ke/04-aml-kyc-controls.md) | Tenant-identity verification, source-of-funds for rent, sanctions / PEP |
| 05 | [Model Risk Management](./tz/05-model-risk-management.md) | [Model Risk Management](./ke/05-model-risk-management.md) | SR 11-7 mapping for AI components (kernel, voice agent, scoring) |
| 06 | [Fairness & Non-Discrimination](./tz/06-fairness-and-non-discrimination.md) | [Fairness & Non-Discrimination](./ke/06-fairness-and-non-discrimination.md) | Equal-treatment for tenants across protected attributes |
| 07 | [Incident Response](./tz/07-incident-response.md) | [Incident Response](./ke/07-incident-response.md) | P0-P3 severity, on-call, regulator notification SLA |
| 08 | [Business Continuity & DR](./tz/08-business-continuity-and-DR.md) | [Business Continuity & DR](./ke/08-business-continuity-and-DR.md) | RTO/RPO, multi-region failover, vendor BCP |
| 09 | [Vendors & Sub-Processors](./tz/09-vendors-and-subprocessors.md) | [Vendors & Sub-Processors](./ke/09-vendors-and-subprocessors.md) | M-Pesa, Airtel, KCB, Pesalink, Twilio, Supabase, Anthropic, etc. |
| 10 | [Audit Trail & Evidence](./tz/10-audit-trail-and-evidence.md) | [Audit Trail & Evidence](./ke/10-audit-trail-and-evidence.md) | Hash-chain immutability, retention, sample audit packet |

Model cards in `tz/model-cards/` and `ke/model-cards/` cover the six AI components most likely to draw regulatory scrutiny: the adaptive UI layout engine (UI-1), the multi-agent debate planner (P-10), the eval-on-traffic online judge (P-9), the constitution-v2 tier-policy resolver (F2), the LATS tree-search planner (F9), and the reflexion + sleep consolidation memory layer (F11).

Kenya-only annex `ke/11-cma-securities-considerations.md` documents the Capital Markets Authority (CMA) position for CMA-regulated institutional landlord clients (REIT managers, pension custodians) and the forward-looking perimeter if Borjie ever offers rent-roll-backed financial products.

---

## Document Maintenance

- Every document is reviewed **annually** by the Borjie Compliance Office.
- Any material change to a referenced source file or to a deployed model triggers an out-of-cycle review.
- Examiner or regulator changes to the underlying regulation trigger a within-30-day review.
- Version history is tracked in `git log Docs/regulator-pack/`.

## Cross-reference with COMPLIANCE/

This regulator-pack is **regulator-facing evidence**. The detailed control-level mappings (article-by-article) live in `Docs/COMPLIANCE/` (e.g. `TZ_PDPA_2022.md`, `SOC2_CONTROLS.md`). The regulator-pack documents cite back to `Docs/COMPLIANCE/` and to source code for the authoritative truth.

## Contact

- **Compliance & DPO:** compliance@borjie.com (DPO appointment in progress)
- **Security incidents:** security@borjie.com (24/7, P0 response < 1 h)
- **Regulator liaison:** regulator@borjie.com
- **Mailing address:** Borjie Limited, [TBD], Dar es Salaam, Tanzania
