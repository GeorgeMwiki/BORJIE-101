# Marketing & Promotion Generation Specification — Borjie

> Wave 18P / foundational layer #5 — the public-facing surface of Mr. Mwikila's autonomy.

Status: design-spec + Phase 2 seed implementation (`packages/marketing-studio/`).
Brand: Borjie. Persona: Mr. Mwikila (Managing Director).

Sibling specs — the five-layer family:

1. `Docs/MASTER_BRAIN_AUTONOMY_MANIFESTO.md` — operating manifesto.
2. `Docs/DESIGN/ANTICIPATORY_UX_SPEC.md` — ephemeral surfaces.
3. `Docs/DESIGN/DEEP_RESEARCH_SPEC.md` — grounded evidence.
4. `Docs/DESIGN/DOCUMENT_COMPOSITION_SPEC.md` — durable artefacts.
5. `Docs/DESIGN/MEDIA_GENERATION_SPEC.md` — brand-locked image + video.
6. **This document** — 12-channel campaign-driven marketing with A/B testing, performance tracking, and claim-citation enforcement.

---

## 1. Vision

Founder, verbatim:

> "Marketing and promotion materials generation also pure intelligence and SOTA."

Expanded: Mr. Mwikila must generate **complete, channel-native, performance-tracked, compliance-checked, brand-locked marketing assets at SOTA quality** — as **campaigns**, not as one-off documents or images.

A campaign is a multi-asset sequence across channels, audience-segmented, performance-tracked, A/B-tested, SEO-optimised, and claims-cited. An investor announcement is one LinkedIn post + one X thread + one YouTube Short + one email blast + one PR release + one landing-page CTA, coordinated, citing the same evidence, tied to the same audit trail. A buyer-acquisition push is brochure + SEO article + Meta ad campaign + drip email sequence + regional landing page, segmented by language and jurisdiction.

The marketing layer is **the public-facing surface above the internal layers**. Docs and media compose internal artefacts; marketing publishes them through APIs, with UTM tags, conversion pixels, consent banners, disclaimer footers, audit-chain links. Where research validates a claim internally, marketing enforces that every published claim cites that validation. Where the manifesto says "cite or stay silent" for the brain, marketing says "cite or refuse to publish" for the world.

A senior MD does not publish without re-reading every public claim. Mr. Mwikila does not either.

---

## 2. The 12 Marketing Material Classes

| # | Class | Use case | Channel(s) | Output format(s) | Authority tier | Citation density |
|---|---|---|---|---|---|---|
| 1 | **Social Post Single** | Daily organic presence, milestone announcement | LinkedIn organic, X organic, Meta organic | text + 1 image | Tier 1 | high |
| 2 | **Social Thread** | Multi-post narrative — investor update, parcel-sale story, regulatory explainer | X / LinkedIn | structured text | Tier 1 | high |
| 3 | **Short Video Spot** | Hero clips, parcel reveals, founder shorts | TikTok / Reels / YouTube Shorts | 6–30 s video | Tier 1 | high |
| 4 | **Long Video Story** | Investor narrative, site visit reportage, knowledge base | YouTube / LinkedIn native | 1–10 min video | Tier 1 | high |
| 5 | **Paid Ad Creative** | Conversion-funnel ads with multi-variant testing | Google Ads, Meta Ads, TikTok Ads | multi-variant text + image / video | Tier 2 | extreme |
| 6 | **Email Campaign** | Drip / newsletter / one-shot announcement | Resend / Mailchimp / SendGrid | HTML + plaintext | Tier 1 | extreme |
| 7 | **Landing Page** | Campaign-specific conversion surfaces with A/B variants | `apps/marketing/` | HTML route + JSON-LD | Tier 2 | extreme |
| 8 | **SEO Article** | Knowledge-base post / blog / industry brief | Vercel / WordPress / RSS | markdown + HTML + JSON-LD | Tier 1 | high |
| 9 | **Press Release** | PR wire + media kit | PR Newswire / Africa News Agency / RSS | DOCX + PDF + HTML | Tier 2 | extreme |
| 10 | **Investor One-Pager** | Single-page summary for fundraise / data room | PDF deliverable | PDF | Tier 2 | extreme |
| 11 | **Buyer Brochure** | Mineral / parcel spec sheet for buyer outreach | PDF deliverable | PDF | Tier 1 | extreme |
| 12 | **Booth / Event Kit** | Conference booth design + presentation deck | trade fairs / investor days | PNG + PPTX bundle | Tier 2 | high |

