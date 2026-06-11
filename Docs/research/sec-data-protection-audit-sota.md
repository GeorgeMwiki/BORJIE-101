# Data Protection & Privacy — SOTA Audit Dossier

**Area:** Security · Data Protection & Privacy
**Date:** 2026-06-08
**Auditor:** automated deep-audit subagent (MIT-PhD-depth pass)
**Repos audited:** Borjie (`/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Borjie`), BOSSNYUMBA101 (BN, ancestor) (`/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101`)

**Current level vs SOTA: 3.5 / 5** — the cryptographic *primitives* are SOTA-grade (envelope encryption, AEAD, HKDF per-tenant DEK, RDP accountant, hash-chained audit, KMS encryption-context binding). The gap is **wiring + governance**: the flagship `@borjie/data-protection` package (RTBF, retention, breach detection, crypto-shred, lineage) is built and unit-tested but **dark — invoked by zero runtime code paths**; PII detection is regex-only (no NER); a real cross-tenant AI-corpus integrity hole exists (no `WITH CHECK` on the global ground-truth table); and per-tenant data-residency KMS routing is plumbed-but-not-wired.

---

## 1. What SOTA looks like (2025–2026), with citations

| # | SOTA item | What it means | Source (verified) |
|---|-----------|---------------|--------------------|
| S1 | **Envelope encryption: long-lived KEK in HSM/KMS wrapping short-lived per-row DEKs** | DEK rotated frequently, KEK lives in HSM for the retention period; keys stored separately from ciphertext. | NIST SP 800-57 Pt1 Rev5 — https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final ; OWASP Cryptographic Storage Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html |
| S2 | **AES-256-GCM / ChaCha20-Poly1305 AEAD; authenticated modes mandatory; AAD binding** | Authenticated encryption (integrity + confidentiality); AAD binds ciphertext to its context. | OWASP Top 10 2025 A04 Cryptographic Failures — https://owasp.org/Top10/2025/A04_2025-Cryptographic_Failures/ ; OWASP Crypto Storage CS (above) |
| S3 | **1-year DEK crypto-period; automated KMS rotation; previous-gen kept for decrypt (soak window)** | Active keys deactivated yearly, retained for read; rotation automated & documented. | NIST SP 800-57 Pt1 Rev5 (above); CSRC SP 800-57 Pt2 Rev1 — https://csrc.nist.gov/pubs/sp/800/57/pt2/r1/final |
| S4 | **HSM-backed CMK; keys never in source/DB; prepare for post-quantum by 2030** | Most sensitive keys in HSM; PQC migration on the roadmap. | OWASP Top 10 2025 A04 (above) |
| S5 | **Hybrid PII detection: regex + NER (ML) + context-aware confidence** (Microsoft Presidio model) | Regex alone misses free-text/contextual PII; production systems combine rule-based + neural recognizers (50+ recognizers, GPU-accelerated). | Microsoft Presidio analyzer — https://microsoft.github.io/presidio/analyzer/ ; IntuitionLabs PHI de-id review — https://intuitionlabs.ai/articles/open-source-phi-de-identification-tools |
| S6 | **Crypto-shredding for RTBF on immutable logs; per-data-subject keys** | Destroy the subject's key → all their ciphertext irrecoverable; hash-chain integrity preserved, PII unreadable; pseudonymize the immutable trail. | Conduktor crypto-shredding — https://www.conduktor.io/glossary/crypto-shredding-for-kafka ; SecuPi caveats — https://secupi.com/crypto-shredding-is-not-nirvana-for-right-of-erasure-or-rtbf-compliance/ |
| S7 | **LLM02:2025 Sensitive Information Disclosure: input sanitization before inference, no user data into training, tenant isolation of corpora** | LLMs leak PII/secrets/training data; sanitize inputs, isolate tenant data, keep secrets out of prompts; model-inversion risk on shared training data. | OWASP GenAI LLM02:2025 — https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/ ; OWASP LLM Top 10 v2025 PDF — https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf |
| S8 | **TZ PDPA 2022 §31 + GN 449C/2023 Reg.20: cross-border transfer needs adequacy OR Commission permit OR a lawful-basis exception (consent/contract/public-interest)** | Personal data leaving TZ requires an adequacy finding, a transfer permit, or an enumerated exception; data-residency favored but not absolute. | Clyde & Co cross-border analysis — https://www.clydeco.com/en/insights/2024/10/cross-border-personal-data-transfers ; FPF overview — https://fpf.org/blog/tanzanias-personal-information-protection-act-overview-key-takeaways-and-context/ ; DLA Piper TZ — https://www.dlapiperdataprotection.com/?t=law&c=TZ |
| S9 | **Differential privacy: RDP/moments accountant for tight composition; subsampled-Gaussian tightening; PRV accountant is the tightest known** | Closed-form RDP for the unsubsampled Gaussian is loose under subsampling; SOTA uses subsampled-RDP / PRV accountants. | Mironov 2017 RDP — https://arxiv.org/abs/1702.07476 ; Wang-Balle-Kasiviswanathan subsampled RDP — https://arxiv.org/abs/1808.00087 |
| S10 | **Argon2/scrypt/PBKDF2-HMAC-SHA-512 for password hashing; TLS 1.2+ in transit; disable caching of sensitive responses** | Memory-hard password KDFs; modern TLS; no CDN caching of PII. | OWASP Top 10 2025 A04 (above) |

