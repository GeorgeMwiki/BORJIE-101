# Company Brain — SOTA snapshot 2026-05-29

**Author:** Borjie research team
**Audience:** founder, brain working group, LLM coding assistants
**Scope:** what the world's best "company brain" products do well as of
2026-05-29, and where Borjie's differentiation sits.

The question this doc answers: when a Tanzanian mining-estate owner
adopts Borjie, what should they expect their "company brain" to feel
like, relative to the best non-mining alternatives the market ships
today? The answer: parity on lossless capture + recall, **and** an
extra moat on chain-of-custody, bilingual (sw/en), and regulator-grade
evidence.

---

## 1. The shortlist (and what each does well)

### 1.1 Notion AI Q&A across workspaces
- Surface: a chat box that semantically searches every page, database
  row, and inline DB the workspace owns.
- Strength: retrieval over **structured-and-unstructured mix**. A query
  like "what did we decide about Q1 royalty rate?" can pull the doc,
  the meeting note, AND the DB row that names the rate.
- Weakness: no ingest from outside Notion — you have to live in Notion
  to feed it. No first-class audio, photo, or scanned PDF ingest.

### 1.2 Glean (enterprise search across SaaS apps)
- Surface: federated search across 100+ SaaS connectors (GDrive,
  Slack, Jira, Salesforce, etc.) with semantic ranking.
- Strength: **breadth of connectors**. Glean's value prop is "search
  across everything you already paid for."
- Weakness: regulated industries — Glean has no chain-of-custody
  primitive. Documents are indexed, not signed. No bilingual support
  for African languages. Mining-specific entities (mineral, assay,
  drill-hole, royalty) are foreign.

### 1.3 Hebbia (agentic document intelligence for asset management)
- Surface: upload a folder of PDFs (10-Ks, prospectuses, market
  research) → ask agentic questions that span tables, footnotes, and
  body text.
- Strength: **deep extraction from messy PDFs** including tables. The
  agentic loop ("compute average royalty across these 14 contracts")
  is genuinely impressive.
- Weakness: built for finance — no operational entities (sites,
  workers, equipment). Output is reports, not actions. Single-language
  (English).

### 1.4 Mem (personal AI knowledge graph)
- Surface: capture notes → Mem builds a knowledge graph of
  people-places-projects automatically; suggests connections.
- Strength: **passive linkage**. You don't tag — the graph builds
  itself.
- Weakness: personal, not multi-tenant. No governance / audit. No
  enterprise security.

### 1.5 Personal.ai
- Surface: a "personal AI" that you train on your own writing/voice;
  optimized for memoir-style continuity.
- Strength: **voice / tone fidelity** to the individual.
- Weakness: single-user. Not a company brain.

### 1.6 Anthropic Claude memory + project context
- Surface: Claude Projects let you attach docs to a chat thread; the
  model reasons across them. Claude memory (2026) lets the model
  carry user-specific facts across sessions.
- Strength: **the model itself**. Claude's reasoning is unparalleled
  on long context (200k tokens of mixed prose + tables + code).
- Weakness: not a database. Memory is opaque, not auditable. Projects
  are per-user, not per-tenant. No operational integrations.

### 1.7 Microsoft Copilot for organizations
- Surface: Copilot indexes M365 (SharePoint, OneDrive, Teams, Outlook)
  → answers grounded in company content.
- Strength: **distribution**. Every M365 customer already has the
  data; Copilot is a feature switch.
- Weakness: locked to the Microsoft graph. Bilingual support is
  English-first; Swahili is afterthought. No mining-domain entities.
  No regulatory chain-of-custody.

---

## 2. The consensus pattern across SOTA

All seven products converge on the same five primitives:

| Primitive | Notion | Glean | Hebbia | Mem | Personal.ai | Claude | Copilot |
|---|---|---|---|---|---|---|---|
| Lossless ingest (any format) | partial | yes | yes (PDF) | partial | partial | yes | yes |
| Embeddings + vector recall | yes | yes | yes | yes | yes | yes | yes |
| Entity index / KG | partial | partial | partial | yes | n/a | partial | partial |
| Agentic recall (multi-hop) | partial | partial | yes | partial | partial | yes | yes |
| Audit trail / regulator-grade | no | no | no | no | no | no | partial |

**No major product ships regulator-grade chain-of-custody.** That's
the gap Borjie fills.

---

## 3. Borjie's differentiation

