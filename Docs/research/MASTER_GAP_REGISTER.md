# MASTER GAP REGISTER — single consolidated source of truth

**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Author:** consolidation pass over every audit dossier in `Docs/research/` + the confirmed live gaps from this session.
**Purpose:** ONE register so nothing from the two synthesis workflows (which failed only at their oversized final consolidation step) is lost or deferred. Every audited gap is a row here with a **buildable closure lane** and a **wave**. Nothing is deferred — every gap is assigned a lane and a wave.

**Method:** Read all 11 primary gap dossiers (6 AGI-dimension + AGI brain-layer SOTA + 4 security/data/media/doc), the 4 already-known lane specs (SCALE / MD_AS_BODY / ORCHESTRATION / EXECUTION_WAVES23) and the knowledge-infra audit (`borjie-bn-knowledge-infra-audit.md`). Overlapping gaps that appear in multiple dossiers are **de-duplicated into a single row** with cross-references (e.g. the modality arbiter is named by cognition-G7, autonomy-G14, and ORCHESTRATION_SPEC → one row `COG-07`). Confirmed live gaps from this session are merged into the matching row and tagged **[CONFIRMED]**.

---

## Header — totals & critical path

**Total consolidated gaps: 132** (after de-duplication of cross-dossier overlaps).

**Count by severity:**

| Severity | Count |
|---|---|
| BLOCKER | 22 |
| HIGH | 58 |
| MED | 41 |
| LOW | 11 |

**Count by dimension/area:**

| Area | Prefix | Gaps |
|---|---|---|
| Knowledge flow (corpus/KG/retrieval/ingest) | KI | 17 |
| Memory & continual learning | MEM | 11 |
| Cognition & reasoning | COG | 16 |
| Autonomy & self-improvement | AUT | 16 |
| Embodiment & action (MD-as-body) | EA | 12 |
| Reliability / scale / safety | RSS | 24 |
| Domain mastery | DM | 16 (mining 24-domain matrix + RE 19-domain matrix folded) |
| Security architecture | SEC | 9 |
| Data protection & privacy | DP | 12 |
| Media generation | MG | 9 (folded into closure lanes A–E) |
| Document generation | DOC | 9 (folded into closure lanes) |

> Dimension counts overlap with the wave grouping below — a gap appears **once** in the register (in its wave), and its prefix tells you the source dossier.

**Critical path (the dependency spine — do in this order):**

```
WAVE A  (unblocks the most; mostly disjoint, do first)
  knowledge-flow P0  ──►  memory durability  ──►  everything that "compounds"
  scale P0 (8 caps)  ──►  stateless gateway   ──►  AUTO can ever be safe-at-scale
  security/data P0   ──►  no false guarantee / no cross-tenant leak

WAVE B
  outbox durable money-path  ──►  at-least-once + saga compensation
  embodiment-live (body schema + body-change syscall + state bus)
  capability/skill synthesis (modality arbiter + skill-capture + tool synth)
        │  (the modality arbiter is the single head everything else lands on)
        ▼
WAVE C
  domain-depth (wire 3 dark agents + replicate the deterministic-engine pattern)
  media + document generation last-mile (real bytes, real binary, real e-sign)

WAVE D
  self-improvement loop (replay→eval→update, GEPA, AFlow, ADAS, DGM archive)
  remaining MED/LOW polish + the eval harness that DEFINES "done"
```

**The one keystone:** `COG-07 / AUT-14` — the **modality arbiter** (ANSWER/SKILL/WORKFLOW/LOOP/AGENT before `router.call`). Until it ships, captured skills (B), discovered workflows (D), and the loop-runner have **nowhere to land**. It is in Wave B and gates most of Wave D.

**The one invariant (never violated by any lane):** the offense moat (self-improvement, self-writing memory, AUTO) is safe ONLY because of the defense moat — they are ONE system. Money / licence / deletion stay dual-control HITL forever; the agent can grow capability but can **never** touch its own gate/audit/test machinery (the meta-rail, `inviolable.ts:482`).

---

# WAVE A — knowledge-flow + scale-P0 + security/data-P0 (they unblock the most)

These are mostly disjoint and remove every "the system is structurally blocked / leaks / lies" class. Do them first.

## A.1 — Knowledge flow (the pipe is dry at both ends and broken in the middle)

| ID | Dim | Sev | One-line | Evidence | Closure lane (area/path) | Eff | Seq |
|---|---|---|---|---|---|---|---|
| KI-01 | KI | BLOCKER | **[CONFIRMED]** Dead default corpus path → zero global knowledge ingests | `borjie-corpus-cli.ts:31-39` (path `…/Boji project/Docs` gone); `walkMarkdown` swallows ENOENT → `filesScanned:0`, exit 0 | Repoint `DEFAULT_DOCS_ROOT` at in-repo `Docs/_BOJI_PROJECT_INTAKE_2026_05_27/`; FAIL LOUD (non-zero) when `filesScanned===0`. `services/consolidation-worker` | S | A1 |
| KI-02 | KI | BLOCKER | Env-var mismatch: docs say `BORJIE_MINING_CORPUS_PATH`, code reads `BORJIE_DOCS_ROOT` | `borjie-corpus-cli.ts:32`; var referenced in 8 docs, 0 source | Read `BORJIE_MINING_CORPUS_PATH` (keep old as alias one release). One-line. `services/consolidation-worker` | S | A1 |
| KI-05 | KI | BLOCKER | `ON CONFLICT (source_file, section)` has no matching unique index (lost in fork) | `borjie-corpus-adapters.ts:114`, `ocr-extraction-task.ts:768`; only non-unique idx `0003:965`; BN has it (`0285:58`) | Forward migration: UNIQUE `(tenant_id, source_file, COALESCE(section,''))`; port BN 0285. `packages/database` | S | A2 |
| KI-07 | KI | HIGH | Chat ANN selects non-existent column `chunk_text` → silent ILIKE fallback | `chat-corpus-evidence.ts:270-287`; column is `text` (`0003:955`) | `SELECT … text …`; add integration test asserting ANN returns rows. `services/api-gateway` | S | A2 |
| KI-08 | KI | MED | Distance op `<->` (L2) vs index `vector_cosine_ops` mismatch → seq scan + wrong ranking | `chat-corpus-evidence.ts:275` vs `0012:23` | Use `<=>` (cosine) end-to-end (both repos). `services/api-gateway` + migration | S | A2 |
| KI-06 | KI | MED | Nullable `section` → unique upsert won't dedupe NULL rows | `intelligence-corpus.schema.ts:59` | `NOT NULL DEFAULT ''` or `COALESCE(section,'')` in the unique index (folds into KI-05). `packages/database` | S | A2 |
| KI-03 | KI | HIGH | Corpus ingest never invoked at boot or by any cron (manual CLI only) | `consolidation-worker/src/index.ts` (no corpus ref) | Idempotent first-boot guard (`corpus_ingest_runs` marker) in worker bootstrap OR post-deploy CI step. `services/consolidation-worker` | M | A3 |
| KI-17 | KI | HIGH | No standing regulatory-change sensor; research crons not scheduled in gateway | `research-wiring.ts` (no cron); crons only in standalone svc | Schedule daily-briefing + continuous-watch; add write-back sink appending verified diffs to `intelligence_corpus_chunks` (tenant NULL). `services/api-gateway`+`research-orchestrator` | M | A3 |
| KI-16 | KI | HIGH | Real regulator-feed adapter (Tumemadini/NEMC/TRA/BoT/GePG) not registered in research registry | `research-tools/.../regulator-feed-adapter.ts` vs `research-adapters.ts:148-303` | Register `createRegulatorFeedAdapter()`; map to `anticipatory_sweep`/`continuous_watch`. `services/api-gateway` | S | A3 |
| KI-10 | KI | HIGH | Live KG wired with **real-estate** ontology in a mining product | `ported-domain-wiring.ts:49,107` (`realEstateOntology`); no `miningOntology` exists | Author `miningOntology` (licence/mineral/deposit/buyer/royalty/shipment/assay/jurisdiction); swap in. `packages/knowledge-graph` | M | A3 |
| KI-13 | KI | HIGH | OCR tenant-ingest writes corpus but blocked by KI-05 + tenant-bleed conflict key omits tenant_id | `ocr-extraction-task.ts:768-771` (`DO UPDATE SET tenant_id=EXCLUDED`) | Ship KI-05 with `tenant_id` in conflict key. `services/consolidation-worker` | S | A2 |
| KI-graphrag | KI | HIGH | **[CONFIRMED]** `graph-rag-router` orphan: full hybrid-retrieval stack reached by no request path | only importers = sleep-pass pass + schema index (`KI-11`) | Decide one graph stack of record: route chat retrieval through `graph-rag-router` hybrid retriever OR retire + fold community-summary into wired path. `packages/graph-rag-router` | L | A4 |
| KI-14 | KI | MED | Brain-ingestion ("C-1") + KG grower have no route/consumer (organize step never runs) | `services/api-gateway/src/services/brain-ingestion/*`, `grower.ts` — no importer | Wire `brain-ingestion.ingest`+`grower` into upload/OCR path so uploads grow entity graph. `services/api-gateway` | M | A4 |
| KI-12 | KI | MED | `@borjie/document-analysis` orphan (never imported by gateway) | grep `@borjie/document-analysis` in gateway = 0 | Route owner/tenant uploads through its orchestrator OR retire if OCR task is the single path. `packages/document-analysis` | M | A4 |
| KI-11 | KI | MED | Two parallel graph stacks (knowledge-graph wired vs graph-rag-router near-orphan) | dup investment | Consolidate to one path of record (pairs with KI-graphrag). `packages/{knowledge-graph,graph-rag-router}` | M | A4 |
| KI-04 | KI | LOW | Embedder doc-vs-reality drift (schema says Cohere@1024, code uses OpenAI 3-large@1024) | `intelligence-corpus.schema.ts:16` vs writers | Correct comments to "OpenAI text-embedding-3-large @1024 matryoshka"; declare canonical embedder. `packages/database` | S | A4 |
| KI-rls-drift | KI | HIGH | **[CONFIRMED]** Live-vs-repo RLS policy drift (`auth_tenant_isolation` on live not in any migration) | live Supabase carries a policy no migration creates | Capture live policy into a forward migration; add CI drift check (live-vs-repo policy diff). `packages/database` + migration-safety CI | M | A4 |