---

## 2. What Borjie actually has (grounded in code)

### Strong / SOTA-grade (verified real)

- **Field-level envelope encryption — two adapters, KMS-backed.**
  - `packages/database/src/security/encryption/kms-adapter.ts:153` — AWS KMS `GenerateDataKey` (AES_256) → AES-256-GCM field encrypt → wrapped-DEK packed inline; **KMS EncryptionContext binds (tenant, table, column)** as AAD (`makeContext`, line 298) so a DEK minted for tenant A/field F cannot decrypt B/G. Plaintext DEK zeroed in `finally` (line 230). Falls back to libsodium (XChaCha20-Poly1305) when SDK absent (`libsodium-adapter.ts`). **Matches S1/S2/S4.**
  - `packages/database/src/security/encryption/tenant-key-derivation.ts:107` — HKDF-SHA256 per-(tenant, table, column, version) DEK with structured `info`; per-tenant + per-field crypto isolation; versioned for rotation. Refuses boot without `ENCRYPTION_MASTER_KEY` (line 70). **Matches S1/S3.**
  - `packages/database/src/security/encryption/drizzle-encryption-middleware.ts:94` — `encryptRow`/`decryptRow`, idempotent (`enc:v1:` prefix), immutable (returns new object), legacy-plaintext pass-through for incremental migration, fire-and-forget audit sink.
  - **Wired:** `services/api-gateway/src/middleware/database.ts:189` (`selectEncryptionPort`) → threaded into `TenantRepository`/`UserRepository`; hard-fails in production if `ENCRYPTION_MASTER_KEY` missing (line 178).
- **Rotation soak-window guard** — `key-rotation-soak-window.ts` (14-day window, sentinel row in `field_encryption_audit`, `assertSafeToDropPreviousKey`). **Matches S3.** (Caveat: never called — see GAP-DP-07.)
- **AEAD primitive package** — `packages/data-protection/src/encrypt/aead-cipher.ts` — `@noble/ciphers` AES-256-GCM + ChaCha20-Poly1305, 256-bit keys, 96-bit nonce, fail-closed on tag mismatch; envelope (`envelope.ts`) adds an integrity hash + `cryptoShred()`. **Matches S2/S6 (primitive level).**
- **Hash-chained, append-only audit** — `packages/audit-hash-chain/src/chain.ts` — `prevHash`→`rowHash` SHA-256/HMAC chain, `verifyChain` reports first-broken index; cites Trillian/Rekor/QMDB. **Widely wired:** payments-ledger, decision-journal recorder, onboarding row-writer, doc-evolution, research-orchestrator. **Matches S6 (immutable-log integrity).**
- **Differential privacy stack (genuinely deep, genuinely wired):**
  - `packages/dp-federation/src/composition/rdp-accountant.ts` — Mironov-2017 closed-form Gaussian RDP + additive composition (cites arXiv 1702.07476).
  - `packages/graph-privacy/src/noise.ts` — crypto-RNG Laplace/Gaussian with **rejection-sampled 53-bit uniform** (no modulo bias); `UNSAFE_`-prefixed seeded source for tests only.
  - `packages/graph-privacy/src/aggregators/dp-aggregator.ts` — k-anonymity floor, reserve-budget-before-read, never publishes a per-tenant value, structured refusals; unified `PrivacyBudgetComposerService` closes the dual-ledger compounding hole (G2). **Wired** via `services/api-gateway/src/composition/sovereign.ts:67` + `apps/admin-web/.../platform/budget/route.ts`. **Matches S9 (closed-form tier).**
