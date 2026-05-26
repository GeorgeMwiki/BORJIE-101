# BORJIE — SOTA Security Posture 2026

Persona: **Mr. Mwikila** (SEC-2, security lead)
Last reviewed: 2026-05-26
Status: living document. Reviewed quarterly; superseded only by a higher-numbered revision in the same folder.

> Live-test mandate: every control listed here MUST be exercised against a real environment (staging or production behind a flag), not a recorded fixture. If a control cannot be live-tested it does not count as deployed.

---

## 0. Threat horizon

BORJIE is a multi-tenant property-management platform with AI-agent surface (Mr. Mwikila), voice agent, research orchestrator, audit hash-chain, payments connectors, geo-platform, and dozens of connector adapters. The platform handles PII regulated under the **Tanzania Personal Data Protection Act 2022 (TZ PDPA)**, **Kenya DPA 2019**, **Uganda DPA 2019**, **Nigeria NDPA 2023**, **South Africa POPIA**, and **EU GDPR**. Money movements (rent, payments-ledger) are subject to TZ Financial Laws Act + KE Rent Restriction Act. Failure modes range from cross-tenant data leak through prompt injection of the AI agent to forged HMAC payment webhooks.

This posture is **zero-trust** by default, **defense-in-depth** by construction, and **continuously validated** in CI.

---

## 1. Zero-Trust Model Mapped onto BORJIE

The model follows **NIST SP 800-207** (Zero Trust Architecture) — *never trust, always verify, assume breach*. We layer it onto our seven trust planes.

### 1.1 Identity plane

| Subject | Authentication | Authorisation |
|---|---|---|
| Human user | JWT (15m TTL, refresh rotated), MFA via TOTP (mandatory for `*_admin` roles) | RBAC via `packages/authz-policy/src/policy.ts`, tenant-scoped |
| Service-to-service (north-south) | mTLS at the cluster ingress, JWT signed by service-identity issuer | service-account ACL in `services/api-gateway/src/security/sa-allowlist.ts` |
| AI agent (Mr. Mwikila, voice-agent, research-orchestrator) | Workload identity → short-lived token (5m) per invocation | `packages/authz-policy` policies named `agent.*`; every tool-call carries `actor_id`, `tenant_id`, `purpose` |
| Connector adapter (external) | OAuth2 / API key in vault (1Password CLI, never in env at rest) | Connector-specific scope; tested via `scripts/audit-rls-coverage.mjs` |

No identity is **implicit**. Every request — even from internal services — must carry a verifiable credential and pass policy.

### 1.2 Device plane

- Engineer laptops: FileVault on, signed-OS only, YubiKey hardware MFA for GitHub + cloud console, MDM-managed.
- Production runners: ephemeral, fresh VM per pipeline run, no SSH except via bastion + audited session recording.
- End-user devices: not trusted. We do not deploy any code to them outside signed mobile binaries (`apps/buyer-mobile`, `apps/workforce-mobile`) shipped via app stores.

### 1.3 Network plane

- TLS 1.2+ everywhere, HSTS preload, MTA-STS on mail.
- Private VPC; pods talk via service mesh (mTLS, SPIFFE-style identity).
- No `0.0.0.0/0` ingress except load-balancer SG.
- Egress allowlist on AI workloads — Anthropic, OpenAI (only if a route requires it), Stripe, M-Pesa daraja, Sentry, observability sinks. Everything else `DROP`.
- DNS via private resolver; outbound to public DoH blocked at the egress filter for workload nodes.

### 1.4 Application plane

- `helmet()` defaults on every Express/Fastify app.
- CSP `default-src 'self'; img-src 'self' data: https:; script-src 'self' 'nonce-{NONCE}'; style-src 'self' 'nonce-{NONCE}'; object-src 'none'; frame-ancestors 'none'`.
- All inputs validated with `zod` before reaching any business logic. Enforced by `scripts/audit-zod-coverage.mjs` (CI).
- Output guard on every LLM turn (`packages/ai-copilot/src/security/output-guard.ts`).
- Rate-limit middleware on every route. Enforced by `scripts/audit-rate-limit-coverage.mjs` (CI).
- SSRF protection: `scripts/audit-ssrf-coverage.mjs` proves every outbound HTTP call goes through an allowlisted client.

### 1.5 Data plane