## A.2 — Scale P0 (the 8 caps + the in-process-state ceilings)

| ID | Dim | Sev | One-line | Evidence | Closure lane | Eff | Seq |
|---|---|---|---|---|---|---|---|
| RSS-03 | RSS | BLOCKER | **[CONFIRMED]** RLS reserved-connection pinning + `prepare:true` incompatible with tx-pooler (:6543) → cross-tenant leak OR starvation | `client.ts:222-245,73-101`; prod URL `:6543` | Drop `reserve()`; bind GUC via `SET LOCAL` per op (`withTenantContext`); set `prepare:false`. Route all routes through `databaseMiddlewareNoPin`. `packages/database`+`api-gateway/middleware` | L | A1 |
| RSS-10 | RSS | BLOCKER | **[CONFIRMED]** Prod overlay ships Postgres `replicas:1`+RWO and Redis `replicas:1` — SPOF; HA bundle exists but unreferenced | `overlays/prod/kustomization.yaml:11`→base; `postgres-statefulset.yaml:31`; `redis-deployment.yaml:17`; `k8s/ha/*` unused | Point prod overlay at `k8s/ha/` (or managed PG-with-standby + Redis Sentinel/Upstash); wire `DATABASE_URL_READONLY`. `infra/k8s/overlays/prod` | L | A1 |
| RSS-06 | RSS | HIGH | **[CONFIRMED]** ~26/27 in-process crons run on every replica, no leader election → 50× LLM cost + DB-poll fan-out | `index.ts:3252-3361`; only wake-loop uses advisory lock; no `cluster-lock.ts` (BN has it) | Port BN `cluster-lock.ts` (`pg_try_advisory_lock`); wrap each `.start()` in `withClusterLock(stable-id)`. `api-gateway/composition` | M | A2 |
| RSS-05 | RSS | HIGH | **[CONFIRMED]** Cockpit SSE bus is in-process EventEmitter → ~(N-1)/N events dropped at >1 replica | `cockpit-events/bus.ts:36` | Swap EventEmitter seam for Postgres LISTEN/NOTIFY or Redis pub/sub (signatures named for it). Needs RSS-09 Redis. `api-gateway` | M | A2 |
| RSS-04 | RSS | HIGH | **[CONFIRMED]** ≥5 DB pools/process × max:20 × ≤50 replicas overruns `max_connections` | `client.ts:75`; 5 distinct `createDatabaseClient` sites | Consolidate to `getDb()` shared pool; PgBouncer/Supavisor tx-mode; size from budget. `packages/database` + 5 call sites | M | A2 |
| RSS-08 | RSS | HIGH | **[CONFIRMED]** Per-route rate limiters use process-local Map → cap = max×replicas | `rate-limiter.ts:103-106,144,245` | Route `perUserRateLimit`/`customRateLimit` through shared Redis token-bucket; delete Map. Needs RSS-09. `api-gateway/middleware` | M | A2 |
| RSS-09 | RSS | HIGH | **[CONFIRMED]** In-memory onboarding store fallback → multi-step onboarding breaks across replicas/rollout | `onboarding.router.ts:70,161` | Drizzle store is the only prod path; hard 503 when db missing; deploy HA Redis (pairs with RSS-05/08). `api-gateway` + `infra/k8s` | S | A2 |
| RSS-16 | RSS | BLOCKER | **[CONFIRMED]** No autonomy-controller meta-rail (Shield trigger→check→enforce outside the agent loop) | SCALE_SPEC P0 #8; `kernel/autonomy-controller/` does not exist | Build `kernel/autonomy-controller/` wrapping policy-gate+inviolable, immutable to the agent (DGM invariant). `packages/central-intelligence` | L | A3 |
| RSS-02 | RSS | HIGH | Outbox drainer publishes on in-process bus, no leader election | `outbox-worker.ts:1-8,81` | Wrap `tick` in `withClusterLock(OUTBOX_LOCK_ID)` (RSS-06) + cross-replica bus (RSS-05). `api-gateway/workers` | M | A3 |
| RSS-07 | RSS | MED | fx-feed cron no `ON CONFLICT`, no leader lock → dup money-path rows + gov-endpoint ban risk | `fx-feed-cron.ts:221,251` | cluster-lock (RSS-06) + `ON CONFLICT (ts,pair) DO UPDATE`. `api-gateway/workers` | S | A3 |
| RSS-11 | RSS | MED | nginx ingress buffers SSE + 60s read cap → severs brain/LLM streams | `ingress.yaml:19` | `proxy-buffering:off` + `proxy-read-timeout≥180` on stream paths. `infra/k8s` | S | A3 |
| RSS-24 | RSS | LOW | HPA ceiling mismatch (helm 50 vs base 20) — changes RSS-04 math | `values.yaml:141` vs `api-gateway-hpa.yaml:12` | Reconcile; render base from helm; add KEDA RPS/queue scalers. `infra/k8s` | S | A3 |

## A.3 — Security & data-protection P0 (false guarantees / real leaks)

| ID | Dim | Sev | One-line | Evidence | Closure lane | Eff | Seq |
|---|---|---|---|---|---|---|---|
| DP-02 | DP | BLOCKER | Global AI-corpus RLS has no `WITH CHECK` → cross-tenant ground-truth poisoning | `0003_mining_domain.sql:1107`, `0297:323` (`USING (tenant_id IS NULL OR …)`, no WITH CHECK); same on `ratings` | Split into `corpus_read` (SELECT USING) + `corpus_write` (INSERT/UPDATE WITH CHECK `tenant_id=GUC`); ingest writes global rows via service role. Forward migration + leak-scanner assert. `packages/database` | M | A1 |
| SEC-G1 | SEC | BLOCKER | `@borjie/agent-security-guard` built but NEVER wired (tool-use-validator dark at dispatch) | refs = 2 docstrings only; `tool-dispatcher.ts` has no security check | Wire `createToolUseValidator` before every dispatch; `createIndirectInjectionDetector` on tool-result re-ingestion; persist via existing Drizzle tables. OR delete if `ai-copilot/src/security` is canonical (decide one). `api-gateway` | L | A2 |
| SEC-G2 | SEC | HIGH | Live JWT verifier skips `iss`/`aud`; hardened verifier is the dead one | `hono-auth.ts:161-163` (no issuer/audience); `auth.middleware.ts:252-338` correct-but-dead | Add `issuer`+`audience:'authenticated'`; port `app_metadata`-only guard; delete dead verifier. `api-gateway/middleware` | M | A2 |
| SEC-G3 | SEC | HIGH | Token revocation blocklist process-local → authn-bypass-after-logout under HPA | `token-blocklist.ts:21` (per-process Map) | `RedisTokenBlocklist` behind existing interface; `EXISTS jti` on verify. `api-gateway` | M | A2 |
| SEC-G4 | SEC | HIGH | Semgrep custom-rule SAST gate broken/advisory → tenant-scoped-repo rule never gates merge | `borjie-semgrep.yml:53-70` (`|| echo … skipped`) | Repair `.semgrep/borjie-rules.yml` schema; drop fallthrough; mark CodeQL required in branch protection. `.github/workflows` | S | A2 |
| DP-01 | DP | HIGH | `@borjie/data-protection` dark: RTBF/retention/breach/crypto-shred/lineage invoked by zero runtime | only string-literal refs in seed | Wire at composition root: `audit_events`→`detectBreaches()` cron; DSAR RTBF delegates to `cryptoShred()`+state machine. `api-gateway` + `packages/data-protection` | L | A3 |
| DP-03 | DP | HIGH | PII detection regex-only; no NER/context (free-text PII leaks to cloud LLMs) | all detectors substring/key-name | Add Presidio/TS-NER behind `PiiDetectorPort` (router already takes `PiiStripperPort`); keep regex first-pass. `packages/privacy-router` | M | A3 |
| DP-04 | DP | HIGH | Property-domain residue in live data-classification (mining PII tables absent → encrypt/mask no-op) | `data-classification.ts` lists leases/payments/gepg etc., not licence-NIDA/KYC/workforce | Rewrite ENTRIES for mining schema; delete property rows. `packages/database` | M | A3 |
| DP-06 | DP | HIGH | Per-tenant data-residency KMS not wired (ZA/NG/KE encrypted under default region CMK) | `database.ts:133` (module-singleton port); gh-#42 | Lift port to request scope via `selectEncryptionPortForTenant`+`getTenantRegion`. `api-gateway` | M | A3 |
| DP-05 | DP | HIGH | No automated DEK/CMK rotation; soak guard never invoked | `assertSafeToDropPreviousKey` no call site | Scheduled `re-encrypt-field-deks` job + composition call to soak guard before `…_PREV` drop. `packages/database` + worker | M | A4 |
| SEC-G6 | SEC | MED | Property→mining residue in security path: prompt-shield says "property management"; kill-switch guards eviction/sublease not mining ops | `prompt-shield.ts:331`; `kill-switch.middleware.ts:74-99` | Rewrite `KillSwitchOperation`/flag keys → mining irreversible ops + apply guard + seed flags; fix injection persona copy. `api-gateway` + `ai-copilot` | M | A4 |
| SEC-G7 | SEC | MED | App-layer `TenantIsolationEnforcer` exists but RLS is the only real gate (no defense-in-depth on reads) | `authz-policy/.../tenant-isolation.ts` unused on read repos | Wrap high-value reads (ledger/KYC/bids) with `wrapDataAccess`; port BN `security-audit` regression harness. `api-gateway` repositories | M | A4 |
| DP-08 | DP | MED | Two parallel RTBF impls; wired one ignores data-protection state machine (risks mutating hash-chain) | `dsar.router.ts` uses ai-copilot executor; data-protection orchestrator unused | DSAR delegates to data-protection RTBF state machine + crypto-shred; pseudonymize never mutate audit. `api-gateway` | M | A4 |
| DP-09 | DP | MED | Consent fragmented, no first-class consent ledger | scattered booleans (`persons`, `ambient_consents`) | `consent_records` table + `ConsentPort` consulted by DSAR + privacy-router. `packages/database` | M | A4 |
| DP-10 | DP | MED | Breach detector + 72h notification not running (PDPA s.30 / GDPR 33) | `breach-detector.ts`/`breach_events` exist, no feeder | Feed `audit_events`→`detectBreaches()` cron; drive 72h notifier (folds into DP-01). `api-gateway` | M | A4 |
| DP-07 | DP | MED | DP accountant closed-form only; no subsampled-Gaussian/PRV; two ledgers don't share unit | `rdp-accountant.ts:16` self-noted | Implement subsampled-RDP (Wang 2019) + RDP→(ε,δ) conversion so ledgers share a unit. `packages/dp-federation`+`graph-privacy` | M | A4 |
| SEC-G5 | SEC | MED | No kernel-level isolation (gVisor/Kata RuntimeClass) for V8-sandbox workloads | no `runtimeClassName` in k8s | Add gVisor RuntimeClass to brain/sandbox node pool; set `runtimeClassName` there only. `infra/k8s` | L | A4 |
| SEC-G8 | SEC | LOW | `helmet()` framework defaults; CSP/HSTS not tuned | `index.ts:867` | Explicit helmet config + nonce-based CSP for Next apps. `api-gateway`+`apps` | S | A4 |
| SEC-G9 | SEC | LOW | Red-team/sycophancy/defection probes nightly, not all hard PR gates | `defection-probe.yml` etc. nightly | Add fast (≤2min, stub-sensor) agentic red-team smoke to `pr-check.yml`. `.github/workflows` | S | A4 |
| DP-11 | DP | LOW | No post-quantum migration plan in code | AEAD/KEK hard-bound classical | Crypto-agility seam (algorithm tag exists) + hybrid-KEM placeholder + ADR. `packages/data-protection` | S | A4 |
| DP-12 | DP | LOW | BN's CI PII-log scanner not ported | BN `pii-logger-scanner.ts` absent in Borjie | Port into a `borjie-`prefixed CI workflow. `.github/workflows` | S | A4 |