- **Privacy-aware AI router (LLM data governance) — wired end-to-end.**
  - `packages/privacy-router/src/router.ts` — RESTRICTED→local-only (deny if Ollama down), CONFIDENTIAL→cloud+mandatory PII-strip, content scan bumps stray-PII to CONFIDENTIAL, immutable audit ring buffer; policy in `privacy-routing-policy.yaml` (zod-validated, TZ PDPA/BOT-Act-aligned).
  - **Wired:** `services/api-gateway/src/composition/privacy-router-wiring.ts`, `multi-llm-brain-adapter.ts:45`, `routes/brain.hono.ts:671` — fail-closed (route+strip both fail → DENY, no raw egress). **Directly addresses S7.**
- **OCSF SIEM emitter + redaction** — `packages/ocsf-emitter/` wired at `composition/ocsf-emitter-wiring.ts`; `redaction.ts` strips email/E.164/TZ+KE local phone/NIDA before SIEM.
- **PII redaction in logs** — `packages/observability/src/pii-redactor.ts` (recursive, key-name based, snake+camel, cycle/depth guards, opaque class handling) + Pino `redact.paths` in `services/api-gateway/src/index.ts:813`. **Matches S10 (transit/log hygiene).**
- **Tenant isolation (RLS) — security-grade.** `services/api-gateway/src/middleware/database.ts:328` reserves ONE connection per request, binds `app.current_tenant_id` GUC on it, rebuilds repos on that connection (closes the postgres.js per-statement-checkout cross-tenant leak window). 178 migration files carry `ENABLE/FORCE ROW LEVEL SECURITY`. `packages/tenant-isolation-guard` adds eslint rules (`no-unscoped-query`), leak-scanner, tenant-scrubber.
- **Data-classification registry + masking** — `packages/database/src/security/data-classification.ts` — per-column RESTRICTED/CONFIDENTIAL/INTERNAL/PUBLIC + `encryptAtRest` + `maskType` + retention; `maskValue` renders phone/email/id/financial masks.
- **DSAR/RTBF HTTP surface (a SECOND, separate implementation)** — `services/api-gateway/src/routes/dsar.router.ts` (mounted `index.ts:1995`): export/preview/RTBF, role-gated, rate-limited, audit-emitting, real `DsarRtbfExecutor` (ANONYMIZE/HARD_DELETE/RETAIN per table, from `@borjie/ai-copilot`). Returns 503 (not a lie) when executor unwired.
- **Compliance docs depth** — `Docs/COMPLIANCE/` has PDPA-tz / GDPR-eu / DPA-ke / NDPA-ng runbooks, GDPR_ARTICLE_30, DATA_RETENTION_POLICY, SOC2_CONTROLS, SOTA_DATA_PROTECTION_2026.

### BN (BOSSNYUMBA) comparison
BN has `privacy-router`, `graph-privacy`, `ocsf-emitter`, `audit-hash-chain`, `security-audit` and the same `observability/pii-redactor`, but **lacks `data-protection` and `dp-federation`** (Borjie-only additions). BN adds a `security-audit` package + `pii-logger-scanner` + a `pii-minimizer` in `user-context-store` not present in Borjie. **Borjie is ahead on DP breadth; BN has a CI PII-log scanner Borjie should port.**

---

## 3. Gaps vs SOTA (every gap, with file:line evidence)

See structured `gaps[]`. Severity legend: BLOCKER (ships a false guarantee / real leak), HIGH, MED, LOW.

**Headline gaps:**

