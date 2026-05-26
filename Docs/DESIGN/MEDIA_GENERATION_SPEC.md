# Media Generation Specification — Borjie

> Wave 17 / foundational layer #4 — the brand-DNA-locked image + short-video synthesis layer of the MD's autonomy.

Status: design-spec + Phase 2 seed implementation (`packages/media-generation/`).
Brand: Borjie.
Persona: Mr. Mwikila (Managing Director).

Sibling specs — the four-layer composition family:

1. `Docs/DESIGN/ANTICIPATORY_UX_SPEC.md` — ephemeral interactive surfaces (tabs, wizards, prefilled forms).
2. `Docs/DESIGN/DOCUMENT_COMPOSITION_SPEC.md` — persistent durable outputs (PDF / DOCX / PPTX / XLSX).
3. `Docs/DESIGN/DEEP_RESEARCH_SPEC.md` — grounded evidence + citations.
4. **This document** — image + short-video generation, brand-DNA-locked, safety-scanned, watermark-sealed.

Master charter: `Docs/MASTER_BRAIN_AUTONOMY_MANIFESTO.md`.

---

## 1. Vision

Founder, verbatim:

> "Image and short video generation SOTA — Runway, Sora, Seedance 2 on par."

Expanded: Mr. Mwikila must generate brand-DNA-locked images and short videos at parity with SOTA models. Same discipline as the document and UI composition layers: every artefact is recipe-driven, citation-grounded, brand-validated on prompt and output, safety-scanned for NSFW + deepfake + brand violation, watermarked invisibly (C2PA) and visibly (Borjie wordmark), audit-chained, and authority-tiered.

This is the **brand-DNA layer** of the MD's autonomy. Where the document layer compiles a Tumemadini return into a PDF, this layer compiles a parcel listing into a hero image, an investor briefing into a 20-second narrative video, an overnight briefing into a share-card. The MD reaches for media generation for: marketplace listing visuals (rendered from ore-parcel data + photos), investor briefing video B-roll, social posts (still + short-form video), daily-briefing thumbnails, site visualisations (drone footage + annotations), tutorial lipsync videos, marketing stills with Borjie wordmark.

Every generation goes through the authority-tier model: Tier 0 = draft (internal-only auto-publish), Tier 1 = staged for owner review (24h auto-promote), Tier 2 = public-facing / paid-marketing / talking-head video (requires owner approval). A senior MD does not approve a brand asset they have not seen. Mr. Mwikila does not publish one either.

---

## 2. SOTA tool picks for 2026

The composer is provider-agnostic; an adapter layer wraps every model so the dispatcher can substitute providers on the fly. Every adapter is gated on env keys and degrades gracefully when absent.

### Image generation

| Tool | Role | Why | Cost (per image, USD) |
|---|---|---|---|
| **Flux 1.1 Pro Ultra** (Black Forest Labs) | Primary | Best photorealism + text rendering at 4 MP; Borjie wordmark survives compositing | $0.06 |
| **Ideogram 3.0** | Secondary | Best text-in-image + brand-mark composition fidelity | $0.08 |
| **Recraft v3** | Vector + raster | Brand-style transfer, SVG export for wordmark composites | $0.04 |
| **Imagen 4** (Google) | High-volume fallback | Cost-effective batches (social post grids) | $0.04 |
| **Stable Diffusion 3.5 Large** | Self-host backup | Air-gapped tier, owner-controlled when external models are unavailable | self-host |
| **Adobe Firefly Image 4** | Commercial-safe inpainting | Cleared rights for paid-marketing assets | $0.05 |
| **Flux Fill / Canny** | Controlled edits | Mask-based inpainting + edge-conditioned redraw | $0.04 |

### Video generation

