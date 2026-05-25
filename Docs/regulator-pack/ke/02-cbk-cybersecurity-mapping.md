# 02 — CBK Cybersecurity / Outsourcing / BCM Mapping (Kenya)

**Document version:** 1.0
**Date:** 2026-05-22
**Owner:** CISO
**Jurisdiction:** Kenya
**Scope:** This document maps Borjie controls to current Central Bank of Kenya (CBK) supervisory expectations as published in the CBK Guideline on Cybersecurity for the Banking Sector (October 2017), Prudential Guideline on Outsourcing (CBK/PG/15), Prudential Guideline on Business Continuity Management (CBK/PG/16), and the National Payment System Regulations 2014. Borjie is **not a regulated bank or payment service provider** in Kenya; this mapping is provided because (a) we touch the rent-collection rail of CBK-supervised mobile-money operators and partner banks, and (b) institutional landlord clients (REIT managers, pension funds, NSSF-style investors, DFIs) expect bank-grade evidence in their vendor due diligence.

> **Source documents (CBK website):**
> - CBK Guideline on Cybersecurity for the Banking Sector, October 2017: `https://www.centralbank.go.ke/wp-content/uploads/2017/10/Guidance-Note-on-Cybersecurity.pdf`
> - CBK Prudential Guideline on Outsourcing (CBK/PG/15)
> - CBK Prudential Guideline on Business Continuity Management (CBK/PG/16)
> - National Payment System Regulations 2014

---

## A. Outsourcing Guideline CBK/PG/15 — section-by-section mapping