1. **GAP-DP-01 (HIGH) — `@borjie/data-protection` is a dark package.** RTBF orchestrator, retention runner, breach detector, envelope/crypto-shred, provenance lineage, auto-tagger are all built + unit-tested but invoked by **zero** runtime code. The only references in `services`/`apps` are *string literals* in `packages/jurisdiction-profiles/src/seed/seed-frameworks.ts` (compliance metadata), not function calls. So the SOTA breach-detection (S-equivalent), retention purge, and crypto-shred RTBF (S6) advertised in `Docs/COMPLIANCE/SOTA_DATA_PROTECTION_2026.md` do not actually run.

2. **GAP-DP-02 (BLOCKER) — global AI-corpus has no `WITH CHECK`; cross-tenant ground-truth poisoning possible.** `intelligence_corpus_chunks` RLS policy (`packages/database/drizzle/0003_mining_domain.sql:1107` and `src/migrations/0297_...:323`) is `USING (tenant_id IS NULL OR tenant_id = current_setting(...))` with **no `WITH CHECK`**. Under FORCE RLS, a tenant-scoped session can `INSERT ... (tenant_id = NULL)` — the row satisfies the USING predicate (`NULL IS NULL`) — writing into the `tenant_id IS NULL` global corpus that **every** tenant reads as ground truth. This breaks the CLAUDE.md hard rule "cross-tenant corpus tenant_id=NULL ground-truth safety" and is an LLM02 (S7) tenant-isolation / data-poisoning vector. Same shape on `ratings` (0003:1113).

3. **GAP-DP-03 (HIGH) — PII detection is regex-only; no NER / context model (S5).** Every detector is substring/regex: `data-protection/classify/auto-tagger.ts` (field-name substrings), `ocsf-emitter/redaction.ts`, `observability/pii-redactor.ts` (key-name match — misses PII in free-text *values*), `brain-llm-router/pii-input-scrubber`. No Presidio-style NER means free-text PII (names in `kyc_notes`, transcripts, document `extracted_text`) routed to cloud LLMs can leak. The classification registry even flags these as RESTRICTED but the *router's* strip step can't find unstructured PII.

4. **GAP-DP-04 (HIGH) — property-domain residue in the live data-classification registry.** `packages/database/src/security/data-classification.ts` classifies `customers`, `leases`, `payments`, `gepg_transactions`, `tenant_predictions`, `marketplace_listings.lister_phone`, `voice_turns` — BossNyumba property-management tables. Mining-domain PII tables (licence holder NIDA, beneficial-owner KYC, workforce employee PII, buyer KYC) are **absent**, so `encryptRow`/`maskValue`/retention for the actual mining schema silently no-op (unregistered → INTERNAL fallthrough). The encryption middleware is wired but pointed at the wrong table list.

5. **GAP-DP-05 (HIGH) — no automated DEK/CMK rotation; soak guard never invoked (S3).** `assertSafeToDropPreviousKey` / `recordKeyRotationStart` are exported (`packages/database/src/index.ts:48`) but have **no real call site** (grep returns none outside the module + index re-export). KMS adapter relies on AWS auto-rotation for the CMK but there is no scheduled re-encrypt of field DEKs and no operator path that actually consults the soak guard before dropping `ENCRYPTION_MASTER_KEY_PREV`.

6. **GAP-DP-06 (HIGH) — per-tenant data-residency KMS not wired (S8).** `services/api-gateway/src/middleware/database.ts:133` documents gh-issue #42 in a 35-line comment: the encryption port is a **module-load singleton bound to the default `AWS_REGION`**, so ZA/NG/KE tenants are encrypted under the platform-default region's CMK, not their residency-region CMK. `selectEncryptionPortForTenant`/`getTenantRegion` exist but are referenced only in that comment. TZ PDPA §31 cross-border posture (S8) is documented in the YAML policy but not enforced at the key-residency layer.

7. **GAP-DP-07 (MED) — DP accountant is closed-form only; no subsampled-Gaussian / PRV (S9).** `dp-federation/.../rdp-accountant.ts:16` self-documents: "numerically-tight subsampled Gaussian (Wang-Balle-Kasiviswanathan 2019) is a follow-up wave." Without subsampling tightening the ε spend is over-conservative (or, if subsampled queries are charged at the full bound, the budget burns too fast). `graph-privacy/budget-ledger.ts` uses basic/advanced composition (Dwork 2010), not RDP→(ε,δ) conversion, so the two ledgers don't share a unit.

