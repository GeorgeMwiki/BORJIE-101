# Document Quality Guarantor — 2026 Research Notes

Date: 2026-05-24
Package: `@borjie/document-quality-guarantor`
Author: Claude (planner+research agent)

The user directive is binary: **"we should never fail to capture document data
accurately or create any document or file of any type accurately and with
highest quality."** This research justifies every design decision in the
package: which engines to route between, what quality gates block release,
how to retry deterministically, and when to escalate to a human.

---

## 1. Multi-engine OCR routing (2026 state-of-the-art)

The dominant 2026 pattern is **portfolio orchestration**: keep multiple OCR
engines wired in parallel, score the input, then route. The orchestrator
exposes a single interface so engines can be swapped without touching
callers; engines themselves are Tesseract, PaddleOCR, RapidOCR, EasyOCR,
LLMWhisperer, AWS Textract, Azure Document Intelligence, Google Document
AI, DeepSeek-OCR, and frontier VLMs (Claude Sonnet 4.5, GPT-4.1).
([unstract.com], [llamaindex.ai], [medium.com/intelligent-document-insights])

Routing signals that drive selection:

1. **Image quality score** — DPI, contrast, blur (Laplacian variance),
   skew. Below threshold → preprocess (deskew, denoise, binarize) before
   routing; if still below threshold → escalate.
2. **Layout complexity score** — column count, table density, figure
   density, mixed-language presence. Simple layouts → fastest engine
   (Tesseract); complex → vision-LLM (Claude / LLMWhisperer).
3. **Language detector** — Tesseract drops for Swahili/Arabic; PaddleOCR /
   LLMWhisperer wins for non-Latin. The detector reads the first ~2KB of
   pre-OCR text or runs a fast text-classifier on the page image.
4. **Handwriting / signature / stamp detection** — bumps to engines that
   ship handwriting models (LLMWhisperer, Azure Read).

Best practice: keep routing **deterministic** so the same doc always picks
the same engine ordering. We seed routing decisions on the SHA-256 of the
input bytes so cache hits return instantly.

---

## 2. Quality metrics: NIST / ICDAR / OmniDocBench

The industry-standard metrics for OCR accuracy in 2026:

- **Character Error Rate (CER)** = (Insertions + Deletions + Substitutions)
  / total characters. Production target: ≥ 98 % accuracy for printed
  English, 96.5 % across diverse documents.
- **Word Error Rate (WER)** — coarser, used for layout-tolerant comparison.
- **Character Error Vector (CEV)** — newer (2026 ICDAR) bag-of-characters
  evaluator that handles parsing differences.
- **OmniDocBench** — 2026 benchmark covering text extraction, table parsing,
  formula recognition, and layout understanding. Replaces ICDAR as the
  composite scorecard.
([medium.com/@sanjeeva.bora], [sparkco.ai])

Our `confidenceGate` requires per-engine `confidence` ∈ [0,1]; default
threshold 0.85. Below that → next engine in fallback chain.

---

## 3. Roundtrip verification (render → OCR → diff)

Used by Microsoft Word, Pages, LibreOffice and patent literature (USPTO
9529874, 8782515) to verify a render preserved source intent. The pattern:

1. Take the generated PDF/DOCX/etc.
2. Render it to bitmap (PDF.js / Puppeteer / LibreOffice headless).
3. Run OCR over the bitmap.
4. Diff extracted text against the source content; require ≥ 99 %
   similarity on quantitative fields (numbers, dates, names) and ≥ 95 %
   on prose. ([help.libreoffice.org/Compare Document])

We implement this in `roundtripFidelityGate`. Threshold tunable per
document kind (financial reports stricter than marketing collateral).

---

## 4. Visual diff: pixelmatch / odiff / looks-same / BackstopJS

For pixel-perfect rendered output verification:

- **pixelmatch** — baseline, configurable color tolerance + acceptable
  diff percentage. Battle-tested with jest-image-snapshot and Playwright
  VRT. ([percy.io], [bug0.com])
- **odiff** — faster than pixelmatch for large images; OCaml-implemented.
- **looks-same** — anti-aliasing-aware comparison; lower false positives.
- **BackstopJS** — full visual regression harness on top of pixelmatch.
- **DiffPDF** (PyMuPDF + pixelmatch-fast) — PDF-specific; renders pages to
  PNG, diffs page-by-page.