| Tool | Role | Why | Cost (per second, USD) |
|---|---|---|---|
| **Runway Gen-4** | Primary | Image-to-video + text-to-video at 1080p / 10 s | $0.05 |
| **OpenAI Sora 2** | Secondary | Narrative scenes up to 20 s, best multi-shot story arc | $0.10 |
| **Seedance 2.0** (ByteDance) | Asia-region SOTA | Multi-shot consistency, strong on Swahili-script overlays | $0.06 |
| **Luma Dream Machine 2** | Fast iteration | Sub-minute generations for daily-briefing thumbnails | $0.03 |
| **Kling 2.5 Master** | Chinese-language scene support | Counterparty briefings for CN-language buyers | $0.05 |

### Voice + lipsync

| Tool | Role | Why |
|---|---|---|
| **ElevenLabs Multilingual v3** | Voice synthesis | Already wired in `packages/audio-capture/` |
| **Hedra Character-3** | Face animation + lipsync | High-fidelity lipsync from audio + portrait |
| **HeyGen Avatar V5** | Talking-head video synthesis | Avatar pipeline for tutorial / regulator-explainer videos |

Every adapter implements `MediaProviderAdapter` (§5). Selection is per-capability and gated on per-class cost-budget.

---

## 3. The MediaRecipe contract

TypeScript sketch, mirroring `TabRecipe` (Anticipatory UX) and `DocumentRecipe` (Document Composition):

```typescript
export interface MediaRecipe {
  readonly id: string;
  readonly class: MediaClass;
  readonly version: number;
  readonly status: 'draft' | 'shadow' | 'live' | 'locked' | 'deprecated';
  readonly compose: (ctx: MediaComposeContext) => Promise<MediaArtifact>;
  readonly required_prompt_inputs: ReadonlyArray<PromptInputContract>;
  readonly output_format: 'image' | 'short_video' | 'lipsync_video';
  readonly target_aspect_ratio: '1:1' | '4:5' | '9:16' | '16:9' | '21:9';
  readonly target_duration_sec?: number;     // video only
  readonly authority_tier: 0 | 1 | 2;
  readonly brand: 'borjie';
  readonly approval_required: boolean;
}

export type MediaClass =
  | 'marketing_still'
  | 'marketplace_listing_hero'
  | 'site_visualisation'
  | 'briefing_thumbnail'
  | 'investor_brand_video'
  | 'social_post_still'
  | 'social_post_short_video'
  | 'tutorial_lipsync_video'
  | 'avatar_talking_head';

export interface MediaArtifact {
  readonly id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly format: 'image' | 'short_video' | 'lipsync_video';
  readonly storage_key: string;        // Supabase Storage path
  readonly thumb_storage_key: string;  // poster frame for videos
  readonly checksum: string;
  readonly provenance: MediaProvenance;
  readonly span_citations: ReadonlyArray<SpanCitation>;
  readonly audit_hash: string;
  readonly approval_state: 'pending' | 'approved' | 'rejected' | 'auto_published';
  readonly approved_by?: string;
  readonly approved_at?: string;
}

export interface MediaProvenance {
  readonly model_id: string;
  readonly model_version: string;
  readonly model_provider:
    | 'runway' | 'sora' | 'seedance' | 'flux' | 'ideogram'
    | 'recraft' | 'imagen' | 'hedra' | 'heygen' | 'firefly' | 'sd35';
  readonly prompt_text: string;
  readonly prompt_image_refs: ReadonlyArray<string>;
  readonly seed: string;
  readonly safety_scan: {
    readonly nsfw_probability: number;
    readonly deepfake_probability: number;
    readonly brand_violation_flags: ReadonlyArray<string>;
  };
  readonly cost_usd_cents: number;
  readonly duration_ms: number;
}
```

Recipes are versioned. A live recipe never mutates in place — improvement proposals create version `n+1` in `shadow` state, promoted to `live` only after owner approval. Locked recipes refuse all auto-improvement signals.

---

## 4. The 4 Layers of Media Composition

Mirrors the document + UX 4-layer model.

### Layer 1 — Intent Binding

A trigger event (chat intent, marketplace-listing publish, briefing cron, investor-update threshold) selects a `MediaRecipe.id` via a deterministic intent→recipe table. The router lives alongside the existing `persona-router` and the document-composition `doc_intent → recipe_id` map; no fuzzy matching at this layer.