- All tenant data in Postgres with row-level security ENABLED + a tenant-scoped `auth.jwt() -> tenant_id` predicate on every table containing `tenant_id`. Enforced by `scripts/audit-rls-coverage.mjs`.
- All data **encrypted at rest** (Postgres TDE / cloud-managed KMS), **encrypted in transit** (TLS).
- PII fields tagged at the schema level; pii-scrubber runs on every log line and every analytics property (`packages/ai-copilot/src/security/pii-scrubber.ts`).
- Backups encrypted with a separate KMS key, restored quarterly to validate.
- Audit log is an append-only hash chain (SHA-256 over `(prev_hash, event_json)`); nightly verifier (`scripts/audit-chain-verify.mjs`) raises Sev2 on any mismatch.

### 1.6 Workload plane

- Every workload runs as a **non-root** user with `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`, dropped Linux capabilities.
- Container images are **scratch- or distroless-based** wherever possible; otherwise `node:20-alpine` with `npm audit` clean.
- Image provenance recorded as **SLSA Level 3** build attestation (cosign-signed) and stored alongside the SBOM.

### 1.7 Policy + audit plane

- All policy decisions go through `packages/authz-policy`. Every decision is observable, every denial is logged with `actor`, `resource`, `policy_id`, `reason`.
- 100% of writes touching money or PII are audit-logged with hash-chain entries.

---

## 2. Defense-in-Depth Layers

We assume any single layer can fail. Each layer is independent and re-evaluated quarterly.

### Layer 1 — Perimeter

- Cloud WAF (AWS WAF / Cloudflare) with the OWASP Core Rule Set v4.x in blocking mode.
- DDoS protection (anycast).
- Geo-fencing on admin endpoints (only TZ/KE/UG/NG/EU/US source ranges by default; deny-all elsewhere unless explicit allowlist).
- Bot-detection on high-value endpoints (`/auth/login`, `/api/v1/payments/*`, `/api/v1/listings/contact`).

### Layer 2 — Network

- VPC isolation per environment; no peering between staging and production.
- Private subnets for everything except the load-balancer.
- NetworkPolicies in the cluster: default `deny-all` pod-to-pod, explicit allow per service pair.
- mTLS between every service via service mesh (Linkerd or Istio depending on cluster).

### Layer 3 — Host

- Hardened base image; CIS Benchmark Level 1 on every node.
- AppArmor / SELinux profiles in enforcing mode.
- Auto-patching on a 7-day window for non-CVE updates, 24h for CVEs.

### Layer 4 — Application

- TS strict everywhere, no `@ts-nocheck`, no `any` in security-critical paths.
- ESLint security plugins (`eslint-plugin-security`, `eslint-plugin-no-secrets`, custom `eslint-rules/`).
- `helmet()`, CSP, CORS allowlist, anti-CSRF tokens on every state-changing route.
- Input validation via `zod` (mandatory, CI-enforced).

### Layer 5 — Data

- RLS in Postgres for every multi-tenant table.
- Column-level encryption for high-PII fields (NIDA, KRA PIN, MPesa MSISDN, bank account numbers).
- Data classification labels persisted in `compliance/data-classification.json`.
- Right-to-erasure tested live quarterly (`Docs/COMPLIANCE/right-to-erasure-playbook.md`).

### Layer 6 — Identity

- Short JWT TTL, refresh rotation, MFA mandatory for admins.
- Service identities via workload-identity federation (no long-lived service-account keys).
- Secrets in cloud KMS-backed vault (not env files at rest); env files are read into memory by the entrypoint, never written to disk on the workload.

### Layer 7 — Continuous Validation

(See section 5.) Without continuous validation the layers above rot.

---

## 3. Cloud-Native Security Controls per Layer

### 3.1 Build-time

| Control | Tool | CI workflow |
|---|---|---|
| SAST | Semgrep (auto ruleset + `.semgrep/borjie-rules.yml`) | `security-sast.yml` + `borjie-semgrep.yml` |
| SAST (Code AST queries) | GitHub CodeQL `security-extended` | `borjie-codeql.yml` |
| Dependency audit | `pnpm audit` + `audit-with-allowlist.mjs` | `security-deps-audit.yml` |
| SBOM | CycloneDX via Anchore syft, SPDX mirror | `security-sbom.yml` + `borjie-sbom.yml` |
| Container scan | Trivy fs + image | `security-container-scan.yml` + `borjie-trivy.yml` |
| Secret scan | TruffleHog v3 + gitleaks SARIF | `security-secret-scan.yml` + `borjie-security.yml` |
| Lockfile policy | `pnpm-lock.yaml` frozen, `overrides` for known CVEs (existing `package.json` overrides) | `ci.yml` |

