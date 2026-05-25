# 04 — AML / KYC / Tenant-Identity Controls (Tanzania)

**Document version:** 1.0
**Date:** 2026-05-22
**Owner:** Money Laundering Reporting Officer (MLRO)
**Jurisdiction:** Tanzania
**Statutes & guidance:**
- Anti-Money Laundering Act, 2006 (Cap. 423)
- Anti-Money Laundering Regulations, 2007 (regulation 29 retention)
- BoT/FIU Anti-Money Laundering Guidelines to Banking Institutions, Guideline No. 2 (March 2020 publication of original 2009 guidance)
- FATF Recommendations (40 + 9)
- Proceeds of Crime Act (Cap. 256)

> **Source PDF for FIU Guideline No. 2:** `https://www.bot.go.tz/Publications/Acts,%20Regulations,%20Circulars,%20Guidelines/Guidelines/en/2020031901533396.pdf`

---

## 1. Programme overview

Borjie is **not a financial institution** and does not hold AML obligations in its own name under the AML Act 2006. However, rent flows route through BoT-supervised MNOs and partner banks, and our institutional landlord clients (NHC, pension funds, DFIs) require AML-grade tenant-identity controls. Accordingly, Borjie:

1. Operates a **tenant-identity verification programme** that meets the CDD standards expected by partner MNOs and licensed PSPs.
2. Performs **sanctions + PEP screening** on tenants where rent ≥ threshold or where the property owner is an institutional client requiring it.
3. Produces **suspicious-activity output** (unusual rent patterns, structuring, third-party payments) routed to the property owner's MLRO for filing where appropriate.
4. Maintains its own internal AML programme covering corporate dealings, employees, and ML/sanctions risk in vendor relationships.

## 2. Tenant identity tiers (Know-Your-Tenant)

Default tiers; institutional landlords may tighten:

| Tier | Tenant profile | Required evidence | Borjie connector / control (path:line) |
|---|---|---|---|
| **Tier 0 — Public browse** | Marketing-site visitor, public listing browse | None | Session cookie only; no PII collected |
| **Tier 1 — Lead (light)** | Pre-application, listing enquiry | Phone number + name | Phone normalisation `services/identity/src/phone-normalize.ts`; NIDA lookup disabled at this tier; rate-limit at `services/api-gateway/src/middleware/rate-limit.ts` |
| **Tier 2 — Standard KYC** | Residential lease, monthly rent < TZS 1.5M | National ID (NIDA), proof of address, employer letter or 3 months bank/mobile-money history | NIDA adapter `packages/connectors/src/adapters/nida-adapter.ts` (stub) + `nida-real.ts` (production wiring, NIDA regex anchored after W4-H); HQ tool `packages/central-intelligence/src/kernel/tool-spec/hq-tools/platform.verify_nida.ts`; Smile Identity liveness via Smile Identity SDK; document-intelligence pipeline `services/document-intelligence/` (see `__fixtures__/ids/tanzania-nida.fixture.ts` for golden-path test) |
| **Tier 3 — Enhanced KYC** | Commercial lease, residential rent ≥ TZS 1.5M, multi-unit lease, corporate tenant | Tier 2 + source-of-funds, BRELA business registration (if corporate), beneficial-owner chain (>25%), references | All Tier 2 + PEP screening (TODO — wire), sanctions screening, ownership graph constructed by `packages/graph-sync/` |
| **Tier 4 — Politically exposed** | Tenant or BO is domestic / foreign / IO PEP | Tier 3 + senior-manager approval, source-of-wealth, ongoing monitoring | PEP service via World-Check (or equivalent); approval enforced through four-eyes at `services/api-gateway/src/composition/approval-grant-repository.ts` + `approval-request-repository.ts`; tier-policy gate `packages/central-intelligence/src/policy-gate/tier-policy-resolver.ts` |

## 3. Sanctions screening

| Source list | Scope | Frequency |
|---|---|---|
| UN Security Council Consolidated List | Global terror / proliferation | Real-time on onboarding; daily delta scan |
| OFAC SDN | US sanctions | Real-time; daily delta |
| EU Consolidated List | EU sanctions | Real-time; daily delta |
| UK HMT Consolidated List | UK sanctions | Real-time; daily delta |
| Tanzania domestic lists (FIU notices) | Tanzania-specific | Within 24 h of FIU notice |

Implementation: sanctions feeds consumed via `packages/connectors/src/` adapter pattern (see `nida-adapter.ts` for the equivalent shape); evaluation against tenant identity recorded in `packages/database/src/schemas/compliance.schema.ts`. False-positive ratio reviewed monthly by MLRO via Grafana dashboard `https://grafana.borjie.com/d/aml-sanctions/sanctions-screen-false-positive-rate`.