### Layer 2 — Dynamic Prompt Composition

The composer takes the recipe + the `MediaComposeContext` and **assembles** a prompt rather than fills a template:

- **Brand-DNA prompt prefix.** Every prompt is prefixed with the Borjie BrandSpec (§6) — OKLCH palette, photographic style, wordmark policy, typography rules. Injected mechanically by `brand-lock/prompt-prefix-builder.ts`; recipes never write raw style text.
- **Subject specification.** Recipes pull subject data from joins (for `marketplace_listing_hero`: `ore_parcel#PRL-001`, `18.7 g/t Au`, region `Geita`). Each numeric / dated / regulatory claim must reference a `SpanCitation`.
- **Composition rules.** Aspect ratio, focal point, mood, brand prominence — derived from recipe + target audience.
- **Negative prompt.** Mechanical denylist: off-brand colors, unconsented deepfake of real personnel, watermark-removal cues, NSFW, off-brand typography, stock-photo cliches.
- **Citation block.** Any factual claim must reference span citations from Deep Research + Document Composition. Refused with `CITATION_GAP` otherwise.

### Layer 3 — Brand-Locked Provider Call

The dispatcher (`providers/dispatcher.ts`) selects provider by capability (image / video / lipsync), aspect ratio + duration (Runway Gen-4 ≤10 s, Sora 2 ≤20 s, Hedra/HeyGen for lipsync), cost-budget envelope, and region / language (Seedance + Kling for Asia-region or CN scenes).

Provider call is bracketed by brand validators. Pre-call: `prompt-prefix-builder.ts` ensures brand prefix + negative prompt. Post-call: `output-validator.ts` runs an Anthropic Haiku 4.5 vision check for palette density, wordmark integrity, signature treatment. Failures route to retry or refuse.

Adapters fall back in priority order — video: Runway → Sora → Seedance; image: Flux → Ideogram → Imagen → SD3.5. Every fallback is recorded in `MediaProvenance.model_provider`.

### Layer 4 — Safety + Continuous Evolution

Every artefact passes five modules:

1. **NSFW scan.** OpenAI Moderation (primary) + NSFWJS fallback. Per-class threshold.
2. **Deepfake detection.** Reality Defender (env-gated). Never publish media of a real person without consent token.
3. **Brand-DNA validator.** Post-gen Haiku 4.5 vision call — palette density, wordmark integrity, signature treatment.
4. **Watermarking.** Invisible C2PA sealing provenance + recipe id + audit hash; visible Borjie wordmark for public-facing variants (sharp / ffmpeg).
5. **Audit-chain entry.** Provenance + safety-scan + checksum sealed into `audit-hash-chain`.

Feedback loop: engagement events (CTR, owner-revision rate, share-rate) feed the lock/improve policy via `services/media-evolution-worker/` (future).

---

## 5. Brand-Locked Provider Adapter contract

```typescript
export interface MediaProviderAdapter<TInput, TOutput extends MediaArtifact> {
  readonly name: string;
  readonly model_id: string;
  readonly capabilities: ReadonlyArray<
    | 'text_to_image' | 'image_to_image'
    | 'text_to_video' | 'image_to_video'
    | 'lipsync_video' | 'inpainting'
  >;
  readonly cost_per_unit_usd_cents: number;
  readonly invoke(input: TInput, ctx: ProviderContext): Promise<TOutput>;
  readonly applyBrandLock(prompt: string, brand: BrandSpec): string;
}
```

Each adapter: wraps the provider's HTTP API via `undici` (graceful-degrades when keys absent); implements `applyBrandLock(prompt, brand)` for prefix + negative prompt; returns a `MediaArtifact` with full `MediaProvenance`; reserves cost-budget before invoking (commit / release on completion / failure); records an audit-chain entry on success.

---

## 6. Brand-DNA prompt-prefix system

A `BrandSpec` is stored per tenant (Borjie defaults below). Every generation prepends a mechanically-built prefix:

```
Photographic style: documentary, golden-hour, warm but technical.
Color treatment: Borjie OKLCH palette — primary signal (oklch(0.78 0.16 75))
for accents, neutral foreground (oklch(0.96 0.02 75)), surface background
(oklch(0.18 0.02 65)).
Typography on graphics: font-display sans-serif, no other fonts.
Wordmark policy: when present, top-left, opacity 1, no transformation.
Avoid: stock-photo cliches, deepfake of real Borjie personnel without consent,
NSFW, watermark-removal cues, off-brand color schemes.
```

The BrandSpec also carries the hex / OKLCH palette anchors, the wordmark SVG reference (`packages/design-system/src/brand/`), the signature gradient direction, the negative-prompt denylist (extensible per-recipe), and the consent-token requirement when the subject is a real person. The prefix builder is pure (no I/O); brand changes require only updating the BrandSpec source of truth.

---

## 7. Safety + provenance

Every output is NSFW-scanned (OpenAI Moderation, NSFWJS fallback; threshold per class); deepfake-checked (Reality Defender, env-gated; returns probability + flagged frames); invisibly watermarked via C2PA content credentials (manifest carries recipe id, audit hash, prompt hash, model id, generated_at, signed by tenant audit secret); visibly watermarked with the Borjie wordmark in the lower-right corner for public-facing variants (per-recipe); and audit-chained (`provenance + safety_scan + checksum` sealed via `audit/audit-chain-link.ts`). Regulators can later request the audit row to verify the recipe / model / prompt / scan that produced each artefact.

---

## 8. Authority Tier Map for media

- **Tier 0** — internal sketches, briefing thumbnails. Auto-publish to owner-only channels with passive notification.
- **Tier 1** — marketplace-listing visuals, social post drafts. Staged for owner review; 24 h auto-promote if no rejection.
- **Tier 2** — investor brand video, avatar talking-head video, paid-marketing assets, anything depicting a real person. Requires explicit owner approval (and, for talking-head video of a real person, an explicit consent token) before public distribution.

Tier transitions are audit-chained. A media artefact never moves from `pending` to `auto_published` without traversing the approval queue or satisfying the Tier-0 auto-publish predicate.

---

## 9. Cost + latency budgets per media class

| Class | Format | Budget (USD) | Latency budget |
|---|---|---|---|
| `briefing_thumbnail` | image | ≤ $0.10 | ≤ 15 s |
| `marketplace_listing_hero` | image | ≤ $0.15 | ≤ 30 s |
| `social_post_still` | image | ≤ $0.10 | ≤ 20 s |
| `social_post_short_video` | video, 6 s | ≤ $0.50 | ≤ 5 min |
| `tutorial_lipsync_video` | lipsync, 30 s | ≤ $3.00 | ≤ 10 min |
| `investor_brand_video` | video, 20 s | ≤ $5.00 | ≤ 15 min (Tier 2 owner-confirm) |
| `avatar_talking_head` | video, 60 s | ≤ $8.00 | ≤ 20 min (Tier 2 owner-confirm) |

Budget enforcement reuses the `cost-tracker` pattern from `research-tools` — reserve before call, commit on success, release on failure. Owner-confirm gate fires for Tier-2 budgets at half-spend.

---

## 10. Schema additions

```sql
CREATE TABLE media_recipes (
  id text NOT NULL,
  version int NOT NULL,
  status text NOT NULL,
  class text NOT NULL,
  compose_fn_ref text NOT NULL,
  required_inputs jsonb NOT NULL,
  output_format text NOT NULL,
  target_aspect_ratio text NOT NULL,
  target_duration_sec int,
  authority_tier smallint NOT NULL,
  brand text NOT NULL DEFAULT 'borjie',
  approval_required boolean NOT NULL DEFAULT true,
  promoted_at timestamptz,
  promoted_by text,
  locked_at timestamptz,
  PRIMARY KEY (id, version)
);

CREATE TABLE media_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  recipe_id text NOT NULL,
  recipe_version int NOT NULL,
  format text NOT NULL,
  storage_key text NOT NULL,
  thumb_storage_key text,
  checksum text NOT NULL,
  provenance jsonb NOT NULL,
  span_citations jsonb,
  audit_hash text NOT NULL,
  approval_state text NOT NULL DEFAULT 'pending',
  approved_by text,
  approved_at timestamptz,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media_safety_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES media_artifacts(id),
  scanner text NOT NULL,
  nsfw_probability numeric(4,3),
  deepfake_probability numeric(4,3),
  brand_violation_flags text[],
  raw_result jsonb,
  scanned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media_engagement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES media_artifacts(id),
  event_kind text NOT NULL,
  payload jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
```