The class set is closed — new classes require a registry extension and a passing smoke test.

---

## 3. The CampaignRecipe contract

TypeScript sketch:

```typescript
export interface CampaignRecipe {
  readonly id: string;
  readonly version: number;
  readonly status: 'draft' | 'shadow' | 'live' | 'locked' | 'deprecated';
  readonly assets: ReadonlyArray<CampaignAsset>;
  readonly sequencing: SequencingRule;          // 'parallel' | 'cascading' | 'staggered'
  readonly audience_segments: ReadonlyArray<AudienceSegment>;
  readonly ab_testing: ABTestSpec | null;
  readonly success_metrics: ReadonlyArray<MetricThreshold>;
  readonly compliance: ComplianceContract;
  readonly authority_tier: 0 | 1 | 2;
  readonly brand: 'borjie';
  readonly compose: (ctx: CampaignComposeContext) => Promise<CampaignArtifact>;
}

export interface CampaignAsset {
  readonly id: string;
  readonly class: MarketingClass;
  readonly channel: Channel;
  readonly recipe_ref: { kind: 'document' | 'media' | 'marketing'; id: string };
  readonly variant_count: number;
  readonly publish_authority_tier: 0 | 1 | 2;
}

export type Channel =
  | 'linkedin_organic' | 'linkedin_ads'
  | 'x_organic' | 'x_ads'
  | 'meta_organic' | 'meta_ads'
  | 'tiktok_organic' | 'tiktok_ads'
  | 'youtube_organic' | 'youtube_ads'
  | 'google_ads' | 'email' | 'web_landing'
  | 'pr_wire' | 'rss' | 'podcast';

export type AudienceSegment =
  | 'mining_owner' | 'mineral_buyer' | 'institutional_investor' | 'regulator'
  | 'industry_partner' | 'mining_journalist' | 'general_public';

export interface ABTestSpec {
  readonly variant_count: number;
  readonly traffic_split: ReadonlyArray<number>;
  readonly min_sample_size: number;
  readonly significance_alpha: number;
  readonly auto_promote_winner: boolean;
}

export interface ComplianceContract {
  readonly claims_must_cite: boolean;
  readonly forbidden_phrases: ReadonlyArray<string>;
  readonly required_disclaimers: ReadonlyArray<string>;
  readonly geo_restrictions: ReadonlyArray<string>;
}
```

Campaign recipes are **versioned** like document recipes. A live campaign recipe never mutates in place — improvements create version `n+1` in `shadow`, promoted to `live` only after owner approval. Locked recipes refuse mutation; only the lock/improve worker (with explicit Tier-2 approval) can unlock.

---

## 4. The 4 Layers of Marketing Composition

### Layer 1 — Campaign Intent

The owner says "announce the Geita pilot results" or a research-loop fires an autonomous proposal ("Q3 commodity prices are bullish — propose a buyer-acquisition campaign"). The MD selects an existing `CampaignRecipe` or composes a new one via the LLM `compose_campaign_v1` tool. Selection is via an intent → recipe table, not fuzzy matching.

### Layer 2 — Per-Asset Composition

For each asset in the recipe, delegate to the right sub-layer:

- **Text-only asset** → the Marketing Studio LLM composer with audience-segment system-prompt prefix
- **Image-heavy asset** → the media-generation layer (Wave 18N) with audience-aware brand-lock prompt
- **Video asset** → the media-generation layer video sub-layer
- **Long-form text** → the document composition layer (Wave 18C) with marketing brand-skin

Each asset gets composed with the audience segment + channel constraints + claims-citation requirements as input. Recipes never write raw copy — they declare structure + segment + claim-keys, and the composer assembles.

### Layer 3 — Brand-Locked + Compliance Validation

Every composed asset passes through five validators before publish:

1. **Brand validator** — OKLCH palette density, typography tokens, wordmark presence, Border Studio rules.
2. **Claims validator** — every factual claim must include `[cite:CITATION_ID]` inline, resolving to a corpus chunk, research result, or measurement record.
3. **Forbidden-phrase scanner** — rejects "guaranteed returns", "risk-free", "FDA-approved" (or jurisdictional equivalents), unverifiable superlatives.
4. **Disclaimer presence check** — investor + PR materials must carry "Past performance does not predict future results" and equivalents.
5. **Geo-restriction filter** — some claims OK in TZ but not in US/EU. Filters per channel destination + visitor IP segmentation.

