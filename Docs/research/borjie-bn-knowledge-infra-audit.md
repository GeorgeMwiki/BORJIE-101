# Knowledge-Infrastructure Audit — Borjie vs BossNyumba vs the Infinite-Knowledge Target

**Date:** 2026-06-08
**Auditor:** Knowledge-infra deep audit (evidence-based, read-only)
**Repos:**
- Borjie — `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Borjie`
- BossNyumba (parent fork) — `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101`

---

## TL;DR verdict

The knowledge **plumbing is real and mostly wired** — there is a genuine
acquisition→organize→verify→retrieve spine (corpus ingest, OCR ingest,
knowledge-graph grower, pgvector ANN retrieval, deep-research orchestrator,
regulator feeds). **But the pipe is dry at both ends and broken in the middle:**

1. **Acquisition is dead.** The global corpus ingest CLI points at a deleted
   external path AND reads the wrong env var, so **zero** ground-truth knowledge
   ever lands in `intelligence_corpus_chunks`. The corpus content was vendored
   into the repo but the ingest path was never repointed at it.
2. **The upsert is structurally impossible.** Both ingest writers
   (`ON CONFLICT (source_file, section)`) require a unique index that Borjie
   **lost during the property→mining fork** — BN still has it (migration 0285),
   Borjie does not. Every conflict-path write throws.
3. **Retrieval has a column-name regression.** Borjie's chat ANN query selects
   `chunk_text`, a column that does not exist (the column is `text`). The query
   throws and silently degrades to keyword ILIKE — semantic search is dark even
   when embeddings exist. BN's equivalent query uses the correct column.
4. **The knowledge graph is still real-estate.** The live KG is wired with
   `realEstateOntology` (property/tenant/lease entities) inside a *mining*
   product — a migration leftover.

Net effect: the brain retrieves from an **empty, mis-typed knowledge store**.
Every junior's "evidence-required" contract (CLAUDE.md hard rule) is satisfied
only by tenant-uploaded OCR docs *if* the OCR path's own upsert weren't also
blocked by the missing unique index.

Severity scale: BLOCKER > HIGH > MED > LOW.
Verdict: REAL (works) · PARTIAL (works with caveats) · DEAD (built, never runs) ·
MISSING (target feature absent) · ORPHAN (built, never imported).

---

## 1. Global corpus ingest (acquisition) — `borjie-corpus-ingest` / `borjie-corpus-cli`

### KI-01 — Dead default corpus path: zero global knowledge ingests · **BLOCKER · DEAD**
**Area:** `services/consolidation-worker/src/tasks/borjie-corpus-cli.ts:31-39`
**Evidence:**
```ts
const DEFAULT_DOCS_ROOT =
  process.env.BORJIE_DOCS_ROOT ??
  '/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Claude Projects/Boji project/Docs';
const DEFAULT_CORPUS_ROOTS = [join(DEFAULT_DOCS_ROOT, 'primary_sources'), join(DEFAULT_DOCS_ROOT, 'research'), ...];
```
`ls` of that path → `No such file or directory`. The entire `Boji project`
directory is gone; only `LITFIN PROJECT` remains under `Claude Projects/`.
`walkMarkdown()` absorbs the ENOENT into `errors[]` and returns `[]`, so the
job reports `filesScanned: 0` and exits 0 — a **silent** no-op.
**Gap:** the prior audit's "dead path → zero knowledge" is CONFIRMED. The
corpus was actually vendored into the repo (29 `.md` files under
`Docs/_BOJI_PROJECT_INTAKE_2026_05_27/Docs/` incl. `BOJI_AI_SPEC.md`,
`primary_sources/`, `research/`) but the CLI default was never repointed.
**Fix:** repoint `DEFAULT_DOCS_ROOT` at the in-repo intake corpus (or a
deploy-mounted volume), and make the job FAIL LOUD (non-zero exit) when
`filesScanned === 0`, so a dead path can never masquerade as success again.

