# Artifact Richness — SOTA snapshot 2026-05-29

Owner: Borjie cognitive infra wave.  
Driver: every Mr. Mwikila-facing artifact (drafts, briefs, reports,
journals, exports, statements, scan-cards) must equal or exceed the
2026 bar set by Claude Code, Notion, Linear, Manus, v0 and
shadcn/ui block libraries.

This document is the brief that drives
`Docs/AUDIT/ARTIFACT_RICHNESS_GREEN_2026-05-29.md` and the inline
implementation that lands alongside it.

---

## 1. SOTA reference points

### 1.1 Claude Code / Claude artifacts (Anthropic, May 2026)

- **Artifacts catalogue**: plain text, full Markdown (headers,
  tables, code, blockquotes, task lists, links, images),
  syntax-highlighted code in 30+ languages, full HTML + CSS + JS,
  SVG, **Mermaid diagrams**, React components.
- **Downloadable formats**: `.docx`, `.pptx`, `.xlsx`, `.pdf`.
- **Live Artifacts** (April 2026): dashboards / trackers refresh
  with current data each time they reopen.
- **Citations API** (GA Jan 2025, table-stakes by 2026): Claude
  cites claims back to source passages; recall accuracy +15%
  vs. prompt-based citing; citation deltas stream like thinking.

Implication for Borjie:
- Drafter renderers MUST embed mermaid + KaTeX so every claim that
  cites a formula or process renders as a real diagram, not ascii.
- Every artifact must carry **inline citation chips** that survive
  the MD -> PDF/DOCX/PPTX round-trip.
- The Daily Brief and Owner Brief must be **Live Artifacts** — open
  on demand and refresh from `cockpit-events` cache.

### 1.2 Notion AI (May 2026)

- **AI blocks pull cross-page context** automatically (mentions,
  relations, synced blocks). Context window 50 pages, 1-hop
  resolution.
- **Voice input** for AI prompts on every desktop surface.
- **Workers** = hosted programmable runtime — anyone can ship code
  that extends Notion AI; CLI deploy + secure sandbox.

Implication for Borjie:
- Inline blocks must **resolve cross-references** at render time
  (decision -> opportunity -> contract -> settlement). Already
  partial via `cross-reference-discovery` service — every artifact
  surface must show those edges as chips.

### 1.3 Linear (Mar 2026 redesign + Agents)

- **Triage Intelligence** identifies similar issues and links
  related work; pattern detection from issue history.
- **March 2026 visual refresh**: calmer, scannable, less clutter.
- **Mobile agent support** — coding agent sessions monitored on
  the go.
- Rich Markdown descriptions, custom fields, priority levels,
  labels, assignees on every issue.

Implication for Borjie:
- Opportunity / Risk scan cards must surface **similar prior
  findings** ("you saw this in W17 — outcome: $3.2M recovered")
  via the decision journal cross-ref already shipped.

### 1.4 Manus AI

- Cloud VM running real tools (FS, terminal, VS Code, Chromium).
- Plans, executes, delivers without further input for
  well-defined tasks.
- Extended context for long-horizon work.

Implication for Borjie:
- Plan-DAG visualisations (A-7) must show **executable nodes** —
  click to drill into the underlying VM-equivalent (in our case,
  the brain tool that runs).

### 1.5 v0 / shadcn-ui blocks

- 6,000+ production-ready blocks, 46 categories.
- Multi-page application scaffolds.
- Components are accessible Radix primitives, TS-typed,
  responsive, ARIA-compliant by default.

Implication for Borjie:
- `apps/owner-web/src/components/artifacts/*` must use the same
  shadcn primitives the cockpit already uses (Card, Badge,
  Separator, Tabs, ScrollArea, Table).
- All artifact cards keyboard-focusable, ARIA-labelled, dark-mode
  respecting, print-friendly.

### 1.6 Mermaid.js v11.x (May 2026)

- New shapes: datastore, hexagon column-spanning.
- Sequence-diagram autonumber decimals.
- CJK + emoji + accented Latin in unquoted labels.
- New `look: handDrawn` for informal / draft mode.
- `layout: elk` for flowcharts + state diagrams.