A failure aborts publish with a structured error code; never silently drops or rewrites a claim. The owner sees a structured "why I refused" message and can revise.

### Layer 4 — Channel Publish + Performance Tracking

Each asset goes through:

- **Channel-native formatter** — LinkedIn 3000-char limit, X 280-char, Instagram caption-only 2200-char, YouTube description 5000-char, email subject 78-char, etc.
- **Channel adapter** — publishes via API, with Tier-2 owner approval gate when required. Mock in tests; env-gated graceful degradation when keys absent.
- **UTM tag injection** — every clickable URL carries `utm_source=mr_mwikila&utm_medium=<channel>&utm_campaign=<recipe_id>&utm_content=<variant_id>`.
- **Pixel + conversion tracking** — embeds the platform pixel (Meta, LinkedIn Insight Tag, Google gtag) plus a privacy-first first-party event writer to `marketing_telemetry_events`.
- **Per-asset telemetry** — impressions, CTR, dwell time, conversions, attribution.
- **Feedback loop** — performance signals feed the lock/improve policy.

---

## 5. SOTA tool picks for 2026

### Copy generation

| Tool | Role | Why |
|---|---|---|
| **Anthropic Claude Sonnet 4.7 (1M)** | Primary long-form copy | Highest narrative coherence, strongest claim-tracking |
| **Claude Haiku 4.5** | High-volume social posts | 90% of Sonnet quality at 1/3 the cost — perfect for daily organic |
| **GPT-5 Mini** | Fallback ad-platform copy | Google / Meta inference engines favor their own training distributions |

### Visual generation

Delegates to Wave 18N — Flux 1.1 Pro Ultra, Ideogram 3, Recraft v3, Imagen 4, plus self-hosted SD 3.5 fallback.

### Video generation

Delegates to Wave 18N — Runway Gen-4 (primary), Sora 2 (narrative), Seedance 2.0 (Asia-region), Luma Dream Machine 2 (fast iteration), Kling 2.5 (CN-language).

### Voiceover + lipsync

ElevenLabs Multilingual v3 (already wired in `packages/audio-capture/`); Hedra Character-3 + HeyGen V5 for lipsync.

### Channel APIs

- **LinkedIn** — Marketing Developer Platform v202401
- **X** — API v2 (paid tier for publish)
- **Meta** — Graph API v19 (Facebook + Instagram)
- **TikTok** — TikTok Marketing API
- **YouTube** — Data API v3
- **Google Ads** — API v15
- **Email** — Resend (already wired via `RESEND_API_KEY`); MJML for responsive HTML templates
- **Landing pages** — Next.js dynamic routes via `apps/marketing/`; Vercel Edge config for variant routing
- **PR wire** — generic XML / IPTC NewsML feed; AP, Reuters Connect, Africa News Agency adapters

### SEO + schema

- schema.org JSON-LD per page (Organization, NewsArticle, Product, BreadcrumbList)
- OpenGraph + Twitter Cards
- sitemap.xml auto-injection
- Lighthouse-tested CLS / LCP budgets (CLS <0.1, LCP <2.5 s)

### Performance tracking

- **Analytics** — PostHog or Plausible (privacy-first, EU + TZ-compatible regional hosting)
- **UTM scheme** — `utm_source=mr_mwikila&utm_medium=<channel>&utm_campaign=<recipe_id>&utm_content=<variant_id>`
- **Conversion writer** — first-party event tracker writing to `marketing_telemetry_events`
- **Attribution model** — last-touch with 7-day window (configurable per campaign)

### A/B testing

- **GrowthBook** (open-source) for cross-channel variant orchestration
- Bayesian inference with early-stopping rule — promote when `posterior_prob > 0.95` AND `samples >= min_sample_size`

---

## 6. Audience-Segmented Composition

Different audiences require different framing. The composer reads the segment + the campaign intent and assembles a tailored brief for the asset composer. Each segment has its own system-prompt prefix:

| Segment | Primary framing |
|---|---|
| `mining_owner` | Operational efficiency, ROI per truck-hour, regulatory reduction, time-to-Tumemadini |
| `mineral_buyer` | Assay quality, provenance, biometric contracts, parcel availability, price competitiveness |
| `institutional_investor` | Unit economics, regulatory moats, AI defensibility, TAM, payback |
| `regulator` | Compliance posture, audit-chain transparency, PDPA alignment, data-residency |
| `industry_partner` | Integration depth, MCP coverage, joint go-to-market, technical interoperability |
| `mining_journalist` | Data, citations, contrarian angles, founder narrative, on-record sources |
| `general_public` | Tanzania national interest, formalisation story, jobs created, environmental stewardship |

Segment prompts are composable — campaigns targeting two segments (e.g. investor + journalist) get a merged prompt with both framings prioritised.

---

## 7. A/B & Multivariate Testing Loop

On campaign launch:

1. MD generates `variant_count` versions of each high-leverage asset (typically landing pages, ad creatives, email subject lines).
2. Traffic split per `ABTestSpec` — even split by default, weighted when prior variants exist.
3. Telemetry aggregates per variant in `marketing_telemetry_events`.
4. Bayesian win-probability is computed per variant via the `bayes-decider` module.
5. Auto-promote winner when `posterior_prob > 0.95` AND `samples >= min_sample_size`.
6. Losing variants are archived (never deleted — audit trail).
7. Winning variant version-bumps the recipe (`n+1` in `live`); the prior version is retired but retained.

The loop is gated by recipe `auto_promote_winner: false` for Tier-2 campaigns — the winner still requires owner approval to promote.

---

## 8. Claims Citation Enforcement

Every factual claim in published marketing must cite back to one of:

- **Owner data** — e.g. "Our Geita site produces 12 g/t average ore grade" → cite Borjie ledger / assay certificate.
- **Research result** — e.g. "Tanzania mining grew 13% YoY in 2025" → cite Bank of Tanzania quarterly report (via Deep Research span citation).
- **Corpus regulation** — e.g. "Tumemadini certificates are valid for 12 months" → cite the regulation clause.

The composer's LLM call includes a system rule: every numeric, dated, or regulatory claim must include `[cite:CITATION_ID]` inline. The validator (`compliance/claims-validator.ts`) strips marketing of any claim that lacks a resolvable citation — or, depending on policy, flags it to the owner for citation provision before publish.

This is the same "cite or stay silent" rule the manifesto applies to the brain, lifted to the public-facing surface.

---

## 9. Authority Tier Map for Marketing

| Tier | Asset classes | Behaviour |
|---|---|---|
| **Tier 0** | SEO article drafts, internal performance dashboards, audience research reports | Auto-publish to owner only; never reaches public surfaces. |
| **Tier 1** | Social posts (single + thread), email newsletters, blog posts, short video shorts, A/B variant drafts | Owner sees in approval queue; auto-promotes after 24 h unless rejected. |
| **Tier 2** | PR releases, investor materials, paid ads (Google/Meta/TikTok), landing pages with conversion CTAs, long-form video (>1 min) | Owner approval required before public publish. No auto-promote. |

The tier of an asset is the **max** of its recipe tier and its channel tier — a Tier 1 social post promoted to LinkedIn Ads (Tier 2 channel) inherits Tier 2 gating.

---

## 10. Cost + latency budgets per asset class

| Class | Cost ceiling (USD) | Latency ceiling |
|---|---|---|
| Social Post Single | $0.30 | 60 s |
| Social Thread | $0.50 | 120 s |
| Short Video Spot (6–30 s) | $2.00 | 5 min |
| Long Video Story (1–10 min) | $15.00 | 30 min (Tier 2 owner-confirm) |
| Paid Ad Creative (5 variants) | $5.00 | 10 min |
| Email Campaign (HTML + plaintext) | $0.80 | 90 s |
| Landing Page (HTML + 2 variants) | $3.00 | 5 min |
| SEO Article (1500-word) | $1.00 | 3 min |
| Press Release | $1.50 | 5 min |
| Investor One-Pager | $2.00 | 5 min |
| Buyer Brochure | $3.00 | 10 min |
| Booth / Event Kit | $20.00 | 1 h (Tier 2 owner-confirm) |

Budgets are enforced by `budgets/cost-tracker.ts` — reserve at intent, commit at publish, release on abort.