## A.4 — Memory durability (so everything else compounds)

| ID | Dim | Sev | One-line | Evidence | Closure lane | Eff | Seq |
|---|---|---|---|---|---|---|---|
| MEM-01 | MEM | BLOCKER | `memory-v2` (6-layer substrate) in-memory only → wiped on every gateway restart | all `store-inmemory.ts`; no `*-drizzle.ts`; `service-registry.ts:474` | Add Drizzle stores for all 6 layers; swap `createInMemoryMemoryV2`. `packages/memory-v2` | L | A2 |
| MEM-02 | MEM | BLOCKER | `cognitive_memory_cells` has live recall but NO live `observe()` writer → reads empty store | grep `.observe(` in gateway = Prometheus only | Wire live `observe()` write on `/turn`. `api-gateway`+`packages/cognitive-memory` | M | A2 |
| MEM-03 | MEM | HIGH | `persistent_memory_session` write dead (`createSessionMemoryUpsert` never invoked) | only in `cognitive-wiring.ts:52` docstring | Wire the session-memory upsert on turn end. `api-gateway` | M | A3 |
| MEM-04 | MEM | HIGH | `personal_memory_cells` write dead (personal-KB route read-only) | `personal-kb.hono.ts` SELECT only (212,293) | Add INSERT path under consent gate. `api-gateway` | M | A3 |
| MEM-09 | MEM | HIGH | Embedding-space split (corpus 1024 vs cognitive/skills 1536; KG copies 1024 into 1536) | `ingest.ts:430-457` | Pick 1536 everywhere (or re-embed lane to converge corpus→1536); stop cross-space copies. `packages/database`+`knowledge-graph` | L | A3 |
| MEM-05 | MEM | HIGH | Real consolidator not on default path (stub: 1 fact / 5 turns) | `index.ts:625`, `consolidation.ts:133` | Swap stub → Haiku consolidator (plug-in compatible). `services/consolidation-worker` | M | A3 |
| MEM-06 | MEM | MED | KG ingest heuristic substring `mentions`; no LLM entity/relation extraction | `ingest.ts:476-495`; `grower.ts:13` "heuristic-only" | LLM entity/relation extraction (AutoSchemaKG) at ingest. `packages/knowledge-graph` | L | B (depends KG ontology A3) |
| MEM-07 | MEM | MED | Bi-temporal + PROV-O modules built but unused by ingest (facts overwrite, no invalidate-with-timestamp) | `temporal/bi-temporal.ts`, `provenance/prov-o.ts` exist; ingest writes neither | Wire bi-temporal + PROV-O into ingest (append-only invariant). `packages/knowledge-graph` | M | B |
| MEM-08 | MEM | MED | No incremental Leiden / global GraphRAG on hot path | Leiden only in unwired sleep pass | `update-index`/affected-community recompute + map-reduce search at answer time. `packages/knowledge-graph`+sleep-pass | L | D |
| MEM-10 | MEM | MED | Corpus chunking markdown-H2-only; no layout/tables/figures (corpus is PDF-heavy) | `borjie-corpus-ingest.ts:155` `splitByH2` | Layout-aware doc-AI (LayoutLMv3/Donut/Docling); + crawl-frontier + change-only diff. `services/consolidation-worker` | L | C |
| MEM-11 | MEM | MED | Exact-key SHA-256 dedup only; no MinHash/semantic/entity-canonicalization | `borjie-corpus-ingest.ts:232` | MinHash-LSH near-dup + entity canonicalization. `services/consolidation-worker` | M | C |

---

# WAVE B — outbox (money-path) + embodiment-live + capability/skill-synthesis

## B.1 — Money-path durability (at-least-once is aspirational today)

| ID | Dim | Sev | One-line | Evidence | Closure lane | Eff | Seq |
|---|---|---|---|---|---|---|---|
| RSS-01 | RSS | BLOCKER | **[CONFIRMED]** Ledger publisher in-memory; money-path at-least-once not real (InMemoryEventPublisher, no durable dual-write) | `payments-ledger/server.ts:316`; `event-publisher.ts:92-112` (in-process array, post-commit); `IOutboxRepository` unimplemented | Port BN `DurableEventPublisher` (`enqueueToOutbox(events,tx)` co-commit) + factory + Drizzle `IOutboxRepository` against `event_outbox`; swap `server.ts:316`. `services/payments-ledger` | M | B1 |
| RSS-21 | RSS | HIGH | Four-eye approval queue in-memory → pending dual-control approvals lost on restart (SOC2 CC7.2) | `workflow-engine-wiring.ts:223` `createInMemoryApprovalRouter`; no Drizzle variant | Add `createDrizzleApprovalRouter` + Assignment Drizzle repos; swap when db present. `api-gateway/composition` | M | B1 |
| RSS-23 | RSS | MED | Durable Inngest executor opt-in + no worker deployed → wake/monitor lost on restart | `inngest-executor.ts:23`; no k8s worker | Deploy Inngest worker (or PG advisory-lock poller); `DURABLE_EXEC_ENABLED=true` in prod; wire at composition root. `central-intelligence/durable`+k8s | M | B1 |
| EXEC-saga | RSS | HIGH | Sagas + compensating actions on money path not wired (EXECUTION_SPEC) | EXECUTION_SPEC_WAVES23 shared-substrate | Saga + compensation preserving double-entry via `LedgerService.post`. `services/payments-ledger`+`workflow-engine` | L | B1 |

## B.2 — Embodiment-live (the body must know itself, act through one chokepoint, project to surfaces)

| ID | Dim | Sev | One-line | Evidence | Closure lane | Eff | Seq |
|---|---|---|---|---|---|---|---|
| EA-01 | EA | BLOCKER | **[CONFIRMED]** Body self-model never derived; live brain reads static `BRAIN_MODULES` (27 vs 180+) — system-graph not wired into composition root | `system-graph-derivation.ts` never invoked; `brain-kernel-wiring.ts` no `bodySchemaReader`; `kernel.ts:1124` falls back to module-inventory | Register `deriveSystemGraph` as cron + listChanged trigger; persist graph; wire `createBodySchemaReader` as `deps.bodySchemaReader`. `consolidation-worker`+`api-gateway`+`packages/database` | L | B2 |
| EA-04 / AUT-01 | EA/AUT | BLOCKER | **[CONFIRMED]** Unified body-change syscall wired into NO composition root (the "ONE chokepoint" bypassed; genui/dynamic-sections mutate body without meta-rail) | `authorizeBodyChange` no call site outside package; gateway doesn't import `@borjie/mutation-authority` | New `composition/body-change-wiring.ts` binding meta-rail+controller+compose; route portal-genui persist, dynamic-sections reorder, capability draft→live, self-extension through it. `api-gateway`+`mutation-authority` | L | B2 |
| EA-05 | EA | BLOCKER | Cross-surface state bus (blackboard) reaches no surface — decision can't project to 2nd screen | no app subscribes; no gateway slot route; `realtime-adapter` only names `'state-bus'` | `blackboard.hono.ts` (post/read slot, handoff); `SlotDelta` broadcaster on realtime topic; owner-web + both mobiles subscribe (`use-slot`). `api-gateway`+`realtime-adapter`+`blackboard-sota`+3 apps | L | B2 |
| EA-02 | EA | HIGH | `query_body_schema()` / blast-radius tools not exposed to live MD | `body-schema-reader.ts:81,96` exported, gateway grep = 0 | Register `query_body_schema`+`body_blast_radius` as brain tools bound to live `SystemGraphSource` (EA-01). `central-intelligence/tools`+`api-gateway` | M | B2 |
| EA-03 | EA | HIGH | No live health/proprioception on body nodes (no injured-limb detection) | `health.ts` `attachHealth` no real-reading caller; measurement-worker disconnected from system-graph | Emit `HealthReading[]` sink from capability-measurement-worker + OTel/Sentry collector; `attachHealth` during derivation. `capability-measurement-worker`+`observability`+`system-graph` | M | B2 |
| EA-07 | EA | HIGH | Ambient runtime doesn't subscribe estate event streams (no spawn-before-need) | `ambient-listener` STT-only; `proactive-triggers-worker` no event subscriber | Event-stream subscriber consuming `event_outbox`+ledger/licence/FX/KYC; idle-time pre-render via portal-genui → blackboard slot. `proactive-triggers-worker`+`proactive-nudge` | L | B2 |
| EA-09 | EA | MED | Adaptive surface reorder uses static rules, not learned intent (no VoI term) | `tab-need-detector/scoring-matrix.ts` rule-based; `dynamic-sections` static | Learned-signal scorer + VoI/expected-utility/cognitive-cost term fed by `learning-signal-emitter`. `tab-need-detector`+`dynamic-sections`+`cognitive-load.ts` | M | B2 |
| EA-08 | EA | MED | MCP "mount everything" declared but not mounted; no cross-project MCP plane | `mount-registry.ts` unmounted; gateway grep = 0 | Wire `mount-registry` into gateway; expose juniors via progressive-disclosure; feed discovery into system-graph. `packages/mcp`+`mcp-server`+`api-gateway` | L | B2 |
| EA-11 | EA | MED | External-organ action (browser/computer-use) unwired to action loop | `browser-perception` leaf; not a policy-gated actuator | Wire `browser-perception`+Chrome/computer-use MCP as policy-gated, HITL-by-default actuator. `browser-perception`+`api-gateway`+`policy-gate` | M | C |
| EA-10 | EA | HIGH | BossNyumba has actuators but ZERO body-model layer (no parity) | BN `ls packages/` no system-graph/blackboard/mutation | Port `system-graph`, body-change syscall, `checkBodyChangeInviolable`, `blackboard-sota` to BN; cross-project `mirrors` edges. BN `packages/` | XL | D |
| EA-12 | EA | MED | Reversible body-change wiring (shadow→canary→burn-rate-rollback + DGM fitness) not connected to body-change path | substrate shipped, `ui-evolution-worker` promotes nothing through syscall | Chain shadow/canary/auto-rollback into audited body-change executor; sandbox-before-deploy in isolated-vm. `ui-evolution-worker`+`mutation-authority/execution` | XL | D |

