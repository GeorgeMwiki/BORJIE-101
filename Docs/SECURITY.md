# BORJIE — Security Handbook

Canonical reference for threat modeling, controls, OWASP Agentic compliance, incident response, and key-rotation cadence.

---

## 1. Threat Model (STRIDE)

| Asset | Threat | Control |
|---|---|---|
| Tenant data at rest | Cross-tenant read via app bug | Row-level tenant isolation enforced in every repo (`services/domain-services/**`) + `packages/ai-copilot/src/security/tenant-isolation.ts` wraps every LLM tool |
| Tenant data in transit | MITM | TLS 1.2+ terminated at nginx (`docker/nginx.prod.conf`) with HSTS preload |
| Auth tokens | Token theft → impersonation | Short JWT TTL (15m) + refresh rotation; `JWT_SECRET` rotated on a 90-day cadence |
| LLM outputs | Prompt injection → tool abuse | Output guard (`packages/ai-copilot/src/security/output-guard.ts`) + "all writes require explicit user confirmation" flow through Mr. Mwikila's proposed-action layer |
| PII in logs / Sentry | Regulatory leak | `packages/ai-copilot/src/security/pii-scrubber.ts` applied in every Sentry event `beforeSend` + in every analytics property |
| Payment webhooks | Replay / forgery | HMAC signature verification (`services/webhooks/src/verify.ts`) + idempotency keys |
| Admin endpoints | Privilege escalation | RBAC via `packages/authz-policy`; every admin route checks `role=admin` or higher |
| Audit chain | Tampering | Append-only audit log + SHA-256 hash chain (`packages/observability/src/audit-logger.ts`) verified nightly by `scripts/verify-audit-chain.ts` |
| Secrets | Leak via misconfigured logs | All secrets read from env; `redactFields` baseline in pino logger drops `password`, `token`, `authorization`, `cookie`, `secret`, `api_key` |

## 2. OWASP Agentic Top-10 Compliance

See `packages/ai-copilot/src/security/owasp-agentic-compliance.ts`. Every LLM turn passes through:

1. **AI01 — Prompt injection** → output-guard + stripIndirectInstructions
2. **AI02 — Insecure output handling** → markdown is escaped before re-display
3. **AI03 — Training data poisoning** → no fine-tuning on tenant data; RAG sources whitelisted
4. **AI04 — Model DoS** → per-tenant rate limit (50 req/min) + response streaming budget
5. **AI05 — Supply chain** → `pnpm audit` in CI; SBOM via `cyclonedx`
6. **AI06 — Sensitive info disclosure** → PII scrubber on every inbound + outbound message
7. **AI07 — Insecure plugin** → tool-registry allowlist; every tool is typed
8. **AI08 — Excessive agency** → every write proposal requires user approval (the "Mr. Mwikila proposed-action" flow)
9. **AI09 — Overreliance** → disclaimer banner + confidence score exposed on every brain response
10. **AI10 — Model theft** → provider-side (Anthropic) responsibility; we don't self-host the LLM

## 3. Access-Control Matrix

| Role | Read tenant data | Write tenant data | Read other tenants | Manage users | Manage billing |
|---|:-:|:-:|:-:|:-:|:-:|
| `tenant` | own units | own profile | no | no | no |
| `owner` | own properties | own properties | no | no | no |
| `manager` | assigned properties | assigned properties | no | no | no |
| `station_master` | assigned locations | work-orders / inspections | no | no | no |
| `tenant_admin` | entire tenant | entire tenant | no | yes (within tenant) | yes (within tenant) |
| `super_admin` | all tenants | all tenants (audited) | yes | yes | yes |

All role checks run through `packages/authz-policy/src/policy.ts`. Super-admin writes are double-audited (standard audit log + `/audit/super-admin-writes` table) and paged to the on-call via PagerDuty.

## 4. Data Retention Policy