---

## 11. Anti-patterns

The marketing studio refuses to:

- Publish marketing without owner-cited claims (every claim must have a citation).
- Auto-publish Tier 2 assets without owner approval.
- Skip the compliance + forbidden-phrase scan.
- Render off-brand (raw colors, non-token fonts, no wordmark).
- Embed tracking pixels without a consent banner where required (EU PDPA-equivalent).
- Leak cross-jurisdictional claims (US-restricted claim shown to US visitor; EU GDPR-restricted to EU visitor).
- Skip audit-chain entry — every publish writes a chain link.
- Skip telemetry — every publish embeds a UTM tag set.

---

## 12. DDL Schema additions

```sql
CREATE TABLE campaign_recipes (
  id text NOT NULL,
  version int NOT NULL,
  status text NOT NULL,
  authority_tier smallint NOT NULL,
  audience_segments text[] NOT NULL,
  compose_fn_ref text NOT NULL,
  sequencing text NOT NULL,
  compliance jsonb NOT NULL,
  success_metrics jsonb NOT NULL,
  brand text NOT NULL DEFAULT 'borjie',
  promoted_at timestamptz,
  promoted_by text,
  locked_at timestamptz,
  PRIMARY KEY (id, version)
);

CREATE TABLE campaign_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  recipe_id text NOT NULL,
  recipe_version int NOT NULL,
  status text NOT NULL,
  audience_segment text,
  triggered_by text NOT NULL,
  approved_by text,
  approved_at timestamptz,
  launched_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaign_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES campaign_runs(id),
  channel text NOT NULL,
  asset_class text NOT NULL,
  variant_id text NOT NULL,
  artifact_ref jsonb NOT NULL,
  publish_state text NOT NULL DEFAULT 'pending',
  published_at timestamptz,
  channel_post_id text,
  utm_tags jsonb,
  audit_hash text NOT NULL
);

CREATE TABLE marketing_telemetry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES campaign_assets(id),
  event_kind text NOT NULL,
  channel text NOT NULL,
  visitor_segment text,
  payload jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketing_ab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES campaign_runs(id),
  variant_id text NOT NULL,
  samples int NOT NULL,
  conversions int NOT NULL,
  bayes_posterior numeric(5,4),
  is_winner boolean,
  promoted_at timestamptz
);

CREATE TABLE marketing_compliance_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES campaign_assets(id),
  uncited_claims jsonb,
  forbidden_phrases_found text[],
  missing_disclaimers text[],
  geo_restriction_flags text[],
  scan_passed boolean NOT NULL,
  scanned_at timestamptz NOT NULL DEFAULT now()
);
```

RLS uses the canonical `app.tenant_id` GUC pattern; `campaign_recipes` is global (no tenant_id), the run / asset / telemetry / AB / compliance tables are tenant-scoped via the run parent.

---

## 13. Lock / Improve Loop

Mirrors document + UX layers. Engagement events feed `marketing_telemetry_events`. A future `services/marketing-evolution-worker/` aggregates per-recipe signals daily; when a variant beats the live version by a statistically significant margin AND passes compliance + brand checks, the worker creates a `proposed_version` in `shadow`. Owner approves or rejects via the queue. Locked recipes are immune to auto-improvement.

---

## 14. Open Questions for Phase 3

- Multi-tenant brand-skin overlays for partner-co-branded campaigns.
- Cross-channel consistency model when LinkedIn allows 3000 chars and X allows 280.
- Real-time personalisation vs. fixed traffic split for landing pages.
- Live-action shoot integration when AI video is insufficient.
- PR-wire adapter default (Africa News Agency vs. Reuters Connect).

---

## 15. Anchor — the founder's covenant

The 12-class marketing studio is the public face of the manifesto. Every campaign cites its claims. Every variant is brand-locked. Every publish is audit-chained. Every Tier 2 asset waits for the owner's signoff. The MD does not push send on a press release they have not read; the MD does not auto-promote a winning variant of a paid ad without the owner's nod. The lock/improve loop earns trust the same way a senior managing director earns it — by being right repeatedly, and by being visibly correctable when wrong.

This is the public-facing surface above the internal layers. It must be SOTA in 2026 — and structurally ready to remain SOTA when the channel APIs change in 2027 and the SOTA models change in 2028.