### KI-02 — Env-var mismatch: docs say `BORJIE_MINING_CORPUS_PATH`, code reads `BORJIE_DOCS_ROOT` · **BLOCKER · DEAD**
**Area:** `borjie-corpus-cli.ts:32` (and `borjie-corpus-cli-direct.ts:22`)
**Evidence:** code reads `process.env.BORJIE_DOCS_ROOT`; but `CLAUDE.md:30`,
`Docs/CORPUS_LOCATION.md:9-13`, `Docs/RUNBOOKS/corpus-citations-empty.md:73`,
and `Docs/research/AGENTIC_SOTA_COMPARISON.md:517` all document the env var as
`BORJIE_MINING_CORPUS_PATH`. `grep` confirms `BORJIE_MINING_CORPUS_PATH` is
referenced in **8 docs and 0 source files**.
**Gap:** even an operator who follows the runbook exactly
(`export BORJIE_MINING_CORPUS_PATH=...`) gets ignored — the override silently
does nothing and the dead default (KI-01) is used.
**Fix:** read `process.env.BORJIE_MINING_CORPUS_PATH` (keep `BORJIE_DOCS_ROOT`
as a deprecated alias for one release). This is a one-line change with
disproportionate impact.

### KI-03 — Corpus ingest is never invoked at boot or by any cron · **HIGH · DEAD**
**Area:** `services/consolidation-worker/src/index.ts` (no corpus reference)
**Evidence:** `grep "corpus|ingestCorpus|first-boot"` in the worker entrypoint
returns nothing. The worker schedules only the OCR poll
(`index.ts:640-660`), the consolidation orchestrator (`:727`), and the ledger
attestor (`:776`). `borjie-corpus-cli` is a **manual-only** CLI; there is no
`corpus` npm script in `services/consolidation-worker/package.json`.
**Gap:** CLAUDE.md describes a "first-boot ingestion job" that every tenant
inherits — but nothing fires it on boot or on a schedule. Even with KI-01/02
fixed, knowledge would only land if a human ran the CLI by hand.
**Fix:** add a once-per-deploy first-boot guard (idempotent on a
`corpus_ingest_runs` marker) in the consolidation-worker bootstrap, or a CI/CD
post-deploy step that runs the CLI against the mounted corpus.

