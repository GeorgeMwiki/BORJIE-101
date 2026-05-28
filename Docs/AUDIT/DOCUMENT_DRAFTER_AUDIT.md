# Document Drafter Audit (pre Universal-Drafter wave)

Date: 2026-05-28

Path audited: `services/api-gateway/src/services/document-drafter/`

## Current state

| File | Purpose | LoC |
|------|---------|-----|
| `index.ts` | Public service API (`createDocumentDrafter`, `DraftPersistence`, Drizzle adapter) | 334 |
| `composer.ts` | Pure template engine (placeholder + semantic block substitution) | 245 |
| `prompts.ts` | Static `SEMANTIC_PROMPTS` keyed by placeholder name | 200 |
| `brain-tools.ts` | 5 brain tools (`skill.docs.draft_contract`, `draft_rfp`, `draft_rfp_response`, `draft_letter`, `revise_draft`) | 426 |
| `templates/index.ts` | 12-entry static `TEMPLATE_REGISTRY` + paired `.sw.md` / `.en.md` loader | 164 |
| `templates/*.{sw,en}.md` | 12 markdown templates (24 files) | ~1900 total |

## Existing kinds and templates

Drafter kinds (`DRAFT_KINDS`): `contract`, `rfp`, `rfp_response`, `letter`, `notice`, `memo`.

Templates shipped:
- `contract.{supply-ore, equipment-lease, transport}`
- `rfp.{equipment-purchase, smelter-services}`
- `rfp_response.template`
- `letter.{regulator.tumemadini, regulator.nemc, bank.bot, community-grievance}`
- `notice.lease-renewal`
- `memo.internal`

## Routing

- `POST /api/v1/owner/forms/draft` (`routes/owner/forms.hono.ts`): maps four owner-friendly ids (`royalty-return`, `nemc-eia-cover`, `bot-gold-export`, `brela-renewal`) onto existing letter templates.
- Brain wires 5 tools via `setBrainExtraSkills([...draftTools])` in `services/api-gateway/src/index.ts` (line 740-742).

## Persistence

- Table `document_drafts` (migration 0084) with RLS FORCE on `tenant_id`.
- Revisions chain by `parent_draft_id`. Each `/revise` call inserts a new row with `revision_count + 1`.
- No separate revisions table; no citations table.

## Gaps identified

1. **Free-form drafting** — every entrypoint requires a known `templateSlug`. The brain cannot answer "draft me a letter to TRA explaining the late February royalty filing" unless a hard-coded template exists. There is no `composeFreeForm` API.
2. **Multi-format output** — only markdown. No PDF/DOCX/PPTX/HTML renderers, no brand styling, no download surface.
3. **Citation tracking** — the composer does not record which corpus chunks or owner-uploaded documents informed the output.
4. **Revision history surface** — `parent_draft_id` chain exists but there is no list-revisions endpoint and no revert.
5. **Media generation** — no image / chart / diagram / infographic generators integrated with the drafter even though `packages/media-generation/` exists.
6. **Chat integration** — the existing inline blocks (data_capture, confirmation, micro_action, etc.) do not include a `draft_preview` block, so a brain-composed draft renders as a 600-char plain-text preview inside `evidenceSummary`.
7. **Template library size** — 12 templates cover ore-supply, regulator letters, RFPs and one memo. Missing: MOU, board resolution, partnership deed, business plan, financial statement, audit report, CDA, sponsorship proposal, tender response, performance review, offer letter, dismissal letter, SOP, training material, operations manual, off-taker master sale, NEMC EIA decision (latter two owned by sibling).

## This wave delivers

- `free-form-composer.ts` + `POST /api/v1/owner/drafts/free-form` + `mining.drafts.compose_free_form` brain tool.
- 18 mining-estate template files (skipping the two sibling-owned ones).
- DOCX / PPTX / HTML renderers (pure-Node ZIP + OOXML; no new deps).
- Brand styling shared across every renderer (Borjie logo wordmark, footer with audit hash + disclaimer).
- Media generation tools: `mining.media.generate_image`, `generate_chart`, `generate_diagram`, `generate_infographic`.
- Migration 0100 adding `drafts`, `draft_revisions`, `draft_citations` (extending the existing registry without breaking the v1 `document_drafts` table).
- `draft_preview` inline block schema + parser inclusion.
- Smoke harness + audit-hash chaining on every revision / render.