## 4. Suspicious activity — rent-payment red flags

Property management is **lower AML risk** than consumer lending, but rent flows are a known laundering vector ("rent inflation", "ghost tenancy", "structuring through deposit overpayment"). The transaction-monitoring rule set:

- **Deposit overpayment** > 150% of rent (potential layering)
- **Round-number rent paid by unrelated third party**
- **Multi-MNO source-of-payment switching within single rent cycle**
- **Cash-out / refund pattern** (rent paid in, refund requested same week)
- **Rapid lease churn** (lease signed, terminated within 30 days, deposit retained or refunded irregularly)
- **Cross-border source-of-funds** from sanctioned jurisdiction (post-screen)

Alerts surfaced to:

1. The property owner's portal (visible to property manager + finance admin)
2. Borjie internal MLRO queue (for vendor / platform-level patterns)

The property owner's MLRO (if regulated) determines whether to file an STR with FIU; Borjie produces a structured packet ready for FIU standard format.

### STR workflow

```
Detection (rule + ML)    ──→  Property-mgr review   ──→  Owner MLRO triage
   │                                                          │
   ├── Auto-flagged structured                                ├──→  No filing (close + log)
   │   indicators:                                            │
   │   - deposit-overpay                                      ├──→  Internal SAR
   │   - third-party payer                                    │
   │   - multi-MNO switching                                  └──→  STR to FIU (within 24 h of MLRO sign-off)
   │   - rapid churn
```

Code: AML monitor uses the `compliance-plugins` package + `services/api-gateway/src/routes/compliance-plugins.router.ts` + `compliance.router.ts`; rule definitions follow the pattern in `packages/compliance-plugins/src/`. Audit-trail entries for every alert, triage decision and sign-off are written to the unified audit chain (`packages/database/src/schemas/audit-events.schema.ts`, 120 lines) — hash-chained via `packages/ai-copilot/src/security/audit-hash-chain.ts` (651 lines) and tamper-evident.

## 5. Tipping-off prevention

FIU Guideline §8.0 prohibits tipping off. Borjie enforces this in two ways:

- **Role-based access control:** STR records are visible only to MLRO and designated AML team. Tenant-facing portals never show alert flags or MLRO notes.
- **Communication template lockdown:** templates available to property managers exclude AML-related language; the AI copilot's safety layer rejects requests to draft "explain why we filed a report" responses.

## 6. Record-keeping (regulation 29)

| Record | Retention | Storage |
|---|---|---|
| Tenant identification documents | 7 years from end of business relationship | Encrypted object storage; field-level encryption for ID number |
| Transaction records (rent + deposit ledger) | 7 years | `payments-ledger` service + audit chain |
| STR drafts + sign-offs | 7 years | Audit chain |
| Sanctions / PEP screen results | 7 years | Audit chain |
| MLRO training records | 5 years | HR system |

## 7. Training

| Role | Training | Cadence |
|---|---|---|
| All staff | AML / sanctions / data-protection awareness | Annual + on hire |
| MLRO | Specialist AML + FIU liaison | Annual |
| Property managers (institutional client side) | Tenant-identity red flags, tipping-off prevention | Annual + on onboarding |
| Engineers touching payments code | Secure handling, idempotency, log redaction | Annual + on team change |

> TODO: insert training-completion register snapshot.

## 8. Independent review

Annual independent AML audit by external firm; report to Board Audit Committee. First scheduled audit: Q4 2026 (post first full year of operation).

> TODO: insert audit scope memo and firm engagement letter.

---

## Appendix A — Board Sign-Off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| MLRO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/mlro/regulator-pack-tz-04-v1.0` |
| CCO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cco/regulator-pack-tz-04-v1.0` |
| Head of Engineering (KYC owner) | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/heng/regulator-pack-tz-04-v1.0` |
| Board Compliance Committee Chair | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/bcc/regulator-pack-tz-04-v1.0` |

## Appendix B — Version History

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial scaffold | MLRO |
| 1.1.0 | 2026-05-22 | NIDA + Smile + sanctions path:line refs (Wave-12) | MLRO |

## Appendix C — Review Cadence

- **Annual** — full review by MLRO; independent AML audit by external firm
- **Out-of-cycle** — triggered by FIU directive, sanctions-list change, or material change to NIDA adapter contract
- **Quarterly** — MLRO reviews alert queue, STR drafts, sanctions false-positive rate against §3 dashboards