Caveat: pixelmatch can't distinguish a meaningful layout shift from a
1-pixel anti-aliasing change. We use it as a **bound** (reject if diff %
above tolerance), never as ground truth for "is this the right output."
The roundtrip OCR gate is what proves semantic correctness; visual diff
proves visual stability.

---

## 5. Idempotent retry + DLQ patterns

The 2026 canonical retry stack:

- **Idempotency key** — caller-supplied unique id; the queue dedups on it,
  returning the existing run handle if the same key reruns. Trigger.dev
  v3 docs spell this out at the task level. ([trigger.dev/docs/idempotency])
- **Exponential backoff with jitter** — 1s → 5s → 25s → 125s. Jitter
  prevents thundering-herd / synchronized retry storms. ([dev.to/young_gao])
- **Bounded retries** — 5-8 attempts typical; we default to 4 to keep
  end-to-end latency under ~3 minutes.
- **Dead-letter queue** — poison-message isolation. After max retries,
  move to DLQ with the full attempt history and original payload; emit
  alert + escalate. ([abstractalgorithms.dev], [littlehorse.io])
- **Visibility timeout / lease** — a worker leases a job; if it crashes
  before ack, the job becomes visible again after the timeout.

We implement all five in `src/retry-queue/` with an in-memory default and
a pluggable port for Postgres/Redis adapters.

---

## 6. Human-in-the-loop escalation

When AI runs out of skill, **escalate to a human reviewer**. The 2026
playbook (Labelbox, Scale AI, Surge AI, Cleanlab Studio):

- **Confidence threshold trigger** — if model confidence < threshold,
  auto-route to human. ([labelbox.com/guides/human-in-the-loop])
- **Active-learning loop** — humans label exactly the hard cases the model
  is least confident on; gradient improves fastest. ([labellerr.com])
- **Disagreement / drift triggers** — repeated low agreement between
  engines, or a sudden distribution shift, escalates upward.