## B.3 — Capability / skill synthesis (the head everything lands on + the growth verbs)

| ID | Dim | Sev | One-line | Evidence | Closure lane | Eff | Seq |
|---|---|---|---|---|---|---|---|
| COG-07 / AUT-14 | COG/AUT | HIGH | **Modality arbiter MISSING** — SKILL/WORKFLOW/LOOP/AGENT unreachable; everything collapses to tool_call (THE KEYSTONE) | no `modality-arbiter.ts`; `main-loop.ts` zero workflow/skill/loop refs; Decision ADT 7-variant-ready | Build `kernel/orchestrator/modality-arbiter.ts` (MiniLM router + LLM cascade), 7th `run_modality` Decision, run before `router.call`; wire orphan `loop-runner` as LOOP executor. `central-intelligence/orchestrator`+`loop-runner` | L | B3 |
| COG-01 | COG | BLOCKER | Default live turn bypasses disciplined kernel (Master-Brain single-shot; `kernel.think()` flag-gated; `/brain/turn` runs kernel as pre-flight gate only) | `chat-orchestrator.ts:207-230,193-412`; `brain.hono.ts:776-802` | Promote `kernel.think()` to default answer generator on consequential surfaces; demote single-shot to fast-path; thread persona+junior dispatch inside kernel as tools. `brain-runtime` | XL | B3 |
| RSS-22 / EXEC-rails | RSS/COG | HIGH | **[merged]** Brain hard-stamps confidence=1 / gates=pass on EVERY orchestrator answer → overconfident by construction | `kernel.ts:3602-3614` `translateOrchestratorResponse` | Run real confidence scorer + policy-gate + drift + uncertainty before translation; pass through conformal abstention (`aci.ts`). `central-intelligence`+`conformal-calibration-online` | M | B3 |
| COG-02 | COG | BLOCKER | No deliberate search (LATS/ToT) runs on a real turn | `lats-search.ts`/`search-planner.ts` tested, `main-loop.ts` zero search refs; composer "NEVER ran in production" | Wire `dispatchPlanner` into main-loop hard-edge band; composer ON by default for hard band. `kernel-orchestrator` | L | B3 |
| AUT-03 / COG-08 | AUT/COG | HIGH | **[merged]** Voyager skill-capture loop has no runtime caller (experience→skill never compiles) | `capture-loop.ts:109` referenced only by own index; `compileSkill`/`autoSuggestSkill` no caller | Post-turn/nightly-sleep pass runs `runCaptureLoop`/`compileSkill` on verified trajectories → human-gate → `skill_registry`. `consolidation`+`skill-library` | M | B3 |
| EA-06 / SCALE-toolmaker | EA | HIGH | Runtime tool synthesis (`synthesize_tool`/ToolMaker) does not exist | power-tools dir has no `synthesize-tool.ts`; `voyager-library` 0 src files | Build `power-tools/synthesize-tool.ts` (write→scan→sandbox-test→register) gated by body-change syscall + LlamaFirewall; fill `voyager-library`. `central-intelligence/power-tools`+`skill-library` | L | B3 |
| RSS-17 | RSS | BLOCKER | No architecturally-forced simulate-before-act pre-commit stage (world-model never a forced gate) | world-model/counter-model/critics exist; no `preCommit` in orchestrator | Forced pre-commit lookahead (world-model + MCTS/PRM + constitutional-critic veto) before AUTO action touches reality. `main-loop.ts`+`world-model`+`process-reward-model` | L | B3 |
| AUT-05 / RSS-18 | AUT/RSS | HIGH | **[merged]** `evaluateAutonomyCap` kernel hook unwired + confidence/reversibility-blind; `maxMutationsPerDay`/irreversibility-budget never enforced | `autonomy-governance/index.ts:17,28` "follow-up"; `cap-evaluator.ts:78` cost/mutation only; gateway grep = 0 | Wire kernel hook before four-eye/sovereign; feed conformal confidence + 2-D reversibility×blast-radius; daily-mutation counter → `irreversibilityBudgetExhausted`. `central-intelligence`+`autonomy-governance` | M | B3 |
| RSS-19 | RSS | HIGH | **[CONFIRMED]** Kill-switch default FAILS OPEN on misconfig (contradicts fail-closed rule); reason codes still property/KE | `killswitch.ts:96,129` (`'live'` for unrecognized) | `parseLevel` fail-closed (`halt`) for HIGH-risk; require explicit `live` token; replace property reason codes with mining. `central-intelligence` | S | B3 |
| RSS-20 | RSS | HIGH | Safety probes (defection/alignment-faking/SAE) nightly-only, not inline on AUTO actions | probes exist; `kernel/orchestrator` grep = 0 | Move probes to inline PreToolUse call on AUTO actions, fail-closed via killswitch. `main-loop.ts`+`sae-probe`+`probes/` | M | B3 |
| COG-12 | COG | HIGH | Single-pass answer not verified against environment ground truth | default path one LLM call, no plan-then-verify | Verifier step (LLM-as-Judge over tool results/DB state) on completion; reuse judge port. `brain-runtime` | M | B3 |
| COG-03 | COG | HIGH | Confidence is heuristic `min()` of regex scores; calibrator not in the loop | `confidence.ts:29-93`; `conformal-confidence-gate.ts:10-14` "ZERO live consumers" | Feed kernel `ConfidenceVector` into conformal ACI; consume calibrated alpha inside `uncertainty-policy` thresholds; replace regex groundedness with claim-extractor+NLI. `kernel-confidence`+conformal | L | B3 |
| COG-06 | COG | HIGH | Internal debate dark on production brain (only in executive-brief one-shot) | `runDebate`/`deps.debate` hook exist; wiring grep = 0 on sovereign | Bind `buildDebate()` into `composeSovereign`/`brain-kernel-wiring`; `shouldDebate(req)` default stakes≥high; agreement → uncertainty-policy. `brain-wiring` | M | B3 |
| COG-04 | COG | HIGH | Metacognition/self-monitoring modules orphaned (recursive-HOT, per-thought self-model, autobiography, activation/defection probe, abductive, world-model-tool) | none consumed by kernel/main-loop/composition | Add metacognition step running recursive-HOT+defection+abductive on draft, mix hedged fragment into regen; persist per-thought self-model. `kernel-metacognition` | L | B3 |

---

# WAVE C — domain-depth + media/doc generation

## C.1 — Domain mastery (wire 3 dark agents + replicate the deterministic-engine pattern)

> Mining = 24-domain map (`domain-map-mining-estate.md`): ~11 DEEP+WIRED, 3 DEEP-DARK, ~6 SHALLOW, ~6 NONE. Built-env = 19-domain map (`domain-map-real-estate-built-env.md`): effectively 2/19. Closure = (a) wire dark agents (1 barrel export + 1 `JUNIOR_NAMES` + 1 `executor-registry` + 1 router-prompt line each) and (b) replicate deterministic-engine + LLM-narration + Auditor-gate per missing domain.