### 3.2 Deploy-time

| Control | Tool |
|---|---|
| Image signing | cosign keyless (Fulcio + Rekor); SLSA L3 provenance attestation |
| Admission policy | Kyverno/OPA-gatekeeper rejecting unsigned images, hostPath, privileged pods |
| Migration safety | `scripts/validate-migration-safety.mjs` (existing) |
| OpenAPI drift | `scripts/audit-openapi-drift.mjs` (existing) |

### 3.3 Runtime

| Control | Tool |
|---|---|
| DAST (HTTP) | OWASP ZAP baseline scan against staging | `security-zap-baseline.yml` |
| Probe runners | `packages/probe-runners` (existing) — live probes against production behind a 1% sample |
| Red-team | `red-team.yml` (existing) — daily adversarial probe of the central-intelligence kernel |
| Audit-chain verify | nightly `scripts/audit-chain-verify.mjs` |
| Anomaly detection | observability pipeline (`packages/observability`) raising alerts via Sentry + Grafana |

---

## 4. AI-Agent-Specific Security Posture

The AI surface is the highest-novelty risk category. We follow **OWASP Top 10 for LLM Applications v2025** and the **NIST AI RMF 1.0 (AI 100-1)**.

### 4.1 Sandboxing

- Mr. Mwikila proposed-actions are executed in a sandbox process with no filesystem write outside `/tmp/agent-sandbox-<jobid>`, no network egress except the egress allowlist, no environment access beyond a curated allowlist (`AGENT_SAFE_ENV`).
- Voice agent transcripts go through the PII scrubber before any LLM inference; the raw audio is discarded after 7 days (see Data Retention in `Docs/SECURITY.md` §4).

### 4.2 Output filtering

- Every LLM output passes through `packages/ai-copilot/src/security/output-guard.ts` before being rendered or used as a tool argument.
- Markdown is escaped before re-display.
- Tool calls are validated against a `zod` schema; out-of-schema arguments are rejected and logged.

### 4.3 Audit hash chain

- `packages/audit-hash-chain` records every Mr. Mwikila decision with `prev_hash`, `event_json`, `chain_hash`. Tampering shows up as a mismatch in the nightly verifier. We treat this as a tamper-evident, append-only log — not as cryptographic proof in court, but as forensic evidence in incident response.

### 4.4 Kill switch

- Feature flag `agent.global_kill` halts every agent invocation within 60 seconds of being flipped. Tested quarterly. The kill-switch path bypasses the LLM and returns a fixed message: *"The agent is currently disabled by operations. Please contact support."*
- A second flag, `agent.tool_kill.<tool_name>`, scopes the kill to one tool only (e.g. disable `m-pesa-transfer` without disabling read-only conversation).

### 4.5 Prompt-injection defenses

- **Tier 1**: `stripIndirectInstructions` — strips any content that looks like a system-prompt override before adding it to the context window.
- **Tier 2**: tool-registry allowlist — only declared tools are callable; unknown names return an error.
- **Tier 3**: confirmation gate — every write requires explicit user confirmation. Mr. Mwikila proposes, the human disposes.
- **Tier 4**: red-team scenarios (`red-team.yml`) probe prompt-injection daily and fail the build if any scenario succeeds.

### 4.6 LLM provider isolation

- `ANTHROPIC_API_KEY` and any other LLM provider key is read only by the brain-llm-router; downstream packages call it via an in-cluster client. End-user-facing apps NEVER see the provider key.

---

## 5. Continuous Validation

We adopt **continuous validation** as a first-class discipline: every control above has a CI gate, a runtime probe, or a scheduled drill.

### 5.1 CI gates (blocking)

- `security-sast.yml` — Semgrep (HIGH/CRITICAL block)
- `security-secret-scan.yml` — TruffleHog v3 (any finding blocks)
- `security-sbom.yml` — SBOM artefact required, fails if SBOM is empty
- `security-deps-audit.yml` — `pnpm audit` HIGH/CRITICAL block (allowlist documented with `reason:` and `next_review:`)
- `security-container-scan.yml` — Trivy HIGH/CRITICAL block on fs + image
- `security-zap-baseline.yml` — OWASP ZAP baseline; HIGH blocks deploy
- `borjie-codeql.yml` — CodeQL security-extended
- `borjie-semgrep.yml` — custom BORJIE rules (cross-tenant lookup, raw error envelope, unbounded findMany, PII in logs)
- `live-test-discipline.yml` — proves no recorded-fixture cheats in live-test paths
- `red-team.yml` — adversarial probe of the agent kernel