Borjie is a **service provider** to property owners. Where an institutional owner is itself CBK-regulated (e.g., a pension-fund custodian holding rental real estate, a bank's branch-property arm), they may invoke CBK/PG/15 on their own vendor onboarding.

| CBK/PG/15 section | Requirement | Borjie evidence / control | Source-of-truth |
|---|---|---|---|
| Risk assessment prior to outsourcing | Documented assessment by the regulated entity | Borjie supplies due-diligence dossier (this pack), SOC 2 Type II (annual), financial statements, key-person disclosures | This pack + TODO SOC2 |
| Materiality determination | Activity materiality classification | Institutional clients classify by their own policy; default = material | TODO — materiality matrix template |
| Service-level agreement | Documented SLA with measurable KPIs | `Docs/OPERATIONAL_SLA.md` + per-client MSA | `Docs/OPERATIONAL_SLA.md` |
| Sub-contracting consent | Regulated entity must consent | Sub-processor list with 30-day prior-notice clause | doc 09 |
| Data confidentiality and ownership | Customer data is property of the customer | Per-tenant RLS + cryptographic erasure on exit | `services/api-gateway/src/middleware/rls.ts`; MSA clause 17 |
| Right of audit (regulatory and entity) | CBK examiner access on demand | MSA clause 14 ("Right of Audit") | `Docs/COMPLIANCE/DPA_TEMPLATE.md` |
| Contingency planning | Exit + DR provisions | 90-day data export + cryptographic erasure | doc 08 |
| Cross-border data | Per Kenya DPA s.48 (transfer rules) | EU-resident default; SCCs for US transfers; explicit consent | doc 03 §4 |

## B. BCM Guideline CBK/PG/16 — section-by-section mapping

| CBK/PG/16 section | Requirement | Borjie evidence / control |
|---|---|---|
| Board approval of BCP | Board owns BCP | Board reviews this regulator-pack annually |
| Business Impact Analysis (BIA) | Identification of critical processes | Doc 08 §1 (MCAs with RTO / RPO) |
| Recovery strategies | RTO / RPO per critical process | Doc 08 §3 |
| Alternate site | Geographically distant standby | Doc 08 §4 (Vercel + Supabase multi-region) |
| Crisis Management Team | Roles defined, tested | Doc 07 §3 |
| Testing | At least annual, documented | Doc 08 §6 |
| Communication plan | Internal + external | Doc 08 §8 |

## C. CBK Cybersecurity Guideline (Oct 2017) — pillars

| CBK pillar | Borjie control |
|---|---|
| Governance (Board + Senior Management oversight of cyber risk) | Risk + Audit Committee oversight; CISO reports to CTO + dotted to Risk Cmte |
| Risk management framework | This pack; risk register reviewed quarterly |
| Cybersecurity strategy | Five-layer defense (§D below); 3-year cyber strategy reviewed annually |
| Cyber risk management process | ID / Protect / Detect / Respond / Recover (NIST CSF 2.0 aligned) |
| Cybersecurity controls | §D below |
| Incident management | Doc 07 |
| BCP integration | Doc 08 |
| Awareness & training | Annual cyber + privacy training for all staff |
| Vendor risk | Doc 09 |
| Compliance with laws | This pack + `Docs/COMPLIANCE/` |

## D. Cybersecurity controls — five-layer defense

Same five-layer model as TZ pack (see `tz/02-bot-cybersecurity-mapping.md` §D for full detail). Kenya-specific differences:

- **Layer 1 — Edge:** geo-routing tuned for KE traffic (Safaricom + Airtel ASN preferential paths)
- **Layer 3 — Data:** for Kenya-resident tenants, default Supabase region is `fra1` with future roadmap to AWS Nairobi (`af-south-2`) once GA
- **Layer 5 — Response:** ODPC + CA Kenya notifications added (see doc 07 §5)

## E. Mobile-money / payments hygiene (Kenya)

CBK does not directly regulate Borjie, but our integrations with Safaricom M-Pesa Kenya (Daraja), Airtel Money Kenya, Pesalink, KCB Buni and Equity Eazzy subject us to:

- Webhook signature verification (HMAC) on every callback
- Idempotency keys on every disbursement / refund (`services/payments-ledger/`)
- Tenant-currency widening for KES
- Settlement reconciliation: nightly cron against MNO statements; alert on > 0.1% break
- National Payment System Regulations 2014 expectations on availability + integrity of payment messages (Borjie operates downstream of CBK-licensed PSPs, but evidences best-effort integrity)

## F. Open banking (forward-looking)

CBK's Open Banking framework (in development as of 2026) will create new connector obligations. Borjie's `services/integrations/` is architected to add CBK-mandated Open Banking endpoints when published.

> TODO: insert Daraja integration architecture diagram + sample reconciliation report from production.

## G. Implementation references (KE)

| Capability | Source-of-truth (path:line) |
|---|---|
| Daraja STK + callback handlers | `services/webhooks/src/` + `services/api-gateway/src/composition/anthropic-circuit-breaker.ts` (template for circuit-breaker pattern reused for KE rails) |
| Pesalink / KCB Buni / Equity Eazzy connectors | `packages/connectors/src/adapters/` (per-vendor adapters) |
| KE tax-reporter | `services/reports/src/compliance/ke-kra-formatter.ts` |
| KE region routing | `packages/database/src/schemas/identity.schema.ts` (tenants.region) + `services/api-gateway/src/composition/service-context.middleware.ts` |

## H. Monitoring dashboards (KE-specific overlays of TZ-02 §D L4 table)

| Dashboard | URL placeholder |
|---|---|
| Grafana — Daraja STK success-rate | `https://grafana.borjie.com/d/daraja/daraja-stk-success` |
| Grafana — Pesalink + KCB Buni + Equity Eazzy availability | `https://grafana.borjie.com/d/ke-banks/ke-bank-rail-availability` |
| Grafana — KE region cross-tenant denial rate | `https://grafana.borjie.com/d/rls-denials/rls-denial-rate?var-region=KE` |

---

## Appendix A — Board Sign-Off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| CISO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/ciso/regulator-pack-ke-02-v1.0` |
| CTO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cto/regulator-pack-ke-02-v1.0` |
| CRO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cro/regulator-pack-ke-02-v1.0` |
| Board Risk Committee Chair | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/brc/regulator-pack-ke-02-v1.0` |

## Appendix B — Version History

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial scaffold | CISO |
| 1.1.0 | 2026-05-22 | KE-specific code refs + dashboards (Wave-12) | CISO |

## Appendix C — Review Cadence

- **Annual** — full review + Board sign-off
- **Out-of-cycle** — CBK supervisory letter, Open Banking framework publication, new KE payment rail
- **Quarterly** — CISO reviews KE-specific dashboards against incident telemetry
