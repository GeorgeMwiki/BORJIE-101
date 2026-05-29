# Data Residency — Phase 1 (pre-launch posture)

**Status:** PHASE 1 ACTIVE.
**Last reviewed:** 2026-05-29.
**Owner:** SEC-1 (Mr. Mwikila) + #194 compliance/regulator track.
**Statutes:** Tanzania Personal Data Protection Act 2022 (PDPA),
specifically s.39 (cross-border transfer); PCCB Data Protection
Commission Guideline 4/2025.
**Companion docs:**
[`Docs/SECURITY/PCCB_PDPA_AUDIT_2026-05-29.md`](./PCCB_PDPA_AUDIT_2026-05-29.md)
§3 (three-phase remediation plan),
[`Docs/SECURITY/data-processing-agreement-template.md`](./data-processing-agreement-template.md)
(SCC template),
[`Docs/SECURITY/SECURITY_AUDIT_2026-05-29.md`](./SECURITY_AUDIT_2026-05-29.md)
§5 (S-5 PCCB/PDPA scope).

This document records the **Phase-1 mitigation** for the
cross-border-transfer gap flagged by today's PCCB/PDPA audit, namely
that Supabase hosts Borjie's primary Postgres in `eu-central-1`
(Frankfurt, Germany) while PCCB prefers East African Community (EAC)
residency for Tanzanian personal data.

Phase 1 is a paperwork mitigation that ships **before** commercial
launch. Phases 2 and 3 are infrastructural (af-south-1 primary) and
are tracked on `Docs/ROADMAP.md`.

---

## 1. Why a phased approach

PCCB requires EITHER:

- (a) EAC primary residency for PII at rest, OR
- (b) a recipient-country **adequacy decision** **plus** a binding
  contract that establishes legal liability and data-subject rights
  upstream of the cross-border transfer.

Supabase does not yet operate a managed Postgres region inside EAC
(no Nairobi or Dar-es-Salaam region as of 2026-Q2; their roadmap signal
points to af-south-1 / nairobi later in 2026). Re-hosting onto AWS
af-south-1 (Cape Town) with self-managed Postgres + pgvector is a
2–3-month engineering effort that we cannot complete before the first
commercial tenant's contractual go-live.

Therefore Phase 1 takes option (b) — **adequacy + SCC** — and is
explicitly time-bounded: Phase 2 migration kicks off no later than
Q3 2026.

---

## 2. Phase 1 — adequacy + SCC mitigation (this doc)

### 2.1 Adequacy basis

The European Union has an active adequacy regime (GDPR + the EU
adequacy decision framework). Per PCCB **Guideline 4/2025** (the
implementing regulation for PDPA s.39), the European Union is on the
PCCB whitelist of jurisdictions with equivalent data-protection
standards. This means cross-border transfers of Tanzanian PII to an
EU-hosted processor are permitted **when** they are governed by a
binding processor contract (the SCC) and recorded in the controller's
Record of Processing Activities (RoPA).

This is the same legal basis Stripe, Snowflake, and most SaaS vendors
use for EU-hosted Tanzanian customers.

### 2.2 Deliverables shipped in Phase 1

| # | Deliverable | Owner | Status |
|--:|-------------|-------|--------|
| 1 | Data Transfer Impact Assessment (DTIA) document filed with PCCB | SEC-1 + DPO | TEMPLATE READY (`data-processing-agreement-template.md`) — fill + file before first commercial tenant signs |
| 2 | Standard Contractual Clauses (SCC) with Supabase Inc. | DPO + Legal | TEMPLATE READY — use Supabase published SCCs at <https://supabase.com/legal/dpa> as the upstream contract; counter-sign on first commercial tenant |
| 3 | Record of Processing Activities (RoPA) entry for the Supabase EU transfer | DPO | TEMPLATE READY in DPA appendix A |
| 4 | Cross-border transfer authorisation request to PCCB | SEC-1 | TEMPLATE READY in DPA appendix B |
| 5 | This residency posture doc | SEC-1 | SHIPPED — this file |
| 6 | SCC + DPA template | SEC-1 | SHIPPED — `data-processing-agreement-template.md` |
| 7 | Bilingual sw/en customer-facing cross-border-transfer disclosure (banner + privacy-policy paragraph) | Marketing + SEC-1 | DRAFTED in §4 of this doc — owner-onboarding to apply before launch |
| 8 | Operator runbook for residency-related Subject Access Requests | SEC-1 | §5 of this doc |

### 2.3 What changes in code today

Nothing. Phase 1 is paperwork + customer-facing disclosure. Codepaths
that touch PII are already:

- TLS-1.3 in transit (Supabase platform + gateway helmet config).
- AES-256 at rest (Supabase managed default).
- Application-layer field encryption (envelope encryption with KMS
  master key) for sensitive PII columns via
  `selectEncryptionPort` and `createFieldEncryptionAuditService` in
  `services/api-gateway/src/middleware/database.ts`.