- **Policy ambiguity** — domain-specific rules (e.g. "this is a legal
  document, never auto-approve without a lawyer's review").

We integrate with `@borjie/workflow-engine` (P29). An escalation
creates a `WorkflowRun` in `in_review` state with the failed AI output as
the `ProposedChange`, the reasons attached as a structured payload, and
a `EscalationCause` enum so dashboards can slice.

---

## 7. Format coverage strategy

Source of truth for format-by-format support:

- **Pandoc** — converts between more document formats than any other tool
  (markdown, RST, AsciiDoc, Org, MediaWiki, DOCX, ODT, EPUB, HTML, LaTeX,
  Beamer, PPT, JATS, ICML, ...). Caveat: pandoc's intermediate model is
  less expressive than many formats; not lossless. ([pandoc.org])
- **LibreOffice headless / unoconv** — DOCX/ODT/RTF/PPT interconversion
  with high fidelity (uses the same engine as the desktop suite).
- **Carbone** — JSON → PDF/DOCX/XLSX/PPTX/ODT/ODS/HTML using Chromium for
  HTML→PDF and LibreOffice for office formats. ([carbone.io])
- **Typst** — math/tables/scientific PDF generation, faster than LaTeX
  with simpler syntax. ([typetex.app/comparisons/typst-vs-latex])
- **mammoth** — DOCX → semantic HTML, lossy but predictable for roundtrip.
- **exceljs / SheetJS** — XLSX read/write at the cell level.
- **pptxgenjs** — PPTX programmatic generation.
- **pdf-lib / pdf-merger / pdf-libjs** — low-level PDF manipulation.

Our `format-coverage/` registers handlers for the 17 formats listed in the
spec; each handler declares input + output capability + the engine that
should handle it (with fallback chain).

---

## 8. Constitutional self-critique for AI output

Constitutional AI is the pattern of giving a model a written set of
principles and training it to self-critique against them. ([anthropic.com])
The relevant operational pattern for us: at output time, **the model
generates the doc, then critiques its own output against a quality
constitution, then revises.** We use this style inside the output
orchestrator: render → critique (via gates) → revise (next engine) → ship.

Caveat: recursive self-critique on small models leads to **model collapse**
(Llama-3-8B study, 2026). Mitigation: the critique step is rule-based
(our quality gates), not another LLM call.

---

## 9. Letter-perfect printing standards

For postal automation and high-fidelity print output:

- **OCR-A / OCR-B** — postal-automation fonts; readable by every scanner.
- **MICR fonts (E-13B, CMC-7)** — check printing; magnetic-ink readers.
- **OMR (Optical Mark Recognition)** — survey / exam scoring; bubbles.
- **Postal Service Mailpiece Quality Control** — bar code clear zones,
  envelope window placement specs.

When a doc kind is flagged `print-grade`, the visual-diff gate ramps to
near-zero pixel tolerance and the font-embedding gate becomes mandatory.

---

## 10. Forensic typography & font embedding (PDF/A, PDF/UA)

- **PDF/UA** requires **all fonts embedded** — non-embedded fonts break
  screen readers and assistive tech. ([theaccessibilityguy.com],
  [pdflib.com/pdf-knowledge-base/pdfua])
- **PDF/A-1b** is the baseline archival standard; PDF/A-1a adds tagged
  PDF structure for accessibility.
- **FontForge / fonttools** — extract font tables from PDFs; verify each
  embedded font has Unicode mapping (`ToUnicode` CMap) so text extraction
  works.
- A PDF can conform to both PDF/A and PDF/UA simultaneously.

Our `fontEmbeddingGate` parses the rendered PDF's font dictionary; if
any font lacks `FontFile`/`FontFile2`/`FontFile3` (embedded program) the
gate blocks release.

---

## Sources cited (10)

1. [Best OCR Software in 2026 — Unstract](https://unstract.com/blog/best-ocr-software/)
2. [Best OCR Software of 2026: Agentic AI — LlamaIndex Insights](https://www.llamaindex.ai/insights/best-ocr-software)
3. [Tesseract OCR in 2026 — Intelligent Document Insights / Medium](https://medium.com/intelligent-document-insights/tesseract-ocr-in-2026-what-it-does-where-it-wins-and-when-to-look-elsewhere-265dc2f88992)
4. [OCR Accuracy Benchmarks 2025 / 2026 — sparkco.ai](https://sparkco.ai/blog/2025-ocr-accuracy-benchmark-results-a-deep-dive-analysis)
5. [Character Error Rate guide — Sanjeev Bora / Medium](https://medium.com/@sanjeeva.bora/the-definitive-guide-to-ocr-accuracy-benchmarks-and-best-practices-for-2025-8116609655da)
6. [LibreOffice Compare Document](https://help.libreoffice.org/latest/en-US/text/shared/01/02240000.html)
7. [Visual Regression Testing with Playwright + Pixelmatch — Testrig](https://testrig.medium.com/visual-regression-testing-with-playwright-and-pixelmatch-002770005019)
8. [Retry Patterns That Work: Exponential Backoff, Jitter, DLQ 2026 — DEV / Young Gao](https://dev.to/young_gao/retry-patterns-that-actually-work-exponential-backoff-jitter-and-dead-letter-queues-75)
9. [Trigger.dev Idempotency docs](https://trigger.dev/docs/idempotency)
10. [Dead Letter Queue Pattern — abstractalgorithms.dev](https://www.abstractalgorithms.dev/dead-letter-queue-pattern-poison-message-recovery)
11. [What is Human-in-the-Loop — Labelbox](https://labelbox.com/guides/human-in-the-loop/)
12. [Pandoc — index](https://pandoc.org/)
13. [Carbone — Open Source Report Generator](https://carbone.io/)
14. [Constitutional AI: Harmlessness from AI Feedback — Anthropic](https://www.anthropic.com/research/constitutional-ai-harmlessness-from-ai-feedback)
15. [PDF/UA File Format Requirements — pdflib.com](https://www.pdflib.com/pdf-knowledge-base/pdfua/requirements/)
16. [PDF UA Compliance: Font Not Embedded — theaccessibilityguy.com](https://theaccessibilityguy.com/font-not-embedded-error-in-pac-2021-checker-pdf-ua-amp-wcag-compliance/)

---

## Design summary — what the package must guarantee

1. **No silent failure**: every extraction / generation either succeeds at
   quality, or is escalated. Never returns "best effort" without flagging.
2. **Deterministic engine routing**: same input → same engine order, so
   replays are reproducible.
3. **Composable quality gates**: 7 gates ship in-tree; new ones add via
   the `QualityGate` interface.
4. **Bounded retries with jitter**: poison messages don't loop forever;
   they DLQ and escalate.
5. **WORM audit chain**: every engine call, gate verdict, retry, and
   escalation is on the chain — replayable bit-for-bit.
6. **17 formats supported on day one**: PDF, DOCX, XLSX, PPTX, ODT, ODS,
   ODP, RTF, HTML, MD, TXT, CSV, JSON, EML, MSG, EPUB, IMAGE — plus a
   `register(handler)` API for custom formats.