Implication for Borjie:
- Server-side render mermaid -> SVG so PDF / DOCX embed the same
  image. Use `@mermaid-js/mermaid-cli` only if local; otherwise
  embed the source mermaid block and render in the client.
- For artifacts shipped to regulators, prefer `look: classic`;
  for blackboards in chat, `look: handDrawn`.

### 1.7 KaTeX vs MathJax

- **KaTeX** wins for our case: synchronous server-side render,
  deterministic HTML+MathML output, ships as plain HTML in any
  PDF/DOCX/HTML renderer; 10x faster than MathJax 2; on par with
  MathJax 3 for the LaTeX subset we use (royalty formulas, ore
  recovery, NPV).
- KaTeX has narrower LaTeX coverage but the formulas Borjie emits
  (royalty %, recovery %, NPV, IRR, CAPM, simple integrals) fit
  comfortably inside the supported subset.

Implication for Borjie:
- Adopt KaTeX in the renderer pipeline. Source-of-truth math
  blocks live inside markdown as `$...$` (inline) or `$$...$$`
  (display); the renderer rewrites them to inline HTML+MathML so
  the PDF / DOCX / HTML / PPTX all render identically.

### 1.8 Vega-Lite

- Declarative JSON, inline rendering in multi-agent systems.
- Database-blog showcases agent-generated charts on call.

Implication for Borjie:
- The opportunity / risk scan reports + cockpit KPI cards may
  optionally emit a Vega-Lite JSON spec inline. The renderer
  rewrites it to a static SVG (via `vega -> svg`) for non-
  interactive artifacts (PDF / DOCX) and embeds the JSON for
  interactive surfaces (HTML / owner-web).
- We don't ship vega today; we add a thin lazy importer that
  degrades to an mermaid-friendly textual chart description when
  vega is unavailable in the runtime (mirrors the playwright
  fallback already used in `pdf-renderer.ts`).

---

## 2. Borjie artifact taxonomy

We codify the 12 artifact families that flow out of the brain
through the cockpit and into the hands of operators, regulators
and counterparties. Each entry is a *contract* between the
producer (a service or worker) and the consumer (UI / file
download / regulator portal).

| # | Family | Producer | Surfaces |
|---|--------|----------|----------|
| A-1 | Universal document draft | `document-drafter` | MD/PDF/DOCX/PPTX/HTML |
| A-2 | Owner brief / daily brief | `owner-brief` + `cockpit-events` | Web card + email + PDF |
| A-3 | Opportunity + risk scan | `opportunity-scanner`, `risk-scanner` | Cockpit card + CSV + PDF |
| A-4 | Decision-journal entry | `decision-journal` | Cockpit timeline + PDF |
| A-5 | Inspection narrative | `inspection-narrative` | PDF + DOCX (regulator) |
| A-6 | Compliance export | `regulator` + migration 0122 | PDF + JSON (regulator portal) |
| A-7 | Plan-DAG visualisation | `cognitive-engine` plan emit | Mermaid SVG + JSON |
| A-8 | Blackboard outputs | `blackboard-viz` | PNG/SVG/PDF + chat embed |
| A-9 | Settlement + payslip | `payroll` + `settlement` | PDF (branded) + email |
| A-10 | Buyer-facing RFB / KYC / bid | `buyer-marketplace-advisor` | Web card + PDF |
| A-11 | Cockpit live KPI cards | `cockpit-events` | Web card (live) |
| A-12 | Audit chain receipt | `audit-hash-chain` | PDF + JSON |

Each family lands in
`Docs/AUDIT/ARTIFACT_RICHNESS_GREEN_2026-05-29.md` with a verdict
(GREEN / GAPS-FIXED) and the SHA(s) that closed it.

---

## 3. Cross-cutting richness contract

Every Borjie artifact must satisfy ALL of the following:

1. **Rich markdown source** — headings, lists, tables, callouts,
   code blocks, mermaid blocks, math blocks. The MD is the
   source-of-truth that the 5 renderers consume.
2. **Branded layout** — Borjie wordmark + tenant trading name in
   the header; classification badge (Public / Internal /
   Confidential); audit-hash tail + ISO timestamp in the footer;
   bilingual disclaimer.
