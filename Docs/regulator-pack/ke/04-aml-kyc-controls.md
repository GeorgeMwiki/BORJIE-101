# 04 — AML / KYC / Tenant-Identity Controls (Kenya)

**Document version:** 1.0
**Date:** 2026-05-22
**Owner:** Money Laundering Reporting Officer (MLRO)
**Jurisdiction:** Kenya
**Statutes & guidance:**
- Proceeds of Crime and Anti-Money Laundering Act 2009 (POCAMLA)
- Prevention of Terrorism Act 2012
- POCAMLA (Amendment) Acts 2017, 2021, 2023
- CBK AML Guidelines and Sector Guidelines on AML/CFT 2023
- Financial Reporting Centre (FRC) Reporting Guidelines
- FATF Recommendations (40 + 9)
- CBK Trust and Mortgage Finance Companies Act (only where institutional clients are regulated)

---

## 1. Programme overview

Borjie is **not a financial institution** and does not hold AML obligations in its own name under POCAMLA. However, rent flows route through CBK-supervised MNOs and PSPs, and institutional landlord clients in Kenya (REIT managers, NSSF-class custodians, DFIs) require AML-grade tenant-identity controls.

Borjie accordingly:

1. Operates a **tenant-identity verification programme** that meets the CDD standards expected by partner MNOs and licensed PSPs.
2. Performs **sanctions + PEP screening** on tenants where rent ≥ threshold or where the property owner is an institutional client.
3. Produces **suspicious-activity output** (unusual rent patterns, structuring, third-party payments) routed to the property owner's MLRO for filing to FRC where appropriate.
4. Maintains its own internal AML programme.

## 2. Tenant identity tiers (Know-Your-Tenant)

Default tiers; institutional landlords may tighten:

| Tier | Tenant profile | Required evidence | Borjie connector / control |
|---|---|---|---|
| **Tier 0 — Public browse** | Marketing-site visitor | None | Session cookie only; no PII collected |
| **Tier 1 — Lead (light)** | Pre-application | Phone number + name | No IPRS yet; rate-limited |
| **Tier 2 — Standard KYC** | Residential lease, monthly rent < KES 100,000 | National ID (IPRS), proof of address, employer letter or 3 months bank/M-Pesa history | IPRS/NIDA-KE connector (TODO), Smile Identity liveness |
| **Tier 3 — Enhanced KYC** | Commercial lease, residential rent ≥ KES 100,000, multi-unit, corporate tenant | Tier 2 + source-of-funds, business registration (BRS — Business Registration Service), beneficial-owner chain (>25%), references | All Tier 2 + PEP screening, sanctions screening, ownership graph |
| **Tier 4 — Politically exposed** | Tenant or BO is domestic / foreign / IO PEP | Tier 3 + senior-manager approval, source-of-wealth, ongoing monitoring | PEP service includes World-Check or equivalent feed |

## 3. Sanctions screening

| Source list | Scope | Frequency |
|---|---|---|
| UN Security Council Consolidated List | Global terror / proliferation | Real-time; daily delta |
| OFAC SDN | US sanctions | Real-time; daily delta |
| EU Consolidated List | EU sanctions | Real-time; daily delta |
| UK HMT Consolidated List | UK sanctions | Real-time; daily delta |
| Kenya domestic lists (Prevention of Terrorism Act listings) | Kenya-specific | Within 24 h of gazette notice |

Implementation: TODO — wire `services/compliance/src/sanctions-service.ts`. False-positive ratio reviewed monthly by MLRO.

## 4. Suspicious activity — rent-payment red flags (Kenya)

Same indicators as TZ pack (see `tz/04-aml-kyc-controls.md` §4): deposit overpayment, third-party payer, multi-MNO switching, cash-out / refund pattern, rapid lease churn, cross-border source-of-funds from sanctioned jurisdiction.

Alerts surfaced to property owner's portal + Borjie internal MLRO queue. The property owner's MLRO determines whether to file an STR with the **Financial Reporting Centre (FRC)**; Borjie produces the structured packet in FRC format.

### STR workflow

```
Detection (rule + ML)    ──→  Property-mgr review   ──→  Owner MLRO triage
   │                                                          │
   ├── Auto-flagged                                           ├──→  No filing (close + log)
   │                                                          │
   │                                                          ├──→  Internal SAR
   │                                                          │
   │                                                          └──→  STR to FRC (within 24 h of MLRO sign-off)
```

Code: TODO — `services/compliance/src/aml-monitor/`. Hash-chained audit (doc 10).

## 5. Tipping-off prevention

POCAMLA s.18 prohibits tipping off. Same controls as TZ pack: RBAC restricts STR visibility; communication-template lockdown; AI safety layer rejects "explain a report" requests.

## 6. Record-keeping (POCAMLA s.46 + Regulations)

| Record | Retention | Storage |
|---|---|---|
| Tenant identification documents | 7 years from end of business relationship | Encrypted object storage; field-level encryption |
| Transaction records | 7 years | `payments-ledger` service + audit chain |
| STR drafts + sign-offs | 7 years | Audit chain |
| Sanctions / PEP screen results | 7 years | Audit chain |
| MLRO training records | 5 years | HR system |

## 7. Training

Same training matrix as TZ pack (all staff annual + on hire; MLRO specialist; property-managers; engineers touching payments code). Kenya-specific: include POCAMLA + FRC reporting framework.

## 8. Independent review

Annual independent AML audit by external firm; report to Board Audit Committee. First scheduled audit: Q4 2026.

## 9. Tax-collection touchpoints (KRA)

Although not strictly AML, Borjie supports landlords' Monthly Rental Income (MRI) tax obligation under the Income Tax Act:

- Rent ledger exposes KRA-format extract per property owner
- MRI rate (10% of gross residential rent) applied per per-tenant input
- iTax integration: TODO — connector planned

This intersects AML insofar as it provides transparency on rent flows that aids both tax compliance and laundering deterrence.

> TODO: insert iTax connector design doc; insert FRC reporting-format template.

## 10. Implementation references (KE)

| Capability | Source-of-truth (path:line) |
|---|---|
| IPRS / NIDA-KE adapter | `packages/connectors/src/adapters/` (region-overlay pattern; see `nida-adapter.ts` / `nida-real.ts` for the parallel TZ structure) |
| KRA iTax export formatter | `services/reports/src/compliance/ke-kra-formatter.ts` |
| Smile Identity liveness | invoked from `services/document-intelligence/` |
| Tier-policy gate at KYC | `packages/central-intelligence/src/policy-gate/tier-policy-resolver.ts` (419 lines) |
| Sanctions / PEP screen | `packages/compliance-plugins/src/` + audit to `packages/database/src/schemas/compliance.schema.ts` |
| Audit chain | `packages/ai-copilot/src/security/audit-hash-chain.ts` (651 lines) |

---

## Appendix A — Board Sign-Off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| MLRO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/mlro/regulator-pack-ke-04-v1.0` |
| CCO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cco/regulator-pack-ke-04-v1.0` |
| Head of Engineering (KYC owner) | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/heng/regulator-pack-ke-04-v1.0` |
| Board Compliance Committee Chair | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/bcc/regulator-pack-ke-04-v1.0` |

## Appendix B — Version History

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial scaffold | MLRO |
| 1.1.0 | 2026-05-22 | KE-specific code refs (Wave-12) | MLRO |

## Appendix C — Review Cadence

- **Annual** — full review by MLRO; independent KE AML audit
- **Out-of-cycle** — FRC directive, new sanctions list, change to IPRS / KRA adapters
- **Quarterly** — MLRO reviews alert queue + sanctions false-positive rate