### 3.1 Mining-domain native
- Entity index already understands `drill_hole`, `assay`, `royalty`,
  `offtake_contract`, `mining_task`, `licence`. Glean would call all
  of these "documents."
- Brain tools (50+) span operations, not just retrieval — "draft a
  royalty return for May" works, where Hebbia stops at "summarize the
  royalty contract."

### 3.2 Bilingual sw/en, first-class
- Every memory pattern, persona prompt, and summary digest is rendered
  in BOTH Swahili and English. Copilot ships an English-first product
  with translation layers; Borjie is bilingual from the column.

### 3.3 Tanzania regulatory ground-truth
- `intelligence_corpus_chunks` ships pre-loaded with TZ mining
  regulations, NEMC EIA templates, BoT export rules, BRELA renewal
  procedures. Every owner gets this on day one. Copilot/Glean/Notion
  have no Tanzania content.

### 3.4 Chain-of-custody native (append-only audit chain)
- Every brain decision lands in `ai_decisions` with a hash-chained
  audit. The CLAUDE.md hard rule says **append-only, never mutate**.
  This is a hard differentiator for regulator-facing operations.
- No SOTA product offers an append-only memory layer with a
  cryptographic hash chain.

### 3.5 Day-1 super-powered (this is the C-5 promise)
- Upload a CSV of past sales → in seconds the brain catalogs every
  buyer, computes revenue, spots the top buyer, drafts a receivables
  letter, surfaces a re-engagement opportunity.
- Notion needs you to first write the doc. Glean needs you to first
  connect the SaaS. Hebbia needs a curated folder. Borjie needs a
  CSV and a tap.

### 3.6 Never-lose guarantee (documented in `Docs/OPS/MEMORY_DURABILITY.md`)
- `intelligence_corpus_chunks`, `entity_index`,
  `entity_cross_references`, `ai_decisions`, `corpus_doc_uploads`,
  `corpus_doc_summaries`: zero `DELETE` policies, zero `UPDATE`
  policies on the audit columns, no TTL.
- Borjie's promise: "the data you fed yesterday is still here a year
  from now, byte-for-byte, with the same chunk_id and the same
  embedding."

---

## 4. What we adopted from the SOTA shortlist

| Borjie feature | Inspired by | Adapted how |
|---|---|---|
| Lossless multi-format ingest endpoint | Hebbia + Copilot | We accept CSV/XLSX/PDF/photo/audio/text/JSON in one endpoint; Copilot needs separate ingest paths per modality. |
| Bilingual summary digest per upload | none — Borjie original | sw + en + bilingual md, generated synchronously after embed. |
| Knowledge-graph growth on ingest | Mem | We auto-create `entity_cross_references` from new chunks via the same NER pipeline that powers `entity_index`. |
| Owner brain-dump UI (drag-drop + paste + voice) | Notion + Personal.ai | Single page; multi-modality; instant per-file progress; CTA "ask Mr. Mwikila about this." |
| Day-1 super-powered card | none — Borjie original | After the first ingestion, the onboarding-jumpstart service synthesizes 5 insights and pins them to the brain home. |
| Memory durability promise | none in market | Documented in `Docs/OPS/MEMORY_DURABILITY.md` + regression-tested. |

---

## 5. Open questions (next research pass)

- **OCR fidelity on handwritten Swahili field-notebooks.** Tesseract
  works for typed; what's SOTA for handwritten sw? (Candidates:
  Google Vision API w/ language hint, AWS Textract, fine-tuned
  TrOCR.)
- **Voice STT for sw + en code-switching.** Whisper-large-v3 handles
  it well on clean audio; mining-site audio is noisy. Look at
  Deepgram Nova-3 with bilingual hints.
- **Knowledge-graph viz density.** d3-force vs react-flow vs cytoscape
  — what scales to 5k entities without overwhelming an owner?
- **Memory cost at scale.** A tenant with 10k uploads
  × 100 chunks × 1024-dim vector = ~4GB embeddings per tenant. At
  N=1000 tenants we're storing 4TB. Acceptable on managed Postgres,
  but plan for partitioned tables by 2027.

---

## 6. Bottom line

Borjie is not racing Notion or Glean on **breadth of connectors** —
we'll never beat them on Slack integrations. We win on **depth in the
mining vertical**: bilingual, regulator-grade, chain-of-custody,
day-1-super-powered, and a memory durability promise no consumer SaaS
makes.
