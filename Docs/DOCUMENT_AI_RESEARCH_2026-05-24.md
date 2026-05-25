# Document AI Research — 2026-05-24

Research basis for `@borjie/document-ai`, the amplification layer
on top of `@borjie/document-studio`. Captures the 2026 landscape
for OCR, chat-with-doc, multi-doc reasoning, schema-guided extraction,
multilingual translation (TZ/KE/UG focus), e-signature, accessibility,
and adjacent areas.

This document drives the adapter choices in `packages/document-ai/src/`.
Every adapter ships as a port + factory so we can swap providers as
their pricing, accuracy, and compliance posture shift.

---

## 1. OCR — text + layout + handwriting

The OCR stack in 2026 has bifurcated into three lanes:

1. **Local-first engines** for cost-sensitive bulk work
2. **Vision-language-model OCR** for messy / handwritten / multilingual
3. **Hosted "document AI" services** that bundle OCR + layout + form
   extraction in one API

Our adapters cover all three lanes.

| Engine | Lane | Best for | License | Notes |
|---|---|---|---|---|
| Tesseract 5.4 | Local | Bulk PDFs, English/Swahili print | Apache 2.0 | Ships ~140 LangData packs; `swa` is solid for Swahili print |
| Surya 2.x | Local | Layout + handwriting | GPL 3 (commercial via Datalab) | Strong on tables, complex layouts |
| Donut (NAVER) | Local | OCR-free document understanding | MIT | Encoder-decoder vision model; no separate OCR pass |
| LayoutLMv3 (Microsoft) | Local | Layout-aware form parsing | MIT (research) | Best when you have labelled forms |
| Llama-OCR 2 (Together AI) | Hosted | Cheap fallback | Apache 2.0 | Wraps Llama 3.2 Vision + structured output |
| Microsoft Markitdown | Local | PDF → Markdown conversion | MIT | Released Dec 2024; not as accurate as Marker but free |
| Marker (Datalab / VikParuchuri) | Hybrid | Academic PDFs, multi-column | GPL 3 (commercial via Datalab) | The 2025/26 leader for dense PDFs |
| Docling (IBM) | Hybrid | Tables, scientific, multilingual | Apache 2.0 | Best open-source pipeline as of Q1 2026 |
| Anthropic Vision (Claude) | Hosted | Handwriting, low-quality scans | Commercial | Best zero-shot quality; 3.2x cost of Tesseract+GPU |
| Azure Document Intelligence | Hosted | Structured forms, receipts | Commercial | Best vendor SLA in EU; eIDAS-ready logging |

### Decisions

- Ship **5 adapters** in v0.1: Tesseract (local default), Anthropic
  Vision (handwriting), Docling (REST), Marker (REST), Mock (tests).
- LayoutLMv3 / Donut / Surya are deferred to v0.2 — they're best
  driven through Docling rather than direct.
- Llama-OCR is interesting for cost reduction but Anthropic Vision is
  better quality and the Tanzanian Anthropic pricing card (announced
  May 2026) makes it competitive.

---

## 2. Form extraction

Schema-guided extraction is the bottleneck for property management
flows (lease parsing, bank statement audits, receipt verification,
KYC).

| Provider | Strength | Cost | Notes |
|---|---|---|---|
| Azure Document Intelligence | Pre-built models for receipts, invoices, IDs | $1.50 / 1k pages | Best built-in receipt model |
| AWS Textract | Tables + queries | $1.50 / 1k pages | "Queries" feature lets you ask "what is the rent?" |
| Google Document AI | OCR + form parser + custom processors | $1.50 / 1k pages | Custom processor training requires labels |
| Reducto (YC W24) | Tables + complex layouts | $4 / 1k pages | Highest accuracy on financial PDFs |
| LlamaParse Premium (LlamaIndex) | Multi-modal parsing + JSON-mode | $3 / 1k pages | Best when you also need RAG |
| Anthropic Citations + custom prompt | DIY schema-guided | model cost only | Gives spans + answer; what we built |
| Mindee | Receipts / invoices | $40 / 1k receipts | Specialist, ages-out to general LLMs |
| Veryfi | Receipts | $0.08 per receipt | OCR + categorisation built-in |
| Klippa | EU receipts | €0.05 per receipt | Strong for VAT compliance |

### Decisions

- Build a Zod-schema-guided extractor that runs **heuristic baseline +
  brain fill-in**. This is provider-agnostic, free at the baseline
  level, and lets callers plug a hosted provider when they need
  higher accuracy on complex forms.
- Pre-ship **6 schemas**: lease agreement, bank statement, ID card,
  receipt, invoice, utility bill — covers ~85% of the inputs the
  property management workflows actually see.

---

## 3. Chat with document + multi-doc reasoning