- Tenant-scoped via RLS FORCE on every tenant table.
- Hash-chained audit (`ai_audit_chain`) for every PII read / write.

The DTIA records all of the above as the safeguards a regulator would
expect to see in §6.4 (technical and organisational measures).

---

## 3. Phase 2 + Phase 3 — roadmap (out of scope here)

These are infrastructural and live on `Docs/ROADMAP.md`. Summary only:

| Phase | Trigger | Action |
|------:|---------|--------|
| 2 | Q3 2026 OR Supabase af-south-1 availability (whichever first) | Migrate primary Postgres to AWS af-south-1 (Cape Town) — self-hosted via `docker-compose.production.yml` OR Supabase region addition. EU becomes read-only analytics secondary (no PII columns). |
| 3 | Q4 2026 | Notify PCCB of primary-region change; the SCC dependency drops to "analytics-only / no PII" scope. |

The replication architecture is already designed in
`docker-compose.ha.yml`. Phase 2 + 3 close the residency gap
architecturally; Phase 1 closes it contractually so we can launch.

---

## 4. Customer-facing disclosure (bilingual sw/en — apply before launch)

Owner onboarding must surface this paragraph in BOTH languages on the
"Your data" tab in account settings and on the cross-border-transfer
banner that fires once per organisation on first PII upload.

### English

> Your tenant data is hosted on Supabase, Inc. in the European Union
> (eu-central-1, Frankfurt, Germany). The European Union is on
> Tanzania's PCCB adequacy whitelist (Personal Data Protection
> Commission Guideline 4/2025). Borjie and Supabase are bound by a
> Standard Contractual Clauses agreement that gives you the same
> rights you would have under the Tanzania Personal Data Protection
> Act 2022 (PDPA). We are migrating to an East African Community
> region in 2026; you will be notified ahead of the migration. To
> exercise your data-subject rights (access, correction, erasure),
> contact dpo@borjie.co.tz or use Settings → Privacy → Erase my data.

### Swahili

> Data ya kampuni yako inahifadhiwa kwenye Supabase, Inc. ndani ya
> Umoja wa Ulaya (eu-central-1, Frankfurt, Ujerumani). Umoja wa
> Ulaya umo katika orodha ya nchi zinazokubaliwa na PCCB ya Tanzania
> (Mwongozo Na. 4/2025). Borjie na Supabase tumefunga mkataba wa
> Vifungu Vya Kawaida Vya Kimkataba (SCC) unaokuhakikishia haki
> sawa na zile za Sheria ya Hifadhi ya Data Binafsi 2022 (PDPA).
> Tutahamia eneo la Jumuiya ya Afrika Mashariki mwaka 2026; tutakujulisha
> kabla ya uhamiaji. Kutumia haki zako (kupata, kurekebisha, kufuta data
> yako), wasiliana na dpo@borjie.co.tz au tumia Mipangilio → Faragha
> → Futa data yangu.

Implementation note: copy lives bilingually under
`apps/marketing/src/i18n/{en,sw}.json` under the `privacy.crossBorder.*`
namespace (to be added by the marketing team before launch).

---

## 5. Operator runbook — residency-related Subject Access Requests

When a data subject invokes the cross-border-transfer disclosure
clause (PDPA s.39(3) — right to know where their data resides):