| Data class | Retention | Justification |
|---|---|---|
| Payment transactions | 7 years | TZ Financial Laws Act; NG NDPA |
| Lease agreements | 7 years after termination | TZ LRA; KE Rent Restriction Act |
| Audit log | 7 years | SOC2; DPA of TZ/KE/UG |
| Chat transcripts (agent) | 90 days | Minimise PII exposure window |
| Raw voice audio | 7 days (transcribed + discarded) | Minimise biometric risk |
| Marketing leads (unconverted) | 180 days | Cold-data minimisation |
| Session logs | 30 days | Minimise analytics exposure |
| Backups | 35 days rolling | Disaster recovery RPO=24h |

Automated purger lives in `services/scheduler/src/jobs/data-retention.job.ts`. GDPR/DPA "right to be forgotten" via `POST /api/v1/gdpr/erase-request`.

## 5. Incident Response

### Severity classification

- **Sev1** — data breach, payment-processing outage, full platform unavailability
- **Sev2** — partial feature outage affecting > 10% of tenants, LLM provider down
- **Sev3** — single-tenant issue, degraded performance
- **Sev4** — cosmetic / single-user issue

### Response playbook

1. **Detect** — PagerDuty alert from Sentry or Grafana (`infra/alerts/`)
2. **Triage** (≤ 5 min) — on-call acknowledges + assigns severity
3. **Contain** (≤ 30 min for Sev1) — feature-flag rollback (`/api/v1/feature-flags`), kill-switch, or revert via blue-green
4. **Investigate** — read audit log + trace via OpenTelemetry
5. **Communicate** — status.borjie.com update within 15 min of Sev1
6. **Post-mortem** — blameless write-up within 3 business days; published to `Docs/post-mortems/`
7. **Remediate** — action items tracked in `Docs/RISK_REGISTER.md`

### Breach notification timelines (legal)

- Tanzania DPA 2022: 72h to Commissioner
- Kenya DPA 2019: 72h to Data Commissioner + affected data subjects
- Uganda DPA 2019: 72h to PDPO
- Nigeria NDPA 2023: 72h to NDPC
- South Africa POPIA: "as soon as reasonably possible" to Information Regulator

## 6. Audit-chain Integrity

`packages/observability/src/audit/audit-logger.ts` computes a SHA-256 hash over `(prev_hash, event_json)` and stores in `audit.events.chain_hash`. Nightly job `scripts/verify-audit-chain.ts` walks the chain — any mismatch raises a Sev2 alert.

## 7. Key Rotation Cadence

| Secret | Rotation | Owner | Process |
|---|---|---|---|
| `JWT_SECRET` | 90 days | Platform eng | Dual-key window: accept both old and new for 24h |
| Postgres password | 180 days | Platform eng | `ALTER ROLE ... PASSWORD` + rolling restart |
| Redis password | 180 days | Platform eng | Rolling restart with REQUIREPASS |
| `ANTHROPIC_API_KEY` | 365 days | Platform eng | Create new key, update secrets store, revoke old key 24h later |
| Payment provider secrets | At each contract renewal | Finance | Vendor-driven rotation |
| TLS certs | 60 days (Let's Encrypt auto) | Certbot | Automated |
| Signing keys for receipts | 365 days | Platform eng | Document in `Docs/RUNBOOK.md § key-rotation` |

## 8. Hardening checklist (reviewed per release)

- [ ] `helmet()` enabled on every Express app
- [ ] CORS origin allowlist enforced
- [ ] Rate-limit middleware active on `/auth/*` (5 r/s) + `/api/*` (20 r/s)
- [ ] No secrets in container images (verified via `trivy image`)
- [ ] Dependencies patched (`pnpm audit` = 0 highs in main)
- [ ] OWASP top-10 unit tests green (`pnpm --filter @borjie/ai-copilot test:security`)
- [ ] Postgres `shared_preload_libraries` doesn't include debug extensions
- [ ] S3 buckets are private with `BlockPublicAccess=true`
- [ ] No `0.0.0.0/0` inbound rules except on the load-balancer SG