| Pattern | Best for | Reference |
|---|---|---|
| Naive RAG (chunk + retrieve + answer) | Single doc Q&A | Original RAG paper |
| Anthropic Citations API | Spans + grounding | https://claude.com/blog/introducing-citations-api |
| GraphRAG (Microsoft Research) | Multi-doc reasoning, summary-of-summaries | https://github.com/microsoft/graphrag |
| Long-context (1M+) | Multi-doc when total < ctx budget | Claude 4.7 1M context, Gemini 2 Flash 2M |
| RAG-Fusion / RAG 2.0 | Re-rank with multiple queries | Forrest Brazeal, Pinecone |
| Late-chunking + ColBERT | Higher recall on tables | Jina AI ColBERT v2 |

### Decisions

- For single-doc: BM25-based chunk retrieval with optional embedder
  re-rank. Brain is called with the top-k chunks; citation markers
  follow Anthropic's span format so callers can highlight the source.
- For multi-doc: per-doc top-k → global budget cap → brain. We track
  per-doc contribution and a `crossDocSynthesis` flag so the UI can
  show users when the answer actually spans documents (e.g. "lease A
  says $X but lease B says $Y").
- GraphRAG and long-context paths are explicit follow-ups in v0.2.

---

## 4. Multilingual — TZ/KE/UG/NG focus

The reality of property management documents in the Borjie target
markets:

- Tanzania: Swahili dominant; English for contracts; Arabic on the
  coast and in Zanzibar; some legacy German in archival deeds.
- Kenya: English for contracts; Swahili for receipts; some Sheng in
  social/maintenance messages.
- Uganda: English dominant; Luganda for receipts and informal docs;
  some French in border districts.
- Nigeria: English dominant; Yoruba / Igbo / Hausa for informal
  receipts; some French in Cross River.

| Provider | Strength | Notes |
|---|---|---|
| Intron Health | Swahili-first, also Yoruba/Hausa | Best Swahili Q&A model 2026; Lagos / Nairobi |
| Cohere Aya 23 | 23 languages incl. Sw, Lg, Yo, Ha | Open weights; strong on African langs |
| Google Translate v3 | 130+ languages | Cheap, fast, average quality on African langs |
| Anthropic Claude (any) | Multilingual SOTA | Best general quality; expensive |
| Microsoft Translator | 100+ langs | Best in EU enterprise contexts |
| franc-min | Detection only | Tiny, no network |

### Decisions

- Detection: `franc-min` peer dep + a tiny fallback for the TZ/KE/UG
  primary set. Script-based shortcuts for Arabic/Amharic.
- Translation: provider-agnostic port; default to BrainPort (Claude)
  with translator-port escape hatch for Intron / Cohere Aya / Google.
- Round-trip quality scorer for back-translation — cheap canary to
  flag drift before persisting translated docs.

---

## 5. E-signature

The 2026 landscape consolidated around four leaders for our market:

| Provider | US ESIGN | EU eIDAS | UK eIDAS | AfCFTA | Notes |
|---|---|---|---|---|---|
| DocuSign | yes | SES/AES/QES | yes | yes | Largest market share; best SDK |
| Dropbox Sign (HelloSign) | yes | SES/AES | yes | partial | Cleaner UX; Dropbox-native |
| Adobe Acrobat Sign | yes | SES/AES/QES | yes | yes | Best for adobe-native workflows |
| Signhouse | yes | SES/AES | yes | partial | Newer challenger, devEx focused |
| BankID (Nordic) | n/a | QES | n/a | n/a | Best QES in Sweden/Norway/Finland |
| pdf-lib (local) | n/a | n/a | n/a | n/a | For internal-only / non-binding docs |

### Regional acts

- US: ESIGN Act (15 USC §7001) + UETA (state-by-state)
- EU: eIDAS Regulation 910/2014 + 2024 amendment for QES via eID
- UK: Electronic Communications Act 2000 + UK eIDAS Regs 2016
- Tanzania: Electronic Transactions Act 2015 (CAP 442); accepts SES
  for most contracts; QES required for property transfer above TZS 50M
- Kenya: KICA (Kenya Information & Communications Act) 2020
  amendments; QES required for land transfer
- Uganda: Electronic Transactions Act 2011
- Nigeria: Electronic Transactions Bill 2024 (signed into law April 2025)
- AfCFTA: Africa-wide framework adopted 2024; cross-border e-sig
  recognition between member states

### Decisions

- Ship **4 adapters**: DocuSign, HelloSign, Adobe Sign, Mock.
- Mock adapter doubles as the local pdf-lib fallback for
  INTERNAL_ONLY docs (signed with C2PA + HMAC chain hash by the
  caller — we just provide the port).
- Per-request `jurisdiction` field carries through to the provider so
  each call picks the right signature type (SES / AES / QES).
- BankID is deferred — only matters once we expand into Sweden /
  Norway / Finland.

---

## 6. Accessibility — PDF/A and PDF/UA

PDF/A (ISO 19005) and PDF/UA (ISO 14289) are different standards:

- **PDF/A**: long-term archival. No encryption, no JavaScript,
  embedded fonts, deterministic colour profile.
- **PDF/UA**: accessibility. Tagged structure, alt-text on figures,
  language metadata, semantic order.

A lease that the landlord archives for 7 years needs PDF/A. A
landlord report that goes to a vision-impaired investor needs PDF/UA.
Sometimes both.

### Conformance tooling

| Tool | License | Notes |
|---|---|---|
| veraPDF | MPL/GPL | Reference PDF/A + PDF/UA validator |
| PAC 2024 (PDF Accessibility Checker) | Free for non-commercial | Reference PDF/UA tool |
| callas pdfaPilot | Commercial | Enterprise standard |
| pdf-lib (npm) | MIT | TS-native; great for repair, weak for validation |
| Apache PDFBox | Apache 2.0 | JVM; full preflight |

### Decisions

- Ship a **lightweight scanner** (no binary dependencies) that
  catches the failures we actually see — missing XMP, missing struct
  tree, missing /Lang, missing /Alt on figures, encryption. Reports
  use the `ValidationReport` shape with severity-tagged issues.
- Provide repair helpers (`embedFontsIfMissing`, `addAccessibilityTags`)
  that append PDF marker comments downstream PDF tooling (pdf-lib,
  PDFBox) can consume to perform the real repair.
- True conformance (veraPDF / PAC) is a follow-up adapter.

---

## 7. Adjacent — receipts, DocVQA, handwriting

- **Receipts**: Veryfi, Mindee, Klippa lead the SaaS lane; Anthropic
  Vision tied for accuracy at lower cost. We let callers compose:
  Mock OCR + receipt schema for tests, Anthropic Vision + receipt
  schema for real receipts, Veryfi adapter as a follow-up.
- **DocVQA**: LayoutLMv3 + DocFormerv2 remain the academic leaders.
  In practice Claude 4.7 with vision + RAG over the doc beats them
  end-to-end. Our chat-with-doc subsystem is the production path.
- **Handwriting**: Surya, Marker (with Surya backend), and Anthropic
  Vision are the three credible options. Anthropic Vision wins on
  unconstrained handwriting (e.g. handwritten meter readings); Surya
  wins on structured forms with handwritten cells. Both are reachable
  through our existing adapters (Anthropic Vision directly; Surya via
  Marker REST).

---

## 12+ sources cited

1. Tesseract OCR documentation — https://tesseract-ocr.github.io/
2. Surya layout-aware OCR — https://github.com/VikParuchuri/surya
3. Donut — https://github.com/clovaai/donut
4. LayoutLMv3 — https://github.com/microsoft/unilm/tree/master/layoutlmv3
5. Marker (Datalab) — https://github.com/VikParuchuri/marker
6. Docling (IBM Research) — https://github.com/DS4SD/docling
7. Microsoft Markitdown — https://github.com/microsoft/markitdown
8. Anthropic Citations API — https://claude.com/blog/introducing-citations-api
9. Anthropic Vision docs — https://docs.anthropic.com/en/docs/build-with-claude/vision
10. Microsoft GraphRAG — https://github.com/microsoft/graphrag
11. Cohere Aya 23 — https://cohere.com/blog/aya23
12. Intron Health (Swahili-first ASR + NLP) — https://intron.health
13. franc language detection — https://github.com/wooorm/franc
14. DocuSign eSign REST API — https://developers.docusign.com/docs/esign-rest-api/
15. Dropbox Sign API — https://developers.hellosign.com/api/reference/
16. Adobe Acrobat Sign API — https://opensource.adobe.com/acrobat-sign/developer_guide/index.html
17. EU eIDAS Regulation — https://digital-strategy.ec.europa.eu/en/policies/eidas-regulation
18. Tanzania Electronic Transactions Act 2015 — https://parliament.go.tz/polis/PAMS/docs/13-2015.pdf
19. AfCFTA Digital Trade Protocol — https://au-afcfta.org/2024/02/protocol-on-digital-trade/
20. ISO 19005 (PDF/A) — https://www.iso.org/standard/63534.html
21. ISO 14289 (PDF/UA) — https://www.iso.org/standard/64599.html
22. veraPDF — https://verapdf.org/
23. pdf-lib — https://pdf-lib.js.org/
24. Veryfi receipt API — https://www.veryfi.com/products/receipts/
25. Mindee invoice API — https://platform.mindee.com/
26. Klippa receipt API — https://www.klippa.com/en/ocr/financial-document-recognition/

---

## Spec-to-implementation mapping

| Spec subsystem | Files |
|---|---|
| 1. Types | `src/types.ts` |
| 2. OCR (5 adapters) | `src/ocr/{tesseract,anthropic-vision,docling,marker,mock}-adapter.ts` |
| 3. Chat with doc + multi-doc | `src/chat-with-doc/{chat-with-doc,chat-with-doc-set,chunker,retriever,citations}.ts` |
| 4. Form extraction (6 schemas) | `src/form-extraction/{extract,schemas}.ts` |
| 5. Multilingual | `src/multilingual/{detect,translate}.ts` |
| 6. E-signature (4 adapters) | `src/e-signature/{mock,docusign,hellosign,adobe-sign}-adapter.ts` |
| 7. Accessibility | `src/accessibility/{pdf-a,pdf-ua}-validator.ts` |
| 8. Public barrel | `src/index.ts` |