### 5.2 Runtime probes (continuous)

- `packages/probe-runners` heartbeats every 60 seconds against production; failures page on-call.
- Audit-chain verifier (`scripts/audit-chain-verify.mjs`) nightly.
- Backup restore drill (`backup-restore-drill.yml`) weekly.
- Defection probe (`defection-probe.yml`) for anomaly detection on agent behaviour.

### 5.3 Red-team drills (scheduled)

- **Daily**: prompt-injection, jailbreak, PII extraction, cross-tenant leak (deterministic stubs in `red-team.yml`).
- **Quarterly**: external penetration test (third-party); findings go to `Docs/SECURITY/PENTEST_FINDINGS_<date>.md`.
- **Annually**: tabletop incident-response drill with the on-call rota.

---

## 6. Incident Response Playbook

See also `Docs/SECURITY.md §5` for the legacy short form. This is the canonical operational version.

### Step 1 — Detect (≤ 2 min from event)

Sources: PagerDuty alert from Sentry, Grafana, audit-chain verifier, red-team failure, DAST failure, customer report, vendor disclosure. Every detector posts to `#sec-incident` with `severity, asset, observed, run_id`.

### Step 2 — Triage (≤ 5 min, on-call)

- Confirm severity (Sev1 / Sev2 / Sev3 / Sev4 — see `Docs/SECURITY.md §5`).
- Assign Incident Commander (IC) and Communications Lead (CL).
- Open incident channel `#inc-YYYY-MM-DD-<slug>`.
- Start the incident timer.

### Step 3 — Contain (≤ 30 min for Sev1)

Containment tools, in order of preference:

1. Feature-flag rollback via `/api/v1/feature-flags`.
2. Kill switch (`agent.global_kill`, `agent.tool_kill.<x>`).
3. Block at WAF / egress filter.
4. Revoke compromised credentials in vault.
5. Blue-green revert.
6. Scale down the affected service (if safe).

### Step 4 — Eradicate

- Patch the vulnerability or remove the offending data.
- Rotate any potentially exposed secret (`Docs/SECRETS_ROTATION.md`).
- Add a regression test (Semgrep rule, ESLint rule, unit/integration test, red-team scenario).

### Step 5 — Recover

- Re-enable the disabled feature flag with the patch in place.
- Verify with live probes that the incident signal has cleared.
- Communicate resolution on `status.borjie.com` and to affected tenants per **breach-notification timelines** (TZ DPA 72h, KE DPA 72h, UG DPA 72h, NG NDPA 72h, ZA POPIA "as soon as reasonably possible", EU GDPR 72h).

### Step 6 — Learn

- Blameless post-mortem within 3 business days (`Docs/POSTMORTEMS/<date>-<slug>.md`).
- Action items tracked in `Docs/RISK_REGISTER.md` with owner + due date.
- New detector or new CI gate to prevent recurrence — incident is only closed when a regression-preventing control is in place.

---

## 7. Compliance Overlays — what each regime demands of us

This section maps the posture above onto the specific compliance regimes we either already serve (TZ PDPA, KE DPA, NG NDPA, EU GDPR) or are preparing for (SOC 2 Type II, ISO 27001).

### 7.1 Tanzania PDPA 2022

- Lawful basis register (`Docs/COMPLIANCE/lawful-basis-register.json`) — present and exercised.
- DPA-ke-runbook + PDPA-tz-runbook drives breach notification (72h to Commissioner).
- Cross-border transfer policy (`Docs/COMPLIANCE/cross-border-transfer-policy.md`).
- DPIA template for new high-risk processing (`Docs/COMPLIANCE/dpia-template.md`).

### 7.2 EU GDPR

- Article 30 record-of-processing exists (`Docs/COMPLIANCE/GDPR_ARTICLE_30.md`).
- Right-to-erasure (`right-to-erasure-playbook.md`) tested quarterly with a live tenant.
- Consent revocation runbook (`consent-revocation-runbook.md`).
- DPO contact published in `Docs/SECURITY.md §10` (TODO if missing).
- 72h breach notification to lead DPA.