8. **GAP-DP-08 (MED) — two parallel RTBF/erasure implementations; the wired one ignores the `data-protection` state machine.** The mounted DSAR router (`dsar.router.ts`) uses `@borjie/ai-copilot`'s `DsarRtbfExecutor`; the richer `@borjie/data-protection` RTBF orchestrator (lifecycle state machine + hash-chained audit + cascade-planner + crypto-shred) is unused. Crypto-shred (S6) on immutable hash-chain logs is therefore not the erasure path actually taken; the executor's ANONYMIZE/HARD_DELETE risks mutating hash-chained audit rows.

9. **GAP-DP-09 (MED) — consent is fragmented, not a first-class consent ledger (S7/PDPA).** Consent lives ad-hoc: `persons.schema.ts` (`consent_unified_kb_at`), `ambient_consents` (`ambient-listening.schema.ts`), scattered booleans. No central, versioned, audited consent record keyed by (subject, purpose, lawful-basis, granted/revoked timestamp, policy-version) that the DSAR export and the privacy-router can both consult.

10. **GAP-DP-10 (MED) — breach detector + 72-hour notification not running (PDPA s.30 / GDPR Art.33).** `data-protection/breach/breach-detector.ts` + `breach-notifier.ts` + `breach_events` table (drizzle/0053) exist; nothing feeds `audit_events` into `detectBreaches()` and nothing drives the 72h notifier. The notification clock is therefore not started by any code path.

11. **GAP-DP-11 (LOW) — no post-quantum migration plan in code (S4).** OWASP A04 2025 calls for PQC readiness by 2030. No hybrid KEM / crypto-agility seam beyond key-version bytes; the AEAD/KEK choice is hard-bound to classical algorithms.

12. **GAP-DP-12 (LOW) — BN's CI PII-log scanner not ported.** BN ships `packages/security-audit/src/scanners/pii-logger-scanner.ts` + `scripts/audit/run-pii-logs-scan.mjs`; Borjie's CLAUDE.md hard rule "No console.log in services" is enforced only by a hook, not a CI gate that pattern-matches PII in log statements.

---

## 4. Scoring rationale

| Dimension | Score | Note |
|-----------|-------|------|
| Crypto primitives (at-rest/in-transit/AEAD/KMS) | 4.5/5 | SOTA envelope + AAD-binding + HKDF isolation; -0.5 for no PQC seam, no automated rotation. |
| PII detection/redaction | 2.5/5 | Solid log/key-name + regex; -2.5 for no NER/context (S5) → free-text leak risk. |
| Tenant isolation / cross-tenant leakage | 3.5/5 | RLS connection-pinning is excellent; -1.5 for the corpus `WITH CHECK` poisoning hole (GAP-DP-02). |
| Hash-chained audit | 4.5/5 | Real, wired broadly; -0.5 erasure-vs-immutability tension unresolved. |
| Differential privacy | 4/5 | Genuinely deep + wired + unified budget; -1 closed-form only (no subsampled/PRV). |
| RTBF / retention / erasure | 3/5 | A wired DSAR path exists; -2 the SOTA crypto-shred + retention + breach machinery is dark. |
| Residency / cross-border | 2.5/5 | Policy documented; -2.5 not enforced at key layer (GAP-DP-06). |
| AI data governance (LLM02) | 3.5/5 | Privacy-router wired + fail-closed; -1.5 regex-only strip + corpus poisoning. |
| Consent | 2.5/5 | Fragmented, no central ledger. |
| **Overall** | **3.5/5** | World-class primitives, governance/wiring debt. |

---

## 5. Closure lanes (buildable, no deferral)