| ID | Dim | Sev | One-line | Evidence | Closure lane | Eff | Seq |
|---|---|---|---|---|---|---|---|
| DM-01 | DM | HIGH | 3 deep agents DARK: `structural-civil-agent` (C4/RE-7), `machinery-advisory-agent` (C3), `esg-disclosure-agent` (D3) not in barrel/router/registry | `grep` of each stem in `juniors/index.ts`=0; absent from `JUNIOR_NAMES`/`executor-registry` | Wire all 3 (barrel + `JUNIOR_NAMES` + `executor-registry` + router-prompt line each). `packages/ai-copilot/src/juniors` | S | C1 |
| DM-02 | DM | HIGH | A2 Resource/Reserve estimation SHALLOW (scorer, not CRIRSCO/JORC classifier + CP sign-off) | `geology-agent.ts:59` `jorc_compliant` score, no Modifying-Factors engine | Build Inferred/Indicated/Measured→Probable/Proved classifier + Modifying Factors + named CP sign-off gate (deterministic + LLM-narration). `ai-copilot/juniors` | L | C1 |
| DM-03 | DM | HIGH | A3 Mine planning SHALLOW (no NPV/cutoff/Lerchs-Grossmann/LOM optimizer) | `mine-planner.ts:2,88` (polygon + match-factor) | NPV/cutoff-grade/LOM scheduler engine. `ai-copilot/juniors` | L | C1 |
| DM-04 | DM | HIGH | D6 Security & metal accounting NONE (no gold-room/AMIRA-P754/mass-balance) | grep metal-accounting/gold-room = 0 | Build metal-accounting/reconciliation/chain-of-custody-seal junior (acute theft risk). `ai-copilot/juniors` | L | C1 |
| DM-05 | DM | HIGH | E4 Family-office/succession/dynasty NONE (schema orphaned) | `succession-plans.schema.ts` zero consumers; no Dynasty CEO mode | Family-office/succession junior + Dynasty mode consuming the orphan schema. `ai-copilot/juniors`+`mining-ceo-modes` | L | C1 |
| DM-06 | DM | MED | D4 Closure/rehab/water-balance/decarbonisation SHALLOW/NONE (no IAS 37 provisioning) | grep closure/water/decarbon in juniors = 0 | Closure-provisioning (IAS 37) + water-balance/ARD + SBTi junior. `ai-copilot/juniors` | L | C2 |
| DM-07 | DM | MED | B6 Mineral/asset valuation NONE (no IMVAL/VALMIN/CIMVal DCF/real-options) | no valuation junior | Valuation junior (DCF/real-options). `ai-copilot/juniors`+new advisor pkg | M | C2 |
| DM-08 | DM | MED | E2 Insurance & risk transfer NONE (CAR/EAR/BI/surety/D&O/political-risk) | `risk-modeler.ts` composite-score only | Risk-transfer junior. `ai-copilot/juniors` | M | C2 |
| DM-09 | DM | MED | A6 Value-addition/refining/smelting NONE (LBMA Good Delivery, make-vs-export) | no junior | Beneficiation/refining junior. `ai-copilot/juniors` | M | C2 |
| DM-10 | DM | MED | B2 Trading/hedging book SHALLOW (only inside fx-treasury) | grep standalone trading-book junior = 0 | Standalone QP-risk/provisional-pricing/streaming trading-book junior. `ai-copilot/juniors` | M | C2 |
| DM-11 | DM | MED | E3 Holdings/subsidiaries SHALLOW; E5 pan-African KE/UG/NG rule packs SHALLOW | `org-graph` exists, no holdco junior; TZ-only compliance | Holdco/beneficial-ownership junior + KE/UG/NG rule packs. `ai-copilot/juniors` | M | C2 |
| DM-12 | DM | BLOCKER | Built-env (BossNyumba) RE junior set entirely UNBUILT (deal-sourcing/DD/valuation/leasing/collections/asset-mgr/fund-ops/esg) — 2/19 | BN `ai-copilot/src/` no `juniors/` dir | Replicate mining pattern: build the RE junior set per the 19-domain map. BN+Borjie `ai-copilot/juniors`+new advisor pkgs | XL | C3 |
| DM-13 | DM | HIGH | RE valuation (RICS/IVS), due-diligence/land-tenure, acquisitions advisor packages MISSING | `valuation/land-tenure/portfolio/acquisitions-advisor` not found | Build the missing advisor packages. `packages/*-advisor` | XL | C3 |
| DM-14 | DM | MED | RE architecture (RIBA 0-7), MEP (CIBSE/ASHRAE/BS7671), planning/zoning, property-tax, ethics/registration NONE | per RE matrix rows 6,8,17,18,19 | Stage-gate + building-services + entitlement + IAS-40/IFRS-16 + registration-verification juniors. `ai-copilot/juniors` | XL | C3 |
| DM-15 | DM | MED | RE FM/PropTech, leasing/tenancy/collections, REIT/fund-ops, capital-stack NONE | per RE matrix rows 10,11,12,13 | CMMS/PPM + rent-roll/WALT/arrears + waterfall/REIT-gate + DSCR-underwriting juniors. `ai-copilot/juniors` | XL | C3 |
| DM-16 | DM | MED | Construction delivery (FIDIC/NEC/EVM) SHALLOW; A4 drill&blast, C5 camp-estate, A6 refining gaps | grep FIDIC/EVM minimal | FIDIC claims-clock + EVM/Monte-Carlo + blast-design/fragmentation + camp-estate lease-lifecycle. `ai-copilot/juniors` | L | C2 |

## C.2 — Media generation (today: zero real bytes)

> Folds `media-generation-audit-sota.md` lanes A–E. Verdict 1.5/5: world-class scaffolding, entire last mile unimplemented.

| ID | Dim | Sev | One-line | Evidence | Closure lane | Eff | Seq |
|---|---|---|---|---|---|---|---|
| MG-01 | MG | BLOCKER | Adapters fabricate UTF-8 bytes; no async job/poll; no download (zero real frames) | `sora-adapter.ts:68`, `flux-adapter.ts:67`, `seedance-adapter.ts:63`, `imagen-adapter.ts:68` | Async job lifecycle `submit→poll→download`; real download of provider URLs (Flux `get_result`, Sora `/content`, Veo `files.download`, Seedance task poll); decode Imagen base64. `packages/media-generation/providers` | L | C(media)1 |
| MG-02 | MG | BLOCKER | No storage upload + no DB persistence (`media_artifacts` never written; schema exists) | `0020_media_generation.sql` exists; no insert/upload anywhere | `MediaStorage` port (Supabase Storage); Drizzle schema export + repository inserting sealed artifact under RLS. `media-generation`+`packages/database` | M | C(media)1 |
| MG-03 | MG | BLOCKER | Brain/genui wiring is a dead contract mismatch (`createMediaDispatcher` not exported → always 1×1 PNG) | `image-generator.ts:44-64`; package exports `composeMedia` not `createMediaDispatcher` | Fix contract (export `createMediaDispatcher().generate()` OR rewrite `image-generator.ts` to call `composeMedia`); add `generate_video` brain tool + approval-tier UX. `api-gateway`+`media-generation`+`owner-web` | M | C(media)1 |
| MG-04 | MG | HIGH | Missing flagship models (Veo 3.1, Nano-Banana Pro / Gemini-3-Pro-Image); Sora-2 sunsets 2026-09-24 | adapter set lacks Veo/Nano-Banana | Add Veo 3.1 + Nano-Banana (image + conversational edit, SynthID); Sora sunset migration → Seedance/Veo fallback. `media-generation/providers` | M | C(media)2 |
| MG-05 | MG | HIGH | Safety scanners dark (pass `storage_key` not fetchable URL → moderation never runs) | `_helpers.ts:283`; `nsfw-scanner.ts:65` | Pass post-upload signed URL/base64 to NSFW/deepfake; gate before publish. `media-generation/safety` | M | C(media)2 |
| MG-06 | MG | HIGH | "C2PA" is a JSON sidecar, not valid COSE/X.509 JUMBF (fails any verifier) | `c2pa-embedder.ts:16-19,106-146` | Real COSE/X.509 JUMBF manifest via `c2pa-node`/`c2patool` at `embedder.ts:130`; record SynthID; invoke sharp/ffmpeg for visible watermark. `media-generation/watermark` | M | C(media)2 |
| MG-07 | MG | MED | No GIF/WebP transcode lane | `MediaFormat` has no GIF | ffmpeg palettegen/paletteuse post-step on `short_video`; extend `MediaFormat`/recipes. `media-generation` | S | C(media)2 |
| MG-08 | MG | MED | Only 3 of 9 media-class recipes seeded | `registry.ts` 3 seeds | Author remaining 6 recipes. `media-generation/recipes` | M | C(media)2 |
| MG-09 | MG | LOW | No live-mode integration test asserting non-zero bytes + verifiable C2PA | none | Add `BORJIE_LIVE_MODE` integration test. `media-generation` | S | C(media)2 |

## C.3 — Document generation (today: markdown only; binary path dead-ends)

> Folds `document-generation-audit-sota.md`. Verdict 3.0/5: deep building blocks, last-mile assembly is the gap. Unified pipeline: intent → recipe-author → composeDoc → citation-gate+reconciliation → render-worker → quality-guarantor → WORM+storage → e-sign.

| ID | Dim | Sev | One-line | Evidence | Closure lane | Eff | Seq |
|---|---|---|---|---|---|---|---|
| DOC-01 | DOC | BLOCKER | Binary-render queue has NO worker (`document_render_jobs` queued forever) | `document-render.router.ts:131-185` inserts row, no consumer | Render worker draining queue via `renderer-factory-v2`/`document-studio` ports (Carbone+Typst+Puppeteer in `infra/document-render`). `services/domain-services` or new worker | L | C(doc)1 |
| DOC-02 | DOC | HIGH | "Infinite types" engine `dynamic-recipe-authoring` UNWIRED (no route/composition) | grep `createRecipeAuthor` in services = 0 | Mount on a gateway route; bridge to `document-templates.composeDoc`. `api-gateway`+`dynamic-recipe-authoring` | M | C(doc)1 |
| DOC-03 | DOC | HIGH | `report-engine.renderReport` / `document-templates.composeDoc` have ZERO call sites | grep across services/apps = 0 | Wire one composer of record into the pipeline. `api-gateway` | M | C(doc)1 |
| DOC-04 | DOC | HIGH | Doc libs stripped vs BN (Carbone/docxtemplater/pdfkit/playwright) → forced low-fidelity hand-rolled | 5 doc pkgs declare `zod` only; domain-services keeps some | Restore high-fidelity deps + point `*_URL` envs at `infra/document-render` servers. `packages/{report-engine,document-studio,...}` | M | C(doc)1 |
| DOC-05 | DOC | MED | E-sign/OCR mock-default + unwired (DocuSign/Adobe/HelloSign + eIDAS exist) | `document-ai/index.ts:63` mock default | Bind real e-sign + OCR ports; surface eIDAS tier UX. `api-gateway` composition | M | C(doc)2 |
| DOC-06 | DOC | MED | Closed 11-recipe set + unbound contract placeholders | `document-templates/registry.ts:25`; `contract.ts:52-56` = "—" | Bind contract recipe to `ctx`; widen recipe coverage (or rely on DOC-02 authoring). `document-templates` | M | C(doc)2 |
| DOC-07 | DOC | MED | Quality-guarantor (accessibility/citation/visual-diff) not on live binary path | namespace-wired only; no `processOutput` caller | Call `processOutput` in render-worker after render. `services/domain-services` | M | C(doc)2 |
| DOC-08 | DOC | MED | Strategic-reports engine null-by-default (no composition-root wiring) | `engine-wiring.ts:17` `engine=null`; only `setEngineForTests` | Wire engine at composition root. `api-gateway` | M | C(doc)2 |
| DOC-09 | DOC | LOW | email-templates near-stub (one template) | only `daily-brief.ts` | Add the email-document template set. `packages/email-templates` | S | C(doc)2 |

---

# WAVE D — self-improvement loop + remaining

> "Gets better every night while the mine sleeps." The evaluator is the product. None of the 8 frontier self-improvement mechanisms exist yet; the workers that DO exist aren't deployed.