### 7.3 SOC 2 Type II (target: 12-month report)

| Trust Service Criterion | BORJIE control |
|---|---|
| Security | Defense-in-depth (this doc §2), MFA, RBAC, audit log, vuln management |
| Availability | SLO doc (`Docs/KPIS_AND_SLOS.md`), incident response, backup restore drills |
| Processing integrity | Migration safety check, OpenAPI drift check, audit hash chain |
| Confidentiality | Tenant RLS, column-level encryption for high-PII, encrypted backups |
| Privacy | PII scrubber, retention policy, right-to-erasure, lawful basis register |

Evidence is collected automatically by `borjie-audit-coverage.yml` and stored as CI artefacts with ≥ 90-day retention.

### 7.4 ISO 27001 (target: certification within 18 months)

Annex A control mapping (selected):

- A.5 Information security policies → this document + `Docs/SECURITY.md`.
- A.8 Asset management → AI-BOM (`ai-bom.json`), SBOM (`borjie.cyclonedx.json`).
- A.9 Access control → `packages/authz-policy` + RBAC matrix.
- A.12 Operations security → CI gates + runtime probes.
- A.14 System acquisition → SLSA L3 provenance, signed images.
- A.16 Information security incident management → §6 above.
- A.17 BCP → backup-restore drill + multi-AZ HA via `docker-compose.ha.yml`.
- A.18 Compliance → `Docs/COMPLIANCE/`.

---

## 8. SLSA & Supply-Chain Posture

We target **SLSA Level 3** for every production artefact:

- **Source integrity**: protected `main` branch, signed commits required for `main`, two-reviewer approval (one of whom is Mr. Mwikila for security-sensitive paths).
- **Build integrity**: GitHub Actions on a hardened, ephemeral runner; build provenance generated and attached as an attestation; SBOM generated and signed.
- **Provenance**: cosign keyless via Fulcio; attestations stored in Rekor for transparency-log auditability.
- **Common threats addressed**: typo-squatting (lockfile pinning + `overrides` block), dependency confusion (`.npmrc` scoped registry), malicious maintainer takeover (`pnpm audit` + Trivy + scheduled SBOM diff), build-system compromise (ephemeral runners + signed provenance).

We track each finding in `.trivyignore` and `scripts/audit-with-allowlist.mjs` with `reason:` and `next_review:`. Nothing is permanently ignored.

---

## 9. SBOM Strategy

- **Format**: CycloneDX JSON (primary) + SPDX JSON (mirror).
- **Generation**: per push to `main` and per release, by `security-sbom.yml` and `borjie-sbom.yml`.
- **Storage**: GitHub release asset (release SBOMs) + CI artefact with 90-day retention (per-commit SBOMs).
- **Validation**: `jq` check on the SBOM ensures > 50 components and a non-empty `specVersion`.
- **Consumption**: regulator / procurement requests served directly from the release asset; internal vuln correlation done by piping SBOM into `grype sbom:borjie.cyclonedx.json`.

---

## 10. AI-BOM Strategy

In addition to the software SBOM, we maintain `ai-bom.json` at the repo root describing every model, prompt, training dataset (none, currently — we do not fine-tune), evaluation dataset, and inference provider. This is signed and attested by `ai-bom-attest.yml` (existing). Regulators in the EU (AI Act, in force phased through 2026) and Tanzania (forthcoming AI guidance) are expected to require this artefact.

---

## 11. What we have NOT yet built (gap register)

Honest disclosure. Tracked in `Docs/RISK_REGISTER.md` with owner and due date.

1. **SLSA L3 attestation on every image** — currently only on `api-gateway`; expand to every service.
2. **Hardware security module (HSM) for signing** — currently cosign keyless. HSM-backed signing for high-value artefacts.
3. **Continuous compliance reporting** to leadership — currently quarterly; target monthly.
4. **Bug-bounty program** — not yet launched; target Q4 2026 via HackerOne.
5. **Formal SOC 2 audit** — target Q2 2027.

---

## 12. Citations & Further Reading

All citations include title + URL + access date.