1. Receive the request via `dpo@borjie.co.tz` or the
   `POST /api/v1/me/erase` companion endpoint
   (`POST /api/v1/me/data-residency-disclosure`, to be added with
   #194's DSR endpoints).
2. Authenticate the subject — match by NIDA + phone OR M-Pesa MSISDN.
   Constant-time response shape (`crossOrgDenialRecorder` already
   pins the no-leak contract for this).
3. Reply within 30 days (PDPA s.27(2)) with:
   - **Hosting region:** Supabase managed Postgres in eu-central-1
     (Frankfurt, Germany).
   - **Cross-border legal basis:** EU adequacy under PCCB Guideline
     4/2025 + SCC with Supabase.
   - **Subject rights summary:** access, correction, erasure,
     portability, complaint to PCCB.
   - **PCCB contact:** `complaints@pdpc.go.tz` (per Guideline 4/2025
     §11).
4. Append the response to `ai_audit_chain` with
   `action='data_residency_disclosure'`.

The endpoint is wave-scale and ships with #194 — the runbook here is
the manual fallback until that lands.

---

## 6. Verification checklist (pre-launch sign-off)

Before the first commercial tenant signs, ALL of the following must be
true; the launch reviewer signs at the bottom of this doc.

- [ ] SCC counter-signed with Supabase (one-time, monorepo-wide).
- [ ] DTIA filed with PCCB and the receipt number recorded in §7
      below.
- [ ] Cross-border transfer authorisation request lodged with PCCB
      and the receipt number recorded in §7 below.
- [ ] RoPA entry for the Supabase EU transfer added to the Borjie
      central RoPA register (lives in
      `Docs/SECURITY/data-processing-agreement-template.md` Appendix
      A; the live register is operator-internal).
- [ ] Customer-facing cross-border-transfer disclosure copy (English
      + Swahili) shipped to the marketing i18n catalog under
      `privacy.crossBorder.*` and the marketing privacy page renders
      it.
- [ ] Onboarding flow surfaces the cross-border-transfer banner on
      first PII upload (one-time per organisation).
- [ ] Phase-2 migration ticket filed on the roadmap with explicit
      Q3 2026 target.
- [ ] This doc is linked from
      `Docs/SECURITY/SECURITY_AUDIT_2026-05-29.md` §5 (it is, as of
      the residuals-closure sweep that ships alongside this file).

---

## 7. Sign-off

PCCB authorisation receipt: `_______________________________________`
DTIA filing receipt:         `_______________________________________`
SCC effective date:          `_______________________________________`
DPO signature:               `_______________________________________`
SEC-1 signature:             `_______________________________________`

**Phase 1 sign-off date:** _______________________

This sign-off block intentionally left blank; the launch reviewer fills
it when Phase 1 deliverables (§2.2) are all complete. Without the
sign-off the first commercial tenant cannot go live.

End of Phase-1 residency posture doc.

---

## 8. World-scale multi-region addendum (issue #207 — WS-6)

**Added:** 2026-05-29.
**Status:** PLANNING — design landed, infrastructure work tracks
under Phase 2 (af-south-1 primary) and Phase 4 (multi-region).

Borjie is global from day one (issue #207). Tanzania is the GTM
beachhead, NOT a hardcode. The Phase 2 af-south-1 primary stays the
default for any tenant whose `country_code` resolves to a TZ-set /
KE-set / UG-set / NG-set jurisdiction. Tenants in jurisdictions
outside East / Southern Africa get their own region per the table
below:

| Regulator set | Country examples | Supabase region target | Rationale |
| ------------- | ---------------- | ---------------------- | --------- |
| TZ-set        | TZ               | `af-south-1` (Cape Town)| PCCB/PDPA EAC preference |
| KE-set        | KE               | `af-south-1`            | KE DPA — same AU region pool |
| UG-set        | UG               | `af-south-1`            | EAC alignment |
| NG-set        | NG               | `af-south-1` (fallback to `eu-west-2` for performance) | NDPR §41 |
| ZA-set        | ZA               | `af-south-1`            | POPIA §72 (transfers) |
| AU-set        | AU               | `ap-southeast-2` (Sydney) | Privacy Act 1988 — APP 8.1 |
| CL-set        | CL               | `sa-east-1` (São Paulo) | Ley 19.628 Art. 4 cross-border |
| ID-set        | ID               | `ap-southeast-3` (Jakarta) | PDP Law 27/2022 Art. 56 |
| generic       | other            | `eu-west-1` (Dublin)    | GDPR Article 45 default |

### 8.1 — Routing
Tenant rows already carry `tenants.region` (default `af-south-1` via
migration 0158). The tenant-config service (added under issue #207)
extends this with `tenants.country_code` so the routing layer can
read `(region, country_code, regulator_set)` to pick the right
Supabase project + KMS key.

At signup, the wizard:
1. Resolves the operator's country from the form input.
2. Looks up `JURISDICTION_DEFAULTS` (services/api-gateway/src/
   services/tenant-config/jurisdictions.ts) for the jurisdiction's
   currency / language / timezone / regulator-set / mineral-allowlist.
3. Picks the Supabase region from the table above.
4. Writes the tenant row in the regional project; ALL subsequent
   writes (audit chain, ledger, cockpit events) stay in-region.

Cross-region SELECTs are blocked by app-side composition guards
inherited from Phase 2 (api-gateway middleware short-circuits when
`tenant.region != BORJIE_DB_REGION_BIND`).

### 8.2 — Cross-region DSR / regulator path
Data Subject Requests originating from a non-TZ regulator (NESREA,
DMRE, SERNAGEOMIN, ESDM, etc.) MUST hit the regional Supabase
project, not the TZ primary. The `regulator_jurisdictions.dsr_endpoint`
column (migration 0143) holds the per-authority callback so the DSR
worker dispatches in-region.

### 8.3 — Timeline
Multi-region rollout is gated behind Phase 2 (af-south-1 primary) —
af-south-1 ships first (Q3 2026), then sa-east-1 + ap-southeast-2
+ ap-southeast-3 roll out per onboarding demand (Q4 2026 → Q1 2027).

End of multi-region addendum.