- **GAP-DP-02 (BLOCKER):** add a forward migration adding `WITH CHECK (tenant_id IS NULL = false OR pg_has_role(...))` — concretely, split into two policies: `corpus_read` (`FOR SELECT USING (tenant_id IS NULL OR tenant_id = GUC)`) and `corpus_write` (`FOR INSERT/UPDATE WITH CHECK (tenant_id = GUC)`), so a tenant session can never write a NULL-tenant (global) row; ingest worker writes global rows via a platform/service role bypassing RLS. Same fix for `ratings`. Add a leak-scanner assertion.
- **GAP-DP-01 / GAP-DP-08 / GAP-DP-10:** wire `@borjie/data-protection` at a composition root: feed `audit_events` → `detectBreaches()` on a cron, persist `breach_events`, start the 72h `breach-notifier`; make the DSAR RTBF executor delegate erasure of encrypted PII to `cryptoShred()` (key-shred) + the data-protection RTBF orchestrator state machine (pseudonymize, never mutate, the hash-chained `audit_events`).
- **GAP-DP-03:** add a Presidio service (or a TS NER recognizer) behind a `PiiDetectorPort`; the privacy-router already takes a `PiiStripperPort` (`router.ts:145`) — swap the regex impl for hybrid regex+NER; keep regex as the high-precision first pass.
- **GAP-DP-04:** rewrite `data-classification.ts` ENTRIES for the mining schema (licence-holder NIDA/TIN, beneficial-owner KYC, workforce employee PII, buyer KYC, assay/geo coordinates); delete property-domain rows.
- **GAP-DP-05:** add a scheduled `re-encrypt-field-deks` job + a composition-root call to `assertSafeToDropPreviousKey` gating the `ENCRYPTION_MASTER_KEY_PREV` drop.
- **GAP-DP-06:** lift the encryption port from process-singleton to request scope (or per-call arg) using the existing `selectEncryptionPortForTenant` + `getTenantRegion`; close gh-issue #42.
- **GAP-DP-07:** implement subsampled-RDP (Wang 2019) in `rdp-accountant.ts`; add an RDP→(ε,δ) conversion so `graph-privacy/budget-ledger.ts` and `dp-federation` share one accounting unit.
- **GAP-DP-09:** add a `consent_records` table (subject, purpose, lawful_basis, policy_version, granted_at, revoked_at) + a `ConsentPort` consulted by DSAR export and the privacy-router.
- **GAP-DP-11:** introduce a crypto-agility seam (algorithm tag in `WrappedDek` already exists; add a hybrid-KEM placeholder + ADR).
- **GAP-DP-12:** port BN's `pii-logger-scanner` into a `borjie-`prefixed CI workflow.

---

## 6. Source list (all verified by fetch/search this session)

- NIST SP 800-57 Pt1 Rev5 — https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final
- NIST SP 800-57 Pt2 Rev1 — https://csrc.nist.gov/pubs/sp/800/57/pt2/r1/final
- OWASP Cryptographic Storage Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- OWASP Key Management Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html
- OWASP Top 10 2025 A04 Cryptographic Failures — https://owasp.org/Top10/2025/A04_2025-Cryptographic_Failures/
- OWASP GenAI LLM02:2025 Sensitive Information Disclosure — https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/
- OWASP LLM Top 10 v2025 PDF — https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf
- Microsoft Presidio analyzer — https://microsoft.github.io/presidio/analyzer/
- IntuitionLabs open-source PHI de-identification review — https://intuitionlabs.ai/articles/open-source-phi-de-identification-tools
- Clyde & Co — TZ cross-border personal data transfers — https://www.clydeco.com/en/insights/2024/10/cross-border-personal-data-transfers
- Future of Privacy Forum — TZ PIPA overview — https://fpf.org/blog/tanzanias-personal-information-protection-act-overview-key-takeaways-and-context/
- DLA Piper — Tanzania data protection — https://www.dlapiperdataprotection.com/?t=law&c=TZ
- Mironov 2017 Rényi Differential Privacy — https://arxiv.org/abs/1702.07476
- Wang-Balle-Kasiviswanathan 2019 Subsampled RDP — https://arxiv.org/abs/1808.00087
- Conduktor — crypto-shredding for GDPR deletion — https://www.conduktor.io/glossary/crypto-shredding-for-kafka
- SecuPi — crypto-shredding caveats for RTBF — https://secupi.com/crypto-shredding-is-not-nirvana-for-right-of-erasure-or-rtbf-compliance/