| ID | Dim | Sev | One-line | Evidence | Closure lane | Eff | Seq |
|---|---|---|---|---|---|---|---|
| AUT-02 | AUT | BLOCKER | Self-extension keystone never scheduled/invoked (capability never grows) | `self-extension.ts:216,328,397` exported, no cron/worker | Scheduled pass wiring `ActivityLogPort`→audit sinks; `detectRecurringGap`→`proposeNewSubMd`→four-eye→`compileAndDeploySubMd`. `services/self-extension-worker`+`k8s` | L | D1 |
| AUT-12 | AUT | HIGH | Self-improvement workers built but NOT DEPLOYED (no Dockerfile/manifest) | ui/doc/capability/proactive-triggers workers no Dockerfile; none in k8s | Add Dockerfiles + k8s CronJobs (reuse api-gateway-image pattern); sequence in sleep window. `services/{ui,doc}-evolution-worker`+`{capability-measurement,proactive-triggers}-worker`+`k8s` | M | D1 |
| AUT-13 / MEM-selfimp | AUT/MEM | MED | `meta-learning-conductor` + `intel-self-improve` + `language-self-improve` + `learning-signal-emitter` + `tacit-knowledge` + `graph-database` orphaned (zero gateway call sites) | grep `@borjie/meta-learning-conductor` in gateway = 0 | Bind at composition root; route junior/intel invocations through `wrapAsMeasured`; schedule `runMetaLearning`. `api-gateway/composition`+packages | M | D1 |
| AUT-06 | AUT | HIGH | No replay→eval→update nightly loop; evaluator/fitness not machine-checkable end-to-end | grep `replay.buffer`/ReasoningBank = nothing; brain-evolution reflects but doesn't replay | (1) replay buffer table fed by decisionLog/Auditor; (2) machine-checkable estate-decision fitness (ledger-balanced, licence-row-correct, evidence non-empty, budget, EN/SW purity, calibration); (3) nightly replay pass in sleep-pass. `sleep-pass-orchestrator`+`loop-quality-gates`+`cognitive-memory` | XL | D2 |
| AUT-04 | AUT | HIGH | No earned/graduated-autonomy engine (N-clean-runs→suggest-AUTO, tripwire auto-demote) | grep cleanRun/tripwire/earnedAuto = nothing; posture set manually | Track-record aggregator keyed on flow_id; `suggestPromotion`; tripwire monitor calls `setPosture('gated')`; reuse slo/canary/auto-rollback. `autonomy-governance/graduation`+`cognitive-memory`+`workflow-engine` | M | D2 |
| ORCH-flowprefs | AUT | MED | flow_autonomy_prefs schema + creation-time confirm + per-flow permission-mode missing | autonomy keyed on tenant_id only; no flow_id row, no creation confirm | `flow_autonomy_prefs(tenant_id, flow_id, posture, risk_ceiling, amount_threshold,…)` + service + migration; creation-time confirm UI; per-flow permission-mode read in main-loop. `packages/database`+`owner-web`+`central-intelligence` | M | D2 |
| AUT-08 | AUT | HIGH | No prompt/pipeline optimization (DSPy/MIPROv2/GEPA/TextGrad); ~50 juniors carry never-optimized prompts | no DSPy/GEPA impl; Auditor verdicts discarded | Wrap juniors as signature-typed modules; GEPA reflective prompt-evolution over replay buffer using Auditor verdict text as gradient; Pareto frontier; gate config swaps via body-change syscall (`prompt-edit`). `ai-copilot/juniors`+new `prompt-evolution`+`brain-evolution-worker` | XL | D3 |
| AUT-07 | AUT | HIGH | No workflow search (AFlow/MCTS); `dynamic-recipe-authoring` unmounted (overlaps DOC-02) | no AFlow impl; package not on any route | AFlow-style MCTS searcher over code-represented workflows; evaluate against AUT-06 fitness; human-gated promotion via body-change syscall. `dynamic-recipe-authoring`+`workflow-engine`+`api-gateway` | XL | D3 |
| AUT-09 | AUT | HIGH | No ADAS Meta-MD (agent designs its own new agents as code) | self-extension composes persona-spec, not code; no archive | Meta-MD pass: code-space junior representation, archive store, sandboxed smoke-test (isolated-vm), human-gate via body-change syscall; port BN `self-codegen`. `central-intelligence/orchestrator`+new `meta-md`+`agent-runtime` | XL | D4 |
| AUT-10 | AUT | MED | No DGM open-ended lineage archive (greedy single-best, not branching) | promotion deciders greedy Δ-threshold | Lineage/archive table (variant config + fitness + parent edge); Pareto sampling; archive-parent rollback into shadow/cutover/auto-rollback. `meta-learning-conductor`+`autonomy-governance`+`packages/database` | L | D4 |
| AUT-11 | AUT | MED | Voyager autotelic curriculum absent (training-scenarios is catalog CRUD, not learning-progress-driven) | scenario gen catalog-driven, sessions human-run | Learning-progress predictor over `learningProgress`; curriculum generator from blind-spots (AUT-06 failure dist); headless sleep-window runs feed skill capture. `skill-library/voyager-library`+`sleep-pass-orchestrator`+`database` | L | D4 |
| AUT-15 | AUT | MED | No sandbox-before-deploy + shadow→canary→archive-rollback on body-change path (overlaps EA-12) | substrate exists, body-change syscall doesn't invoke it | Chain shadow/canary/auto-rollback into audited body-change executor; isolated-vm first. `mutation-authority/execution`+`autonomy-governance`+`ui-evolution-worker` | L | D4 |
| AUT-16 | AUT | LOW | Skill quarantine/decay exists but no versioning/improvement lifecycle | `CodeSkill` has quarantined/failures, no version/parent | Add `version`+`parent_skill_id`; `human_reviewed` promotion path; reuse AUT-08 optimizer to improve a skill from its traces. `skill-library`+`database` | S | D4 |
| COG-05 | COG | MED | recursive-HOT/defection/abductive are pure regex heuristics, not model-backed | `recursive-hot.ts:45-69`, `defection-probe.ts:54-86`, `best-explanation.ts:22` | Optional `judge`-port-backed deep mode (hook foreshadowed `recursive-hot.ts:14`); wire Haiku judge as meta-critic. `kernel-metacognition` | M | D2 |
| COG-09 | COG | MED | PRM/value-fn not grading reasoning steps (PRM only in tool-search) | `process-reward-model` consumed by `mcts-tool-search.ts` only | Wire PRM as LATS `evaluator` + step-verifier in ReAct ticks; train off reasoning-traces. `kernel-search`+learning | L | D2 |
| COG-10 | COG | MED | Stability/self-consistency dead (re-roll always null → stability=1.0) | `kernel.ts:1732` `rerolledOutputText:null` | On stakes≥high/low-confidence, issue temperature-varied re-roll; gate on Jaccard. `kernel-confidence` | S | D2 |
| COG-11 | COG | MED | Uncertainty policy opt-in + stale property lexicon (rent/lease/arrears) | `kernel.ts:1747` default off; `uncertainty-policy.ts:55-96` property vocab | Default `'on'` for consequential surfaces; add mining entity-detector set (royalty/offtake/assay/licence). `kernel-confidence` | S | D2 |
| COG-13 | COG | MED | No plan-repair/replanning node (failures don't trigger early repair) | `main-loop.ts:632-637` retries only; no re-planner; LATS reflections unrouted | Re-planner branch: on tool_error/low-progress load reflexions+LATS reflections and re-plan. `kernel-orchestrator` | M | D2 |
| COG-15 / ORCH-situation | COG | MED | No unified situational self-state / blind-spots model (world-model/goal-tracker/stall-detector disjoint; supervisor types unused) | `kernel-types.ts:171` doc-only "blind spots"; `supervisor/` zero consumers | Build six-facet `SituationalSelfModel` (happened/doing/todo/future/blind-spots/caveats) read first each turn; metacognition flags blind-spots for grounding. `central-intelligence/kernel/awareness` | XL | D2 |
| COG-14 | COG | MED | No hierarchical/HTN decomposition (planning is flat search only) | no HTN/decompose/methodLibrary in kernel | Hierarchical planner: goal→method tree (licence/royalty/offtake methods) + LLM fallback; verify effects vs DB before commit. `kernel-planning` | XL | D4 |
| COG-16 | COG | LOW | Reasoning signals (judge/debate/calibration miscoverage) not fed to a learning loop | land in provenance, nothing trains; GEPA optimizer no live caller | Feed provenance judge scores + conformal miscoverage + debate agreement into GEPA/reasoning-traces on nightly sleep. `learning-loop` | M | D3 |
| EXEC-stream | RSS | MED | Fake-streamed 80-char chunks instead of real provider deltas | EXECUTION_SPEC; `kernel.ts:3739`, `brain.hono.ts:1231` | Forward `messages.stream` tokens through orchestrator router + SSE (AG-UI typed events). `central-intelligence`+`api-gateway` | M | D2 |
| EXEC-synth | RSS | MED | `requireSynthesis` parallel multi-LLM MoA never triggered on high-stakes | EXECUTION_SPEC; `kernel.ts:1230-1292`+synthesizer-wiring | Thread `stakes→requireSynthesis` into `toOrchestratorRequest`. `central-intelligence` | M | D2 |
| EXEC-dag | RSS | MED | VP sub-MD dispatch is flat list, no DAG / durable worker | EXECUTION_SPEC; `brain-dispatch.hono.ts:256` | Add `dependsOn/level` to plan shape; topological-level scheduler (Promise.all per level); durable worker returning 202. `api-gateway`+registry | L | D3 |
| EXEC-hitl | RSS | MED | No HITL interrupt()/approve gates on HIGH-risk prefixes + money in main-loop | EXECUTION_SPEC; `main-loop.ts:905`+policy-gate | Pause-to-checkpoint + resume-via-Command gates on HIGH-risk; arg-based auto-approve low-risk. `central-intelligence` | L | D3 |
| EXEC-budget | RSS | MED | Token-aware budgets (TPM+cost) not enforced across orchestrator+fan-out | EXECUTION_SPEC; `llm-budget-governor`+`brain.hono.ts:461` | Enforce TPM + cost ceilings to kill retry-loops. `llm-budget-governor`+`api-gateway` | M | D2 |

---

## Source ledger (dossiers consolidated)

- AGI gap audit: `gap-cognition-reasoning.md` (COG-01..16), `gap-memory-knowledge.md` (MEM-01..11), `gap-autonomy-selfimprovement.md` (AUT-01..16), `gap-embodiment-action.md` (EA-01..12), `gap-domain-mastery.md` (DM-01..16), `gap-reliability-scale-safety.md` (RSS-01..24), `agi-domain-brain-layer-sota.md` (the scoring bar + eval harness).
- Security/data/media/doc: `sec-architecture-audit-sota.md` (SEC-G1..9), `sec-data-protection-audit-sota.md` (DP-01..12), `media-generation-audit-sota.md` (MG-01..09), `document-generation-audit-sota.md` (DOC-01..09).
- Known lanes/specs: `SCALE_SPEC.md`, `MD_AS_BODY_ARCHITECTURE.md`, `ORCHESTRATION_SPEC.md`, `EXECUTION_SPEC_WAVES23.md`, domain maps (`domain-map-mining-estate.md` 24-domain, `domain-map-real-estate-built-env.md` 19-domain), `borjie-bn-knowledge-infra-audit.md` (KI-01..19).
- Confirmed live gaps from this session merged + tagged **[CONFIRMED]**: dead corpus path (KI-01), graph-rag-router orphan (KI-graphrag), 8 scale P0 caps (RSS-03/04/05/06/08/09/10 + RSS-16 meta-rail), outbox at-least-once money-path (RSS-01), system-graph body-model not wired (EA-01/EA-04), partial domain coverage vs the 24+19 maps (DM-*), live-vs-repo RLS policy drift (KI-rls-drift).

## Eval-harness note (the definition of "done", from `agi-domain-brain-layer-sota.md` §4.5)

A domain-AGI claim is earned only when all eight hold simultaneously: depth across full breadth · target autonomy per task-class · novel within-domain generalization · long reliable horizons · grounded multi-step competence · calibrated metacognition that ACTS · robust+abstaining behavior · no continual-learning regression. Wire the eight-axis harness as a standing regression suite (Wave D tail) — it is what closes the loop on every wave above.

---

## UI / Modality Invariant (owner directive, 2026-06-08) — binds the wiring pass

The MD's surfaces are **infinitely dynamic** and **proposal-gated**. Hard rules for
every modality-arbiter / genui / tab-spawn wiring:

1. **Infinite UI, not a catalog.** No fixed "forecast tab / media tab / document tab"
   kinds. portal-genui *synthesizes* whatever UI the need calls for; forecast/media/
   document are ARTIFACTS that flow into a dynamically-composed surface.
2. **Change only upon reasoned need.** The AI evaluates (tau + evidence + goal) whether
   a UI change is warranted; a plain chat turn proposes no UI change.
3. **User approval gates the mutation.** A proposed UI change never self-applies — it
   surfaces as a proposal (ambient notice + Open/Undo) and mutates only on approval.
   This is the body-change meta-rail applied to the UI surface. Default = propose-and-
   approve; auto-spawn only for a flow the user explicitly set to auto, always reversible.
4. **Chat-customizable.** The proposal is a starting point; the user chats to refine and
   genui re-synthesizes from the amended spec.

Wiring tests MUST prove: (a) no UI change without approval, (b) low-need turn proposes
nothing, (c) chat refinement re-synthesizes, (d) auto-flow spawns ambiently but reversibly,
(e) a routed money/licence action still hits the policy-gate.

---

## Org-Brain Invariants (owner directives, 2026-06-08) — bind all org-brain wiring

### INV-A · Admin/Owner control-plane vs data-plane boundary (HARD data-protection wall)
- admin-web (port 3020) = BORJIE-INTERNAL control plane ONLY: platform ops + metadata
  (tenants-as-accounts, billing, system health, global brain config, corpus, evals,
  kill-switches, announcements). It must NEVER read tenant business data (ledger,
  documents, PII, operational rows). Borjie staff support access is BREAK-GLASS ONLY:
  explicit + consented + time-boxed + audited (hash-chained) + ideally tenant-visible.
- owner-web (port 3010) = the OWNER's data plane + the owner's OWN admin (their org,
  employees, settings). Owner-admin features live HERE, NEVER in admin-web.
- admin-web service-role / RLS-bypass usage MUST be scoped to platform tables; it may
  not freely select tenant-scoped business rows. AUDIT this.

### INV-B · Surfaces are semantic LENSES over the org-graph, intelligently categorized
- A surface (HR/compliance/finance/…) is a lens, not a fixed table. The brain composes
  it by querying the org-graph and CATEGORIZES it by the org's shape + the user's need
  (region/operation/type). Roll-up = full visibility across everything; drill-down = one
  part in its own scope. Categories AUTO-EXPAND/CONTRACT as the org grows/shrinks
  (5 ops -> 10 ops -> 10 sub-views). Gated unless the user set the flow to auto.

### INV-C · Infinite, self-extending nervous system (no cap on nodes/connections)
- No fixed catalog of nodes or connection types. To execute the mandate the brain forms
  and reforms ARBITRARY nodes + edges as context demands. If a needed tool is MISSING,
  the brain CREATES it or COMPOSES several existing tools to meet the need — within the
  bodyChange meta-rail + user approval. Capability is unbounded + self-extending; the
  only limit is the mandate + the inviolable rails (money/licence/deletion stay HITL).

These bind the org-brain architecture + every wiring pass + their tests.

---

## INV-D · The MD Cognitive Kernel (owner directive, 2026-06-08) — the deep logic that governs ALL dynamism

The MD runs a CONTINUOUS, STRUCTURED cognitive cycle in the BACKEND, modelled on a veteran
domain-MD's mind, GENERAL across any situation (never hardcoded per scenario). It is the
meta-controller; self-construction, the closed-loop fabric, the lenses, and tool-synthesis
all hang off it.

  PERCEIVE   — always-on senses over the whole estate (ledger/calendar/corpus/regs/
               production/market/people); IDENTIFY loops/needs/risks/opportunities the
               user has NOT asked about, before anyone asks.
  ORIENT     — recognise the situation-TYPE via expert schemas + playbooks (recognition-
               primed), like a veteran; not a blank-slate think every turn.
  ORGANIZE   — decompose into loops/tasks/decisions; rank by consequence x reversibility;
               decide autonomous-vs-gated; delegate to junior agents/swarms.
  CREATE     — if a tool/flow/organ/surface is missing, make or compose one (INV-C),
               within the bodyChange meta-rail + approval.
  EXECUTE-TO-CLOSURE — drive each loop through every stage to CONFIRMED closure (the
               operational fabric); retry/escalate/follow-through; never stop at "proposes".
  LEARN+REPEAT — reflect, update mental models + memory, continue perpetually.

INVISIBILITY: all of this is backend. The user ONLY chats with the persona (Mr. Mwikila)
as if a real veteran MD is behind a laptop thinking/responding/doing. No blockers within
the mandate; expert on everything in the mandate; super-intelligent but STRUCTURED.
Same kernel for BossNyumba (real-estate-deep). Rails: money/licence/deletion stay HITL.

---

## INV-D (sharpened) · THINK *and* ACT — the kernel is not handicapped
The cognitive kernel is perceive -> orient -> organize -> create -> EXECUTE-to-closure -> learn.
EXECUTE is REAL AGENCY: the MD actually DOES (files-prep, assigns, sends, settles, builds
organs, runs loops, generates), gated by the rails (money/licence/deletion stay HITL) and the
autonomy posture (autonomous where reversible + granted; gated otherwise) — but NEVER
artificially handicapped. A kernel that thinks but cannot act is a failure. Within the
mandate + rails, the MD can do anything and everything.

## INV-E · Organ lifecycle + deletion governance (grounded, gated, archive-first, compliance-safe)
Self-built organs flow draft -> shadow -> canary -> live -> deprecated -> archived. DELETION
is on the inviolable HITL rail — NEVER autonomous. The MD may only PROPOSE retiring an organ
after GROUNDED, evidence-cited reasoning passing the applicable tests:
  - truly a DUPLICATE of a live organ (semantic + functional), OR
  - genuinely NOT-CAPTURED / unreferenced anywhere AND superseded, OR
  - an OLD VERSION fully replaced by a newer live one, OR
  - provably will NEVER be useful again, OR
  - cheaply + deterministically REGENERABLE on demand (delete saves more than it risks).
DEFAULT = ARCHIVE/DEPRECATE (reversible), NOT hard DELETE. Hard delete requires ALL of:
explicit human approval + NO statutory-retention / legal-hold obligation (royalty, licence,
audit-chain, financial, KYC records have retention) + an audit-chain entry + a restorable or
regenerable path. NEVER auto-touch anything with audit/financial/licence/royalty/legal
significance. Failure mode prevented: "compliance issues fast." Same governance both repos.

---

## INV-F · Actual-work SERVICE, not advisory product (the HANDS) — owner directive
Borjie/BN is a SERVICE that DOES THE ACTUAL WORK end-to-end — not a product the user
operates, not an advisor that only proposes/drafts. Mr. Mwikila is an autonomous OPERATOR
that EXECUTES real-world operations to CONFIRMED completion: files (a human signs only the
irreversible step), pays, dispatches, orders, settles, sends, reconciles — through real-world
ACTUATORS: payment rails (M-Pesa/bank/mobile-money), messaging (WhatsApp/SMS), e-gov /
regulatory e-filing, procurement/suppliers, logistics, accounting, assay-lab/refiner/buyer,
e-signature. Advisory (forecast/recommendation) is ONE mode among many; the DEFAULT is DO,
not suggest. Every external action: idempotent + reversible-or-compensable (saga/compensation),
driven to confirmed completion via the closed-loop fabric, within the rails (money/licence/
deletion HITL on the irreversible step) + the autonomy posture (autonomous where granted +
reversible; gated otherwise). The measure of success is WORK DONE, not advice given. We charge
for the service (outcomes/work), not seats. Same service model for BossNyumba.
GAP (honest): the engines built so far produce artifacts/advice; the ACTUATOR + action-
execution layer that performs real-world work end-to-end is the gap that makes us a service.

---

## INV-G · Uncapped + dynamic capability; only dynamic governance, never arbitrary caps — owner directive
Because the system is LLM-driven + dynamic, CAPABILITY is UNCAPPED:
  - DURATION/horizon: uncapped via DURABLE EXECUTION (Temporal/DBOS-class). Long real-world
    operations (months-long ladders, multi-week shipments, 60-day renewals, 24/7 loops) are
    first-class: persisted, survive restart, resume mid-flight, run as long as the real
    process takes. NO "must finish in X" cap.
  - SIZE/scale: uncapped + dynamic. Entities/tabs/surfaces/connections/organs/operations/
    employees/customers all unbounded (schema synthesis + INV-C). 5 or 5,000 — structure scales.
  - REASONING/output: NOT capped by the LLM context window. Big work DECOMPOSES into junior
    swarms + streaming + memory, never one oversized call. The window is an implementation
    detail the kernel routes around, never a capability ceiling.
The ONLY bounds are DYNAMIC GOVERNANCE — cost/budget guards, external-actuator rate-limits,
the rails (HITL on irreversible), anti-wedge safety timeouts. These are REASONED + owner/
brain-configurable per context, exist so infinite capability runs SAFELY, and are NEVER
arbitrary hardcoded capability caps. The cap is the MANDATE + the RAILS, never a magic number.
BUILD DISCIPLINE: any hardcoded magic-number that limits CAPABILITY (not safety) is a bug —
replace with dynamic/reasoned governance. Keep anti-wedge SAFETY timeouts; dynamicize
capability LIMITS. Audit the codebase for such caps during convergence. Same both repos.

---

## INV-F (sharpened) · Sensitive actions = prepare -> review -> permission -> execute-OR-handoff
For any SENSITIVE / irreversible action (payment, disbursement, procurement/ordering, licence
or regulatory FILING, deletion, contract/e-signature — i.e. anything on the money / licence /
four-eye / sovereign rail), the MD follows the human-as-signature pattern (feels like a
competent human assistant, not a bot):
  1. PREPARE — fully autonomous: gather, compute, draft the filing/payment/order, validate vs
     rules, assemble the COMPLETE ready-to-execute package + evidence.
  2. REVIEW + PERMISSION — surface the prepared package and EXPLICITLY ask: "prepared and
     ready; shall I execute it, or will you?" The UI mutation/proposal is gated (INV-B/UI rail).
  3. EXECUTE *or* HANDOFF — owner's choice:
       (a) "you do it" -> MD executes via the actuator, captures receipt, reconciles, closes
           the loop, confirms done; OR
       (b) "I'll do it" -> MD hands over the prepared package AND still TRACKS it to confirmed
           closure (watches for the receipt, reconciles, closes).
The MD NEVER executes a sensitive action without explicit permission. Reversible + granted
actions run autonomously (INV-F default DO); sensitive actions run prepare-then-ask. The owner
can always take the wheel for the final click — the MD did the labor either way. Same both repos.

---

## INV-H · Chat-first but NOT simple — the main conversational surface is SOTA — owner directive
CHAT-FIRST: conversation with the persona (Mr. Mwikila) is the primary surface. But the MAIN
product chat (owner-web cockpit, workforce/buyer mobile) is NOT a bare text box — it is a RICH,
SOTA conversational WORKSPACE:
  - the MD's WORK is visible (thinking/planning/doing surfaced with reasoning + evidence, like
    watching a colleague work — transparency = trust);
  - GENERATIVE UI renders INLINE (forecast = live chart, document = editable preview, lens =
    interactive roll-up/drill-down) — live UI, not links;
  - surfaces SPAWN from chat (ambient "you left chat, here are the tabs") — chat is the front
    door to the whole OS (chat-first navigation);
  - MULTIMODAL (voice realtime, vision/upload, text) — one natural conversation;
  - AGENTIC affordances inline (approve / refine / take-the-wheel; drill to evidence; the
    prepare->ask->execute-or-handoff pattern lives in chat);
  - PERSONA + MEMORY (remembers, personalizes, surfaces proactively — a person, not a prompt).