1. NIST. *Special Publication 800-207: Zero Trust Architecture.* https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf — accessed 2026-05-26.
2. CISA. *Zero Trust Maturity Model v2.0.* https://www.cisa.gov/zero-trust-maturity-model — accessed 2026-05-26.
3. Google. *BeyondCorp: A New Approach to Enterprise Security.* https://research.google/pubs/pub43231/ — accessed 2026-05-26.
4. OWASP. *Top 10 Web Application Security Risks (2021/2024 refresh).* https://owasp.org/Top10/ — accessed 2026-05-26.
5. OWASP. *Top 10 for LLM Applications v2025.* https://owasp.org/www-project-top-10-for-large-language-model-applications/ — accessed 2026-05-26.
6. OWASP. *API Security Top 10 (2023).* https://owasp.org/API-Security/editions/2023/en/0x11-t10/ — accessed 2026-05-26.
7. OWASP. *Mobile Application Security Top 10 (2024).* https://owasp.org/www-project-mobile-top-10/ — accessed 2026-05-26.
8. CIS. *CIS Kubernetes Benchmark v1.9.* https://www.cisecurity.org/benchmark/kubernetes — accessed 2026-05-26.
9. CIS. *CIS Docker Benchmark.* https://www.cisecurity.org/benchmark/docker — accessed 2026-05-26.
10. CIS. *CIS AWS Foundations Benchmark v3.0.* https://www.cisecurity.org/benchmark/amazon_web_services — accessed 2026-05-26.
11. SLSA. *Supply-chain Levels for Software Artifacts v1.0.* https://slsa.dev/spec/v1.0/ — accessed 2026-05-26.
12. OpenSSF. *Secure Supply Chain Best Practices.* https://openssf.org/projects/scorecard/ — accessed 2026-05-26.
13. CycloneDX. *Specification 1.6.* https://cyclonedx.org/specification/overview/ — accessed 2026-05-26.
14. SPDX. *Specification 2.3.* https://spdx.github.io/spdx-spec/v2.3/ — accessed 2026-05-26.
15. Aqua Security. *Trivy documentation.* https://aquasecurity.github.io/trivy/ — accessed 2026-05-26.
16. Snyk. *Container & Open Source Security best practices.* https://snyk.io/learn/container-security/ — accessed 2026-05-26.
17. Truffle Security. *TruffleHog v3 docs.* https://github.com/trufflesecurity/trufflehog — accessed 2026-05-26.
18. GitGuardian. *State of Secrets Sprawl 2024 Report.* https://www.gitguardian.com/state-of-secrets-sprawl-report-2024 — accessed 2026-05-26.
19. GitHub. *Secret scanning documentation.* https://docs.github.com/en/code-security/secret-scanning — accessed 2026-05-26.
20. Semgrep. *Semgrep CI documentation.* https://semgrep.dev/docs/semgrep-ci/overview/ — accessed 2026-05-26.
21. GitHub. *CodeQL documentation.* https://codeql.github.com/docs/ — accessed 2026-05-26.
22. OWASP. *ZAP baseline scan.* https://www.zaproxy.org/docs/docker/baseline-scan/ — accessed 2026-05-26.
23. PortSwigger. *Burp Suite Enterprise Edition.* https://portswigger.net/burp/enterprise — accessed 2026-05-26.
24. NIST. *AI Risk Management Framework (AI RMF 1.0).* https://www.nist.gov/itl/ai-risk-management-framework — accessed 2026-05-26.
25. Anthropic. *Claude Safety Best Practices.* https://docs.anthropic.com/claude/docs/use-claude-safely — accessed 2026-05-26.
26. CISA / FBI / NSA. *Joint advisory on SolarWinds supply-chain compromise (AA20-352A).* https://www.cisa.gov/news-events/cybersecurity-advisories/aa20-352a — accessed 2026-05-26.
27. Codecov. *2021 supply-chain incident post-mortem.* https://about.codecov.io/security-update/ — accessed 2026-05-26.
28. Snyk. *Recent npm typo-squatting / malicious package reports.* https://snyk.io/blog/category/malicious-packages/ — accessed 2026-05-26.
29. ENISA. *Threat Landscape for Supply Chain Attacks.* https://www.enisa.europa.eu/publications/threat-landscape-for-supply-chain-attacks — accessed 2026-05-26.
30. ISO. *ISO/IEC 27001:2022.* https://www.iso.org/standard/27001 — accessed 2026-05-26.

---

*This document is the canonical security posture. Any deviation requires a documented exception in `Docs/RISK_REGISTER.md` with owner, severity, and `next_review:` date.* — Mr. Mwikila

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