### KI-04 — Embedder model/dimension doc-vs-reality drift · **LOW · PARTIAL**
**Area:** `packages/database/src/schemas/intelligence-corpus.schema.ts:16` vs
`borjie-corpus-adapters.ts:21-22`, `services/api-gateway/src/services/brain-ingestion/embedder.ts:1-3`
**Evidence:** schema comment claims `vector(1024)` = "Cohere embed-v3
multilingual"; every actual writer uses OpenAI `text-embedding-3-large` with
`dimensions: 1024`. `grep` finds **no Cohere embedder** anywhere in source
(only stale comments). All three writers (corpus-cli, brain-ingestion,
ocr-extraction) agree on OpenAI@1024, so vectors ARE mutually comparable.
**Gap:** purely a misleading comment, but it has already misled the retrieval
code (see KI-05's "Cohere-shaped column" comment). No functional break today.
**Fix:** correct the schema/retrieval comments to "OpenAI text-embedding-3-large
@ 1024-d (matryoshka-truncated)". Decide one canonical embedder of record.

---

## 2. Upsert / dedupe identity — the conflict target

### KI-05 — `ON CONFLICT (source_file, section)` has no matching unique index — Borjie LOST it in the fork · **BLOCKER · PARTIAL**
**Area:**
- Corpus writer: `borjie-corpus-adapters.ts:114-124` (`onConflictDoUpdate target: [sourceFile, section]`)
- OCR writer: `services/consolidation-worker/src/tasks/ocr-extraction-task.ts:768-773` (`ON CONFLICT (source_file, section) DO UPDATE`)
- Schema *declares* it: `intelligence-corpus.schema.ts:84-86` `uniqueIndex('intelligence_corpus_chunks_source_section_uniq')`
- But **no migration creates it**: the only index in `packages/database/drizzle/0003_mining_domain.sql:965` is the **non-unique** `intelligence_corpus_chunks_source_section_idx`. `grep` across all `src/migrations/*.sql` + `drizzle/*.sql` finds **no** `source_section_uniq` / `UNIQUE (source_file, section)`.
**Cross-repo proof:** BossNyumba (the parent) ships
`packages/database/src/migrations/0285_intelligence_corpus_chunks.sql:58`:
`CREATE UNIQUE INDEX IF NOT EXISTS intelligence_corpus_chunks_source_section_uniq`.
Borjie's `0003` was the property-era baseline and the unique-index promotion was
never carried across the migration.
**Gap:** Postgres rejects `ON CONFLICT` without a matching arbiter constraint:
`there is no unique or exclusion constraint matching the ON CONFLICT
specification`. So **every conflict-path write throws** — the corpus re-ingest
and the OCR tenant-doc ingest both fail at the upsert. (First-ever insert of a
brand-new key succeeds because no conflict fires; re-ingest/idempotency does not.)
**Fix:** add a forward migration creating `intelligence_corpus_chunks_source_section_uniq`
as UNIQUE (drop the non-unique twin), porting BN's 0285 logic. See KI-06 for the NULL caveat.

### KI-06 — `section` is nullable → unique upsert silently won't dedupe · **MED · PARTIAL**
**Area:** `intelligence-corpus.schema.ts:59` (`section: text('section')` — nullable),
`borjie-corpus-ingest.ts:155-183` (emits real H2 headings + `__preamble__`)
**Evidence:** Postgres treats `NULL` as distinct in a unique index, so two
chunks with `section IS NULL` and the same `source_file` both insert (no
conflict) → duplicates. OCR chunking may emit null sections.
**Gap:** even after KI-05 is fixed, NULL-section rows escape dedupe and the
idempotency contract (`borjie-corpus-ingest.ts:22-26`) is violated for them.
**Fix:** either `NOT NULL DEFAULT ''` on `section`, or use a unique index on
`(source_file, COALESCE(section,''))` / a generated column. Match whatever BN's
0285 chose.

---

## 3. Retrieval (organize → verify → retrieve into the brain)

### KI-07 — Chat ANN query selects a non-existent column `chunk_text` (Borjie-only regression) · **HIGH · PARTIAL**
**Area:** `services/api-gateway/src/routes/mining/chat-corpus-evidence.ts:270-287`
**Evidence:**
```sql
SELECT id, source_file, section, chunk_text, url FROM intelligence_corpus_chunks ...
```
The column is `text` (schema `:61`, migration `0003:955`); there is no
`chunk_text` column on this table (`chunk_text` only exists on a *different*
table in `0305`). The row mapper hedges `row.chunk_text ?? row.text` (`:284`)
but the SELECT itself names the missing column, so Postgres throws
`column "chunk_text" does not exist`. `annSearch` catches it (`:288-294`) and
returns `[]`, so `searchCorpusTopK` falls to the ILIKE keyword path (`:251`).
**Cross-repo proof:** BN's equivalent (`research-adapters.ts:309`) selects
`COALESCE(text, '') AS text` — correct. This is a Borjie-introduced break.
**Gap:** pgvector semantic retrieval is **never actually exercised** in chat —
the brain silently runs on keyword ILIKE, which is far worse for a multilingual
(en/sw) corpus and defeats the whole embedding pipeline.
**Fix:** `SELECT id, source_file, section, text, url`. Add an integration test
that asserts the ANN branch returns rows (catches the silent-degradation trap).

### KI-08 — Distance operator `<->` (L2) vs index opclass `vector_cosine_ops` mismatch · **MED · PARTIAL**
**Area:** `chat-corpus-evidence.ts:275` (`ORDER BY embedding <-> $vec`),
indexes `0012_corpus_embedding_index.sql:23` (`hnsw ... vector_cosine_ops`) and
`0003:972` (`ivfflat ... vector_cosine_ops`). BN shares this:
`research-adapters.ts:311,315` also uses `<->`.
**Evidence:** `<->` is L2/Euclidean distance; the HNSW/IVFFlat indexes are built
with `vector_cosine_ops` (cosine). pgvector will **not use the index** for a
`<->` ORDER BY when the index opclass is cosine — it falls back to a sequential
scan, and the ranking is by the wrong metric.
**Gap:** even once KI-07 is fixed, ANN is slow (seq scan) and semantically
mis-ranked. Affects both repos.
**Fix:** use `<=>` (cosine distance) to match `vector_cosine_ops`, OR rebuild
the index with `vector_l2_ops`. Pick one metric end-to-end (embed → index → query).

### KI-09 — Brain DOES inject corpus + graph evidence into prompts (the good news) · **REAL**
**Area:** `services/api-gateway/src/routes/mining/chat-orchestrator.ts:144-161`
**Evidence:** the orchestrator pulls top-K corpus chunks, PII-tokenises the
text, injects it into the Master Brain + junior synthesizer prompts to GROUND
generation, and expands `kg_nodes/kg_edges` to add connected corpus chunks as
extra evidence reusing precomputed embeddings. `graph-rag-expand.ts:91-97` uses
a real `createPostgresKgStore(args.db)` (not in-memory) and `expandFromSeed`.
**Gap:** none in the wiring itself — but it retrieves from an empty/broken store
(KI-01..KI-08), so in practice it grounds on nothing or on ILIKE noise.
**Fix:** none here; fixing acquisition + KI-05/07 makes this path light up.

---

## 4. Knowledge graph (`packages/knowledge-graph` + `graph-rag-router` + `org-graph`)

### KI-10 — Live knowledge graph wired with REAL-ESTATE ontology in a MINING product · **HIGH · PARTIAL**
**Area:** `services/api-gateway/src/composition/ported-domain-wiring.ts:49,107`
(`ontology: realEstateOntology`), ontology def
`packages/knowledge-graph/src/ontology/real-estate.ts:369` ("the BORJIE domain
ontology" but its entity types are property/tenant/lease).
**Evidence:** `index.ts` headline example literally asks "Which tenants in Karen
are 2+ months in arrears?". `realEstateOntology` is the ONLY ontology exported
(`ontology/index.ts`); no `miningOntology` exists. It is passed into the live
`createKnowledgeGraph` call.
**Gap:** the KG entity/relation typing, community detection, and GraphRAG
answers reason over property concepts, not licences/minerals/royalty/assays.
A migration leftover that quietly mis-types the brain's structured memory.
**Fix:** author a `miningOntology` (licence, mineral, deposit, buyer, royalty,
shipment, assay, jurisdiction…) and swap it in `ported-domain-wiring.ts:107`.

### KI-11 — Two parallel graph stacks: `@borjie/knowledge-graph` (wired) vs `@borjie/graph-rag-router` (near-orphan) · **MED · ORPHAN**
**Area:** `packages/knowledge-graph/` (consumed by 6 api-gateway files) vs
`packages/graph-rag-router/` (consumed only by
`services/sleep-pass-orchestrator/src/passes/graph-rag-community-summaries.ts`
and `packages/database/src/schemas/index.ts`).
**Evidence:** `grep` for `graph-rag-router` importers outside its own package
returns just those two. It ships a full hierarchical-retrieval substrate
(entity/relation extractors, community detector, query classifier, hybrid
retriever — `index.ts` per `GRAPH_RAG_ROUTER_SPEC.md`) that no request path
reaches. `org-graph` (projector/traverse) is similarly only referenced by
ported-domain wiring.
**Gap:** the "founder-flagged P0" GraphRAG router is built but the runtime uses
the simpler `knowledge-graph.expandFromSeed`. Duplicated investment; the more
capable stack is dark.
**Fix:** decide one graph stack of record. Either route chat retrieval through
`graph-rag-router`'s hybrid retriever/router, or formally retire it and fold its
community-summary value into the wired path.

---

## 5. Document ingest (document-ai / document-analysis / OCR)

### KI-12 — `@borjie/document-analysis` is an orphan (never imported by api-gateway) · **MED · ORPHAN**
**Area:** `packages/document-analysis/` (ingest/extract/ocr/orchestrator/resolve)
**Evidence:** `grep "@borjie/document-analysis"` across `services/api-gateway/src/`
returns nothing. The package has a real ingest stage (`ingest.ts`: sha256 dedupe,
canonical `documents` row, `ingested` event) but no gateway consumer.
**Gap:** the richer document pipeline (layout, extract, resolve, orchestrator)
is bypassed in favour of the consolidation-worker OCR task (KI-13).
**Fix:** either route owner/tenant uploads through `document-analysis` (its
orchestrator is the cleaner abstraction), or retire it if the OCR task is the
intended single path.

### KI-13 — OCR ingest path IS wired and writes tenant chunks (the real working ingest) · **REAL** (blocked only by KI-05)
**Area:** `services/consolidation-worker/src/tasks/ocr-extraction-task.ts:561,752-773`,
scheduled at `services/consolidation-worker/src/index.ts:658` (poll loop),
producer `services/api-gateway/src/routes/owner/docs.hono.ts:250` sets
`ingestionStatus: 'queued'`.
**Evidence:** owner upload → `document_uploads` row `queued` → OCR poll picks it
up → chunk → embed (OpenAI 1024-d) → INSERT into `intelligence_corpus_chunks`
with the document's `tenant_id` (never NULL). This is a genuine
acquisition→organize→retrieve loop for **tenant** docs.
**Gap:** its INSERT uses the same `ON CONFLICT (source_file, section)` (`:768`)
that KI-05 shows has no unique index → re-ingest throws. Also a tenant-bleed
risk: the conflict key omits `tenant_id`, and `DO UPDATE SET tenant_id =
EXCLUDED.tenant_id` (`:771`) would flip ownership if two tenants share a
(source_file, section). KI-05's fix should make the unique index
`(tenant_id, source_file, section)` for tenant rows.
**Fix:** ship KI-05's unique index; include `tenant_id` in the conflict key.

### KI-14 — Brain-ingestion ("Company-Brain C-1") pipeline has no route/consumer · **MED · ORPHAN**
**Area:** `services/api-gateway/src/services/brain-ingestion/` (chunker, embedder,
parser, summarizer, persistence, `ingest`)
**Evidence:** `index.ts` exports `ingest` + `IngestionDeps`, but `grep` for
importers in `routes/` + `composition/` finds none — only sibling services
(`knowledge-graph/grower.ts`, `brain-recall/recall-tester.ts`,
`ingestion-intent-inferrer/types.ts`) reference its *types*. No route calls
`ingest()`. Likewise the KG `grower.ts` ("after a doc lands… UPSERT entity_index")
is wired to no route.
**Gap:** a second, cleaner document→corpus→entity-graph pipeline exists but is
unreachable; the live path is the consolidation-worker OCR task instead. The KG
grower (the "organize" step that turns chunks into entities) never runs in prod.
**Fix:** wire `brain-ingestion.ingest` + `grower` into the upload route (or the
OCR task), so uploads also grow the entity graph — closing the
acquire→**organize**→retrieve loop for structured memory.

---

## 6. Deep research (`packages/research-tools` + `services/research-orchestrator`)

### KI-15 — research-orchestrator IS wired into the gateway (improved since prior audits) · **REAL**
**Area:** `services/api-gateway/src/composition/research/research-wiring.ts:1-90`
**Evidence:** `buildResearchWiring()` constructs `ModeRunDeps` from live
`getDb()`, real SQL repos (`createSql*Repository`), DB-backed fail-closed audit
emitter, brain-LLM plan/synthesize seam, and a populated tool registry; the
orchestrator attaches `services.researchEngine` and mounts `/api/v1/research`.
The "deep research built but unreachable" gap is **closed** for reactive query
+ deep-dive.
**Gap:** none for on-demand research. (Borjie is AHEAD of BN here — see KI-19.)

### KI-16 — Real regulator-feed adapter is built but NOT registered in the research tool registry · **HIGH · ORPHAN**
**Area:** `packages/research-tools/src/adapters/regulator-feed-adapter.ts` (real
Tumemadini/NEMC/TRA/BoT/GePG RSS+scrape, `tz_official` source class) vs the wired
registry `services/api-gateway/src/composition/research/research-adapters.ts:148-303`
which registers only Tavily, Brave, GDELT, and a `corpus-query` adapter.
**Evidence:** `grep "regulator-feed"` across `services/api-gateway/src/` returns
nothing. The adapter is the closest thing the system has to a regulatory-change
sensor and it is never invoked.
**Gap:** the product's domain edge — official TZ mining regulators — is built
and then left out of the one pipeline that could surface regulatory diffs.
**Fix:** register `createRegulatorFeedAdapter()` in the research tool registry
and map it to an `anticipatory_sweep` / `continuous_watch` step.

### KI-17 — No standing regulatory-change sensor; research crons aren't scheduled in the gateway · **HIGH · MISSING**
**Area:** `research-wiring.ts` (no cron), `services/api-gateway/src/index.ts`
(no `runDailyBriefing`/`runContinuousWatch` schedule); crons live only in the
standalone `services/research-orchestrator/src/index.ts:3` (daily-briefing +
continuous-watch sweep, default PORT 4011).
**Evidence:** `grep "runContinuousWatch|runDailyBriefing|cron"` in the gateway
composition/index returns nothing. There is no "watch the gazette and ingest the
diff into the corpus" loop anywhere; `research_watches` exist but nothing in the
deployed gateway sweeps them. There is no `RegulatoryChange` event type, no
`gazette` watcher writing back into `intelligence_corpus_chunks`.
**Gap:** "infinite knowledge" requires a *standing* acquisition loop that detects
regulatory change and re-ingests. Today knowledge is a one-shot (broken) import,
not a self-refreshing stream. The continuous-watch capability exists only if the
separate research-orchestrator service is deployed AND its findings are not
written back into the corpus.
**Fix:** (a) deploy/schedule the research-orchestrator crons (or port them into
the gateway), (b) wire KI-16's regulator feed into continuous-watch, (c) add a
write-back sink so verified regulatory diffs append to `intelligence_corpus_chunks`
(tenant_id NULL) — closing acquire→verify→**re-ingest**.

---

## 7. Cross-repo comparison (Borjie vs BossNyumba)

### KI-18 — BN has the unique-index migration Borjie lost · **(diagnostic — see KI-05)**
**Evidence:** BN `0285_intelligence_corpus_chunks.sql:58` creates
`intelligence_corpus_chunks_source_section_uniq` UNIQUE; header notes "Ported
from Borjie 0003_mining_domain" — but Borjie's own 0003 only has the *non-unique*
index. The fork copied the table but the unique-index promotion diverged.
**Fix:** port BN 0285's unique-index logic back into a new Borjie migration.

### KI-19 — Borjie is ahead of BN on deep research; BN has `file-ingest` Borjie lacks · **LOW · diagnostic**
**Evidence:** BN has **no** `research-orchestrator` service and **no** research
package (`ls services|grep research` / `ls packages|grep research` → none),
whereas Borjie has both wired (KI-15). Conversely BN ships
`packages/file-ingest` and `packages/database/src/schemas/corpus-doc-uploads.schema.ts`
(a dedicated upload schema) that Borjie does not. Both share the **same
defects**: dead default corpus path (BN's `BossNyumba project/Docs` also
`No such file or directory`) and the `<->`/cosine operator mismatch (KI-08).
**Note:** BN does NOT share Borjie's `chunk_text` regression (KI-07) or the
env-var mismatch (KI-02 — BN's `BOSSNYUMBA_REAL_ESTATE_CORPUS_PATH` matches its
docs). These two are Borjie-specific.
**Fix:** when porting fixes, treat KI-01 (path), KI-08 (operator) as
*both-repo*; KI-02/KI-05/KI-07 as *Borjie-priority*; consider porting BN's
`file-ingest` into Borjie if a richer upload path is wanted.

---

## 8. The flow, end to end (does knowledge FLOW acquire→organize→verify→retrieve?)

| Stage | Mechanism | Status | Blocking finding |
|---|---|---|---|
| **Acquire (global)** | `borjie-corpus-cli` → `intelligence_corpus_chunks` | **DEAD** | KI-01 path, KI-02 env, KI-03 no trigger |
| **Acquire (tenant)** | owner upload → OCR poll → chunks | **REAL but blocked** | KI-05 upsert, KI-13 |
| **Acquire (web/news)** | research-orchestrator Tavily/Brave/GDELT | **REAL** | KI-15 (regulator feed orphaned KI-16) |
| **Acquire (regulatory)** | regulator-feed-adapter | **ORPHAN** | KI-16, KI-17 (no standing sensor) |
| **Organize (vectors)** | OpenAI 1024-d embeddings | **REAL** | KI-04 doc drift only |
| **Organize (graph)** | KG grower → entity_index | **ORPHAN** | KI-14 (not wired), KI-10 (wrong ontology) |
| **Verify** | research synthesizer audit-hash; evidence-required juniors | **REAL** | depends on non-empty corpus |
| **Retrieve (vector)** | chat ANN pgvector | **PARTIAL/broken** | KI-07 column, KI-08 operator |
| **Retrieve (keyword)** | ILIKE fallback | **REAL** | the only path that actually runs today |
| **Retrieve (graph)** | postgres-kg-store + expandFromSeed | **REAL** | empty/mis-typed store |
| **Inject into brain** | chat-orchestrator grounds prompts | **REAL** | KI-09 |

**Verdict:** the spine is built and largely connected, but acquisition is dead
(KI-01/02/03), the dedupe identity is impossible (KI-05), and the primary
semantic-retrieval path is silently broken (KI-07/08). The brain currently runs
on an empty corpus served by keyword fallback over a real-estate-typed graph.

---

## 9. Prioritised fix order (highest leverage first)

1. **KI-02 + KI-01** (one-liner each) — read `BORJIE_MINING_CORPUS_PATH`, repoint
   default at the in-repo intake corpus, fail-loud on 0 files. *Unblocks all of acquisition.*
2. **KI-05 (+KI-06)** — forward migration: UNIQUE on `(tenant_id, source_file,
   COALESCE(section,''))`. *Unblocks both ingest writers' idempotency + closes tenant-bleed.*
3. **KI-07** — `chunk_text` → `text` in the ANN SELECT (+ integration test). *Turns semantic search on.*
4. **KI-08** — `<->` → `<=>` (or rebuild index l2). *Makes ANN use the index + rank by cosine.* (both repos)
5. **KI-03 + KI-17** — schedule the global ingest + a standing regulatory continuous-watch with corpus write-back. *Makes knowledge self-refreshing.*
6. **KI-16** — register the regulator-feed adapter. *Lights up the domain edge.*
7. **KI-10** — author + wire `miningOntology`. *Stops the graph reasoning over property concepts.*
8. **KI-14 / KI-11 / KI-12** — consolidate the duplicate ingest + graph stacks to one path of record.

---

## Appendix — files inspected (absolute paths)

- `services/consolidation-worker/src/tasks/borjie-corpus-cli.ts`, `borjie-corpus-ingest.ts`, `borjie-corpus-adapters.ts`, `ocr-extraction-task.ts`, `index.ts`
- `services/api-gateway/src/routes/mining/chat-corpus-evidence.ts`, `chat-orchestrator.ts`, `graph-rag-expand.ts`
- `services/api-gateway/src/composition/research/research-wiring.ts`, `research-adapters.ts`
- `services/api-gateway/src/composition/knowledge-graph/postgres-kg-store.ts`; `ported-domain-wiring.ts`
- `services/api-gateway/src/services/brain-ingestion/*`, `knowledge-graph/grower.ts`, `jurisdiction-discovery/service.ts`
- `services/api-gateway/src/routes/owner/docs.hono.ts`
- `packages/database/src/schemas/intelligence-corpus.schema.ts`; `drizzle/0003_mining_domain.sql`, `drizzle/0012_corpus_embedding_index.sql`
- `packages/knowledge-graph/src/index.ts`, `ontology/real-estate.ts`; `packages/graph-rag-router/src/index.ts`
- `packages/research-tools/src/adapters/regulator-feed-adapter.ts`
- BN: `services/consolidation-worker/src/tasks/bossnyumba-corpus-cli.ts`, `bossnyumba-corpus-adapters.ts`; `packages/database/src/migrations/0285_intelligence_corpus_chunks.sql`; `services/api-gateway/src/composition/research/research-adapters.ts`