Only the MARKETING surfaces use a simple chat. Bar: ChatGPT-Canvas + Claude-Artifacts +
Cursor/Devin agent-progress + generative-UI workspace + voice persona, fused into the cockpit.
All inline UI honours INV-B (lenses) + the UI invariant (reasoned-need, proposal-gated,
reversible, chat-refinable). Same both repos.

---

## INV-I · SOTA analytical intelligence — the MD is a world-class data scientist (owner directive)
Data analysis, visualization, and forecasting are ALL SOTA. The MD answers any analytical
question about the estate with rigour: descriptive -> diagnostic (WHY) -> predictive
(calibrated forecast-engine) -> prescriptive (what to do), + causal inference, cohort/
segmentation, anomaly detection, statistical guardrails against spurious findings, and
AUTOMATED insight generation (surfaces insights unprompted via the standing-drives / Motivational
Subsystem). Visualizations are beautiful AND correct: right-chart-for-the-question, perceptually
sound, interactive, rendered INLINE in chat (INV-H) as live lenses (INV-B). Same both repos.

## INV-J · Lossless total capture + total recall + complete observability (owner directive)
The system NEVER loses a conversation thread or a piece of data at any moment. Every
interaction, document, transaction, signal/sensor reading, decision, and event is captured
DURABLY (event-sourced, no-drop-on-crash via the transactional outbox + durable execution),
RETAINED (per compliance; archive-first INV-E; protected per data-protection/PII/KMS), and
RETRIEVABLE. The MD ALWAYS KNOWS everything it can possibly know — complete situational
awareness (the resident Current Situational Model from the Mind research), complete lineage/
provenance, total-recall memory, retrieval-of-anything (GraphRAG + semantic + org-graph).
Maximal capture + retention + retrieval + awareness; NO accidental loss, ever. Deliberate,
gated, grounded organ-deletion (INV-E) is SEPARATE from never losing DATA. Same both repos.

