# SOC 2 Type II — Trust Services Criteria Control Mapping

> Mapping of AICPA TSC 2017 (revised 2022) Common Criteria CC1.1
> through CC9.2 to Borjie implementation, test coverage, and
> audit-evidence pathway. This document is the master control register
> for the SOC 2 audit. Auditors should treat this as the index of
> evidence; specific evidence bundles are produced on request via
> `pnpm -C scripts ts-node export-soc2-evidence.ts`.

Last review: 2026-05-18. Auditor of record: TBD.

---

## CC1 — Control Environment

### CC1.1 — COSO integrity & ethics

| Element | Implementation | Evidence |
|---|---|---|
| Code of conduct | `Docs/LEGAL.md` § Conduct | Repo file, signed acceptance |
| Tone at the top | Board minutes (external) | Auditor request |
| Background checks | HR vendor (external) | HR system export |

### CC1.2 — Board oversight independence

Stub for CC1.2-1.5. Document board composition, independence,
oversight cadence. Operator to fill from external HR + board materials.

---

## CC2 — Communication & Information

### CC2.1 — Information requirements

| Element | Implementation | Evidence |
|---|---|---|
| Logging architecture | `packages/observability/src/logger.ts` (pino) + Sentry + PostHog | Service config, retention policy |
| Audit-trail integrity | `packages/ai-copilot/src/security/audit-hash-chain.ts` | `field_encryption_audit`, `sovereign_action_ledger` tables |
| Customer-facing comms | `services/notifications/` | `notification_dispatch_log` table |

### CC2.2 — Internal communication

Slack workspace + on-call channel + incident-response runbook.
Evidence: `Docs/RUNBOOKS/incident-response.md`.

### CC2.3 — External communication

Status page (TBD), security disclosure policy (`SECURITY.md` at root).

---

## CC3 — Risk Assessment

### CC3.1 — Risk identification & analysis

`Docs/RISK_REGISTER.md` — quarterly review. Each entry: risk,
likelihood, impact, mitigation, owner, next-review date.

### CC3.2 — Fraud risk

| Element | Implementation |
|---|---|
| Four-eye approval on money movement | `packages/central-intelligence/src/kernel/four-eye-approval.ts` |
| Payments-ledger immutability | `services/payments-ledger/` (append-only) |
| Sovereign-action ledger | `packages/database/src/services/sovereign-action-ledger.service.ts` |

### CC3.3 — Significant change risk

Migration runbook (`Docs/RUNBOOKS/migration-production.md`),
deploy windows, rollback procedure.

### CC3.4 — Risk integration

Stub — link risk register entries to control activities.

---

## CC4 — Monitoring Activities

### CC4.1 — Ongoing & separate evaluations

| Element | Implementation | Evidence |
|---|---|---|
| Nightly audit-chain verification | `auditVerifyCron` | Job logs + Sentry alerts |
| Daily killswitch state audit | `platform_killswitch_audit` | Table dump |
| Continuous integration | `.github/workflows/*` | GH Actions runs |

### CC4.2 — Communication of deficiencies

Sentry → security channel → incident ticket. Cadence: real-time.

---

## CC5 — Control Activities

### CC5.1 — Selection & development of controls

`packages/authz-policy/` — Permit.io-style policy engine.
RLS + RBAC + ABAC. Evidence: policy file + test coverage.

### CC5.2 — Selection & development over technology

| Element | Implementation |
|---|---|
| SDLC | Branch protection, mandatory review, pre-commit hooks |
| Dependency hygiene | `Docs/DEP_HYGIENE.md` + Dependabot config |
| Static analysis | TypeScript strict + ESLint + Semgrep |

### CC5.3 — Policies & procedures

This document + every runbook in `Docs/RUNBOOKS/`.

---

## CC6 — Logical & Physical Access

### CC6.1 — Logical access security

| Element | Implementation | Evidence |
|---|---|---|
| Field-level encryption (PII) | `packages/ai-copilot/src/security/field-encryption.ts` (AES-GCM-256 + per-tenant DEK) | `Docs/RUNBOOKS/encryption-at-rest-key-rotation.md` |
| Authentication | Supabase Auth + JWT (RS256) | `services/identity/` |
| Authorization | RBAC + RLS | `packages/authz-policy/` |
| Tenant isolation | `packages/ai-copilot/src/security/tenant-isolation.ts` | Test coverage |