3. **Inline citations** — every claim cites at least one
   `evidence_id`. Citations render as chips
   (`(1) (2) (3)`) in MD/HTML and as a footnotes section
   in PDF/DOCX; the receipt PDF (A-12) chains them on the audit
   ledger.
4. **Multi-format integrity** — the same body renders to the same
   visual hierarchy in MD/HTML/PDF/DOCX/PPTX. Mermaid -> SVG and
   KaTeX -> MathML are pre-rendered server-side so every format
   sees the same artwork.
5. **Bilingual sw/en** — the source-of-truth carries both
   languages; the renderer picks one. No hard-coded language.
6. **A11y + print** — `aria-labels`, focusable controls, dark-mode
   safe, print-friendly CSS in HTML.
7. **Versioning + audit trail** — every render emits a row in
   `artifact_renders` (table proposed via migration if missing).
   The hash chains forward through `audit_hash_chain`.
8. **Empty + loading + failure** — every UI surface has
   skeleton, empty-copy and retry CTA. No crash on missing
   field; the renderer no-ops gracefully and emits a console
   warning via Pino (not console.log).

---

## 4. Implementation surface

New shared package surface (no breaking changes):

| Module | File | Purpose |
|--------|------|---------|
| Mermaid renderer | `services/api-gateway/src/services/artifact-richness/mermaid.ts` | Parse fenced ` ```mermaid ` blocks, emit `<svg>` (lazy import `@mermaid-js/mermaid-cli`); fallback to `<pre>` of the source |
| KaTeX renderer | `services/api-gateway/src/services/artifact-richness/katex.ts` | Parse `$...$` and `$$...$$`, emit HTML + MathML via lazy `katex` import; fallback inline-code |
| Citation embedder | `services/api-gateway/src/services/artifact-richness/citations.ts` | Walk MD AST, collect `[^1]`-style refs + claim chips, emit a footnotes section + a JSON sidecar |
| Branded layout | `services/api-gateway/src/services/artifact-richness/branded-layout.ts` | Bring tenant logo + classification + audit tail into a single header/footer factory; consumed by all renderers |
| TOC generator | `services/api-gateway/src/services/artifact-richness/toc.ts` | Walk heading depth, emit ordered list + anchors for long drafts |
| Empty-state copy | `services/api-gateway/src/services/artifact-richness/empty-states.ts` | Bilingual fallback strings for missing-data cells |
| Index | `services/api-gateway/src/services/artifact-richness/index.ts` | Public surface |

All modules are dependency-light: lazy `import()` for mermaid /
katex / vega; fail-soft to plain text. Drafter renderers consume
them through small adapters added to `renderers/markdown-to-html.ts`.

The `inline-blocks-registry.ts` extension is OPTIONAL — when the
shared rich-block schemas already cover the new richness, we keep
the contract surface unchanged.

---

## 5. Hard rules that survive

- No `console.log` anywhere in services — Pino with
  `logger.warn({...})` for soft failures.
- No `@ts-ignore` / `@ts-nocheck`.
- No mutation; immutable patterns only.
- Bilingual sw/en parity preserved.
- Multi-format consistency: MD == HTML == PDF == DOCX == PPTX
  visual fidelity inside the constraints of each format.
- C2PA-signing path on inspection narratives + receipts left
  untouched.

---

## 6. Out of scope this wave

- Interactive embeds inside DOCX (we keep SVG static).
- Hand-drawn mermaid `look: handDrawn` (we ship classic; can flip
  later via a single config).
- Vega interactivity inside PDF (always static SVG in PDF).

---

## Sources

- Anthropic: Citations API blog + docs
- Anthropic: Claude Artifacts docs (April 2026)
- MindStudio: Mermaid in Claude Code skills
- Notion releases May 13 + Jan 20, 2026
- Linear: changelog (Mar 2026 redesign), AI agent intro
- BigGo News: KaTeX vs MathJax 2026 comparison
- katex.org
- mermaid.js.org + mermaid-js/mermaid releases (v11.15.0)
- vega.github.io/vega-lite (multi-agent inline rendering)
- Vercel v0 docs + 2026 reviews
- shadcn-ui blocks documentation