All tenant-scoped tables are gated by Supabase RLS via the canonical `app.tenant_id` GUC pattern (mirrors migration 0019). `media_recipes` is global product config and RLS-disabled.

---

## 11. Anti-patterns

The media composer MUST NOT:

- **Generate media of a real person** (owner, partner, regulator, employee) without an explicit consent token recorded in `MediaComposeContext`.
- **Publish a Tier-2 media artefact** without owner approval. The composer pipeline lacks a path to skip the approval queue.
- **Render an artefact without Borjie brand cues** — `output-validator.ts` rejects if brand-color density or wordmark integrity falls below the recipe-declared threshold.
- **Skip the safety scan.** Every artefact passes NSFW + deepfake + brand-violation scanners before `audit_hash` is sealed.
- **Use a model without provenance recording.** A `MediaArtifact` without a fully-populated `MediaProvenance` is refused at the composer boundary.
- **Cross brand.** Borjie recipes never produce non-Borjie artefacts; BossNyumba is a sibling fork with its own recipe registry.
- **Lose lineage in the audit chain.** Missing parent hash → `chain_break` audit signal → ops alarm.
- **Auto-improve a locked recipe.** Locked → all improve signals queued as proposals, none auto-applied.

---

## 12. Phase 2 implementation plan (this wave)

1. **New package `packages/media-generation/`** — types, registry, composer, brand-lock prompt + output validator, 11 provider adapters, 5 safety / watermark modules, audit-chain link, cost-tracker, 3 seed recipes.
2. **New migration** `packages/database/drizzle/0020_media_generation.sql` — `media_recipes`, `media_artifacts`, `media_safety_scans`, `media_engagement_events` tables with RLS.
3. **Persona system-prompt addition (future wave)** — Mr. Mwikila gains tools:
   - `compose_media_v1(recipe_id, intent_payload)` — generate the artefact.
   - `submit_media_for_approval_v1(artifact_id)` — move to approval queue.
   - `propose_media_evolution_v1(recipe_id, diff, signals)` — emit improvement proposal.
4. **New routes (future wave)** in admin-api:
   - `POST /api/v1/media/compose`.
   - `POST /api/v1/media/approve`.
   - `POST /api/v1/media/reject`.
   - `GET /api/v1/media/artifact/:id`.
5. **Dynamic recipe authoring (Wave 18M)** — instead of shipping 11 hardcoded recipes, the dynamic-author will generate recipes on demand. This spec ships only 3 seed recipes (`briefing_thumbnail`, `marketplace_listing_hero`, `social_post_still`) to demonstrate the contract.

---

## 13. Cross-references

- Master charter: `Docs/MASTER_BRAIN_AUTONOMY_MANIFESTO.md`.
- Anticipatory UX sibling: `Docs/DESIGN/ANTICIPATORY_UX_SPEC.md`.
- Document Composition sibling: `Docs/DESIGN/DOCUMENT_COMPOSITION_SPEC.md`.
- Deep Research sibling: `Docs/DESIGN/DEEP_RESEARCH_SPEC.md`.
- Existing surfaces reused: `packages/audit-hash-chain/`, `packages/observability/`, `packages/brain-llm-router/`, `packages/research-tools/` (cost-tracker pattern), `packages/audio-capture/` (ElevenLabs wiring), `packages/design-system/src/brand/` (wordmark + palette tokens).

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