### CC6.2 — Pre-grant access registration

Self-serve sign-up with email verification; admin-bootstrapped staff
via `BOOTSTRAP_SECRET` + invite flow. Stub: enrich with HR system link.

### CC6.3 — Access removal

Self-serve account deletion (RTBF); staff deprovisioning via
`PLATFORM_ADMIN_EMAILS` env + identity system invalidation.

### CC6.4 — Physical access

Datacentre security inherited from Supabase / AWS / Cloudflare. Evidence:
sub-processor SOC 2 reports (auditor request).

### CC6.5 — Logical access prevention through credentials

Password complexity, MFA (Supabase Auth), session timeout (15 min idle).

### CC6.6 — Boundary protection

| Element | Implementation |
|---|---|
| TLS everywhere | Cloudflare + api-gateway HTTPS-only |
| CORS allowlist | `ALLOWED_ORIGINS` env, `services/api-gateway/src/middleware/cors.ts` |
| Webhook SSRF guard | `WEBHOOK_SSRF_ALLOW_PRIVATE=false` default |
| Rate limiting | `services/api-gateway/src/middleware/rate-limit.ts` |

### CC6.7 — Restriction of confidential info transmission

Field encryption + TLS + JWT scoped tokens.

### CC6.8 — Malicious software prevention

Container base-image scanning (TBD: link to scanning workflow).

---

## CC7 — System Operations

### CC7.1 — Detection of new vulnerabilities

GitHub Dependabot + npm-audit gate in CI. Evidence: CI logs.

### CC7.2 — Anomaly detection

| Element | Implementation |
|---|---|
| Sentry error capture | `SENTRY_DSN` configured | 
| PostHog product analytics | `POSTHOG_API_KEY` |
| Persona-drift detection | `packages/central-intelligence/src/kernel/persona-drift/` |
| Audit-chain mismatch | `auditVerifyCron` |

### CC7.3 — Incident response

`Docs/RUNBOOKS/incident-response.md` + per-domain runbooks.

### CC7.4 — Incident recovery

`Docs/RUNBOOKS/backup-restore.md`, `Docs/RUNBOOKS/dr-region-failover.md`.

### CC7.5 — Incident communications

Customer-facing status page (TBD). Breach notification template at
`Docs/COMPLIANCE/GDPR_ARTICLE_30.md`.

---

## CC8 — Change Management

### CC8.1 — Changes to infrastructure, data, software

| Element | Implementation |
|---|---|
| Change-request workflow | GH PR + mandatory review |
| Migration runbook | `Docs/RUNBOOKS/migration-production.md` |
| Rollback procedure | Each migration runbook section + ADRs |
| ADR record | `Docs/ADR/*.md` |

---

## CC9 — Risk Mitigation

### CC9.1 — Business disruption risk

DR runbook (`dr-region-failover.md`), backup retention policy
(`backup-restore.md`), RPO/RTO documented per `Docs/OPERATIONAL_SLA.md`.

### CC9.2 — Vendor & business-partner risk

Sub-processor list (TBD). Each vendor: SOC 2 status, DPA on file,
data-residency constraints.

---

## Additional TSC categories (when in scope)

| TSC | Status |
|---|---|
| Availability | In scope — see CC7.4 + DR runbook + `Docs/KPIS_AND_SLOS.md` |
| Processing Integrity | Stub — to add for FinTech audit scope |
| Confidentiality | Covered by CC6.1 + CC6.6 + CC6.7 |
| Privacy | Covered by GDPR + TZ PDPA mapping (separate docs) |

## Auditor evidence-export procedure

```bash
# Generate the full evidence bundle for a period
pnpm -C scripts ts-node export-soc2-evidence.ts \
  --period 2026-Q1 \
  --out evidence-bundle-2026q1.zip
```

Bundle contents:
- This document with current-state annotations
- Every audit-trail table dump (data-only, encrypted)
- Every CI run log for the period
- Every incident ticket + post-mortem
- Every ADR for the period
- Every dependency upgrade log

## Related

- `Docs/COMPLIANCE/TZ_PDPA_2022.md`
- `Docs/COMPLIANCE/GDPR_ARTICLE_30.md`
- `Docs/COMPLIANCE/DPA_TEMPLATE.md`
- `Docs/SECURITY.md`
- `Docs/RISK_REGISTER.md`

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
