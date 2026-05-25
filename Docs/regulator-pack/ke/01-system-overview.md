# 01 — System Overview (Kenya)

**Document version:** 1.0
**Date:** 2026-05-22
**Owner:** Chief Risk Officer (CRO) + Chief Compliance Officer (CCO)
**Jurisdiction:** Republic of Kenya

---

## 1. What Borjie is

Borjie is a multi-tenant, AI-native property-management platform serving residential and commercial landlords, estate management companies, tenants and back-office operations teams across East Africa. The platform digitises rent collection, lease lifecycle, maintenance dispatch, tenant communication and owner reporting, with an AI "Brain" (kernel) layered on top of an operational backbone.

The platform is **operational software, not a financial institution**: Borjie does not hold deposits, does not lend, does not provide investment advice, and is not a payment service provider in its own name. In Kenya, rent payments flow through licensed mobile-money operators and PSPs (Safaricom M-Pesa Kenya, Airtel Money Kenya, Pesalink, KCB Buni, Equity Eazzy); Borjie is the reconciliation layer and tenant ledger of record.

Core capabilities — same monorepo paths as the TZ pack (see `tz/01-system-overview.md` §1.1 for the full path:line table). The Kenya deployment shares the same codebase, with region selection at the tenant level controlling MNO routing, ID-verification adapter and tax-reporting adapter. The region toggle is implemented through `packages/database/src/schemas/identity.schema.ts` (`tenants.region`) and wired through `services/api-gateway/src/composition/service-context.middleware.ts`; KE-specific reporters live at `services/reports/src/compliance/ke-kra-formatter.ts`.

## 2. Jurisdictions

Primary jurisdiction for this pack is **Republic of Kenya**.

| Jurisdiction | Status | Primary regulator(s) | Key statute(s) |
|---|---|---|---|
| Kenya | Live | Central Bank of Kenya (CBK — payments hygiene + open banking), Kenya Revenue Authority (KRA — landlord tax), NIDA-KE / IPRS (national-ID), Office of the Data Protection Commissioner (ODPC), Capital Markets Authority (CMA — only for REITs / fund-managed portfolios), Communications Authority (CA) | Data Protection Act 2019 (Cap. 411C); Landlord and Tenant (Shops, Hotels and Catering Establishments) Act (Cap. 301); Rent Restriction Act (Cap. 296); Income Tax Act (Cap. 470); Kenya Information and Communications Act |
| Tanzania | Live (parallel pack) | BoT, TRA, PDPC | PDPA 2022 |
| Uganda | Roadmap | Bank of Uganda, URA, NITA-U | Data Protection and Privacy Act 2019 |
| Rwanda | Roadmap | NBR, RRA | Law on Protection of Personal Data 2021 |

The default deployment for KE tenants is **Africa-resident where possible**: Supabase Frankfurt (`fra1`) primary with cross-region replicas, with a roadmap to a Kenya-resident or AWS Nairobi-region primary as soon as it becomes commercially available. Cross-border transfers are documented vendor-by-vendor in `09-vendors-and-subprocessors.md`.

## 3. Risk Taxonomy

Same risk taxonomy as TZ pack (see `tz/01-system-overview.md` §3). Kenya-specific differences:

- **Payments / settlement risk** also covers Pesalink, KCB Buni, Equity Eazzy as bank rails; M-Pesa Kenya operates under CBK's National Payment System Act 2011 + Regulations 2014.
- **Compliance / legal risk** is shaped by the Rent Restriction Act (controlled tenancies under KES 2,500/month — niche but real), Landlord and Tenant Act (commercial leases), and the Income Tax Act's Monthly Rental Income (MRI) regime (10% tax on residential rent).
- **AI / model risk** is amplified by ODPC's stricter automated-decision-making expectations under DPA 2019 s.35.

## 4. Governance Structure

Same as TZ pack. Same roles, same four-eyes principle. Kenya-specific:

- DPO is registered with the ODPC per the Data Protection (General) Regulations 2021 — TODO confirm registration.
- For institutional landlord clients regulated by CBK or CMA (e.g., REIT managers, pension custodians), Borjie supports their outsourcing-policy obligations under CBK Prudential Guideline CBK/PG/15 (Outsourcing) and CMA REIT Regulations.

## 5. Architecture Snapshot

Same as TZ pack (Vercel + Supabase + multi-MNO). Kenya-specific MNO routing:

- **Safaricom M-Pesa Kenya** — primary rail; Daraja API for STK Push, C2B, B2C
- **Airtel Money Kenya** — secondary
- **Pesalink (IPSL)** — interbank instant transfer for owner disbursement
- **KCB Buni** — bank rail
- **Equity Eazzy** — bank rail
- **NIDA-KE / IPRS** — national-ID verification (subject to inter-agency MoU)
- **Smile Identity** — biometric KYC (same vendor as TZ)

## 6. Defining Documents

Same matrix as TZ pack (annual review for most; quarterly for vendors + fairness + model inventory).

## 7. Out of Scope

Borjie **does not**:

- Hold customer or tenant deposits, settle payments, or operate any e-money licence (in Kenya: not licensed under CBK National Payment System Act)
- Lend money on its own balance sheet
- Provide investment, insurance or securities advice
- Operate any service requiring a banking, microfinance, money-services or insurance licence
- Operate as a Real Estate Investment Trust manager (CMA-regulated activity) — we serve REIT managers as a software vendor only
- Process biometric or facial-recognition data for any purpose other than tenant KYC liveness initiated by the tenant
- Sell, share or syndicate tenant personal data for marketing purposes

Any expansion beyond this scope requires a board-approved change of business plan and supplementary regulatory engagement.

> TODO: insert link to most recent board minutes confirming scope for KE expansion.

---

## Appendix A — Board Sign-Off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| CRO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cro/regulator-pack-ke-01-v1.0` |
| CCO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cco/regulator-pack-ke-01-v1.0` |
| DPO (KE — ODPC registered) | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/dpo/regulator-pack-ke-01-v1.0` |
| Board Chair | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/board/regulator-pack-ke-01-v1.0` |

## Appendix B — Version History

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial scaffold | CRO + CCO |
| 1.1.0 | 2026-05-22 | KE region wiring path:line refs (Wave-12) | CRO + CCO |

## Appendix C — Review Cadence

- **Annual** — full review by CRO + CCO + ODPC-registered DPO
- **Out-of-cycle** — CBK or ODPC supervisory letter, new KE payment rail, or scope-change board vote
- **Quarterly** — Risk & Audit Committee review