---

## INV-H (amplified) · The Visual OS discipline + the blackboard as shared-state spine — owner directive
The main chat (INV-H) adopts the VISUAL OS discipline (from Visual_OS_Engineering_Spec.docx):
  - DEFAULT TO THE RICHEST OUTPUT — visual/interactive/file inline; PROSE IS THE FALLBACK, not
    the default. The MD produces visuals/widgets/files, it does not describe them.
  - 7-layer pipeline: intent-classify (5 dims) -> skill/module load -> VISUAL ROUTING decision
    tree (a sub-layer of the modality-arbiter: SVG flowchart/structural/illustrative, HTML
    chart/mockup/interactive, React+API app, file) -> SVG/HTML ENGINEERING RIGOR (viewBox,
    CSS-vars + auto light/dark, arrow markers, collision/L-bend routing, clickability) ->
    COMPOSITION (interleave prose+visual, scale complexity, promise==deliver, multiple focused
    diagrams) -> memory/continuity.
  - RECURSIVE FEEDBACK LOOP: clickable node -> follow-up turn -> re-render (= bidirectional
    shared state); artifacts can spawn sub-agents (our juniors, not Claude-in-Claude).
THE BLACKBOARD (packages/blackboard-sota: slots/handoff/control/posts/regions + blackboard-intel
+ packages/chat-ui/blackboard) is the SHARED-STATE SPINE that unifies: (a) the Face "two views
of one state" (chat + surfaces render the slots), (b) the Mind resident Current Situational Model
(the persistent situational state), (c) multi-agent/juniors coordination (handoff/control/posts).
ADAPTATION: the spec's Claude.ai primitives (/mnt/skills, visualize:read_me, present_files,
window.storage, sendPrompt, Anthropic-API-in-artifacts, userMemories/conversation_search) map to
our SELF-HOSTED stack (portal-genui/GenUIWidgetRenderer, document-studio/media-engine,
owner-tabs-store/blackboard, genui host-actions, our juniors, memory-v2). Keystone: wire the
blackboard as the one shared-state spine + adopt the Visual OS render discipline in genui. Both repos.

---

## INV-K · One unified design system to Chrome-level — same styling all the way to artifacts (owner directive)
EVERY render in the product — chat, tabs, lenses, the generated ARTIFACTS (SVG diagrams, HTML
widgets, charts, mockups, interactive apps), documents, media — follows ONE Borjie design system
(the design-system package tokens + components), polished to "Chrome level" so the product FEELS
LIKE ONE PLATFORM end-to-end. NO render looks foreign / generic / Claude.ai-default. The Visual OS
render discipline (INV-H) binds to OUR design tokens (typography/color light+dark/spacing/radius/
motion), consistent from the conversation to the deepest artifact and into document/media output.
BossNyumba uses its own brand within the SAME system. Amplify usage, design-style, flow, and
intelligence to SOTA. NO render is an exception; theming flows through portal-genui/GenUIWidgetRenderer,
document-studio, and media-engine alike.

## DRIVE-TO-ZERO mandate (standing execution discipline)
Drive EVERYTHING to zero: 0 TODOs, nothing deferred, no tech debt, no bugs, no unwired stubs
(NOT_YET_WIRED), no missing UI, no missing logic, no incomplete logic, no skipped/failing tests,
no type-suppressions hiding holes. FULL CLEAN, full-speed, both repos. Every wave lands green +
verified + committed; nothing left as a spec; the only permanent gates are the inviolable rails.

---

## INV-H / INV-D (sharpened) · Background cognition is IP — show STATUS + OUTPUTS, never internals (owner directive)
The MD's actual thinking and work — reasoning, chain-of-thought, tool-calls, agent swarms,
internal orchestration, prompts, the cognitive architecture — happen in the BACKGROUND and are
NEVER exposed to the user. This is core IP (the moat). The user sees ONLY:
  (1) high-level STATUS — "thinking…", "analyzing…", "preparing your royalty payment…",
      in-progress, ETA/progress — a polished professional "I'm on it", NOT an internal monologue;
  (2) the OUTPUTS (results / artifacts / proposals) + their EVIDENCE/citations (the SOURCES that
      ground the result, for trust — NOT the internal reasoning process).
This RE-SCOPES the Face research's "visible work / agentic transparency" to STATUS-LEVEL progress
only. Trust = polished status + grounded outputs + evidence; NOT exposed cognition.
ENGINEERING CONSEQUENCE (hard): the response/SSE pipeline must carry only status frames + final
output + evidence — it must NEVER leak chain-of-thought, prompts, internal tool-calls, or swarm
mechanics to the client (no reasoning in the stream, logs the user can read, or API responses).
Borjie-internal admin-web MAY see more for ops/debug (gated, audited); the OWNER never sees
internals. Same both repos. Audit the brain SSE/response path for any internal-reasoning leak.
