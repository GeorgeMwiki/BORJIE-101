# Capabilities Unification — Mr. Mwikila as Universal Creator

> Wave 18Q / cross-layer framing — the unifying contract that ties the five
> atomic-capability specs into a single universal-creation surface for the
> Master Brain (Mr. Mwikila).

Status: design-spec. No runtime side-effects beyond the kernel meta-tool
`compose_anything_v1` (added in this wave) — every underlying capability
remains the primary entry point in its own right.
Brand: Borjie. Persona: Mr. Mwikila (Managing Director).
Charter: [`Docs/MASTER_BRAIN_AUTONOMY_MANIFESTO.md`](../MASTER_BRAIN_AUTONOMY_MANIFESTO.md).

Sibling specs — the five atomic capabilities being unified here:

1. [`Docs/DESIGN/DEEP_RESEARCH_SPEC.md`](./DEEP_RESEARCH_SPEC.md) — Wave 17C / 18D / 18E.
2. [`Docs/DESIGN/ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md) — Wave 17B / 18B / 18F.
3. [`Docs/DESIGN/DOCUMENT_COMPOSITION_SPEC.md`](./DOCUMENT_COMPOSITION_SPEC.md) — Wave 17D / 18C / 18G.
4. [`Docs/DESIGN/MEDIA_GENERATION_SPEC.md`](./MEDIA_GENERATION_SPEC.md) — Wave 18N.
5. [`Docs/DESIGN/MARKETING_PROMOTION_SPEC.md`](./MARKETING_PROMOTION_SPEC.md) — Wave 18P.

Loops + autonomy: [`Docs/DESIGN/AUTONOMOUS_LOOPS_SPEC.md`](./AUTONOMOUS_LOOPS_SPEC.md).

---

## 1. The Correction

Founder, verbatim:

> "The power is for creating any doc or media at any moment. The intelligence and power is not necessarily for marketing and campaign alone. User can just say 'make this report' or 'make me this image for marketing this property' — and if you have the data (which you should), Borjie should be able to create anything since it has access to all tabs data etc for that org or user depending on user and need. This is what we want to be SOTA. I like the chain above too — but does it do the same thing? Like we can create an image before a doc and have it in a doc, or just an image not involving a doc, or just a doc, etc. — and all are SOTA."

The architectural correction is unambiguous: the five sibling specs are not a
**stack** (research → UX → docs → media → campaigns, in that order) and not
a **pipeline**. They are **five atomic capabilities** that Mr. Mwikila
invokes freely, in any combination, in any order.

The Master Brain is the **universal creator**. Ask for an image, get an
image — not a 12-asset campaign. Ask for a document, get a document — not a
research-doc-campaign chain. Ask for a campaign, get a campaign that
internally invokes media, docs, research, and tabs as sub-capabilities.
Chain three turns ("image", then "embed it in a doc", then "announce to
investors") and get three artefacts, each citing the previous one.

The misframing this document corrects: treating marketing as the apex
capability that subsumes the others. Marketing is one of five capabilities,
and it is the one Mr. Mwikila reaches for least often. Most owner intents
map to a single atomic capability.

---

## 2. The Five Atomic Capabilities

### 2.1 `research_v1` — grounded evidence

Runs a multi-step agentic search over corpus, web, regulator feeds,
commodity tickers, and the LMBM. Returns a `ResearchSessionHandle` and
span-cited claim trees the other capabilities can consume. Spec: [`DEEP_RESEARCH_SPEC.md`](./DEEP_RESEARCH_SPEC.md)
(Wave 17C / 18D / 18E).

> Example: owner says "gold prices this week, with Tumemadini royalty
> implications" → `research_v1` only. Output: a citation-anchored briefing.

### 2.2 `compose_tab_v1` — ephemeral interactive surface

Composes a typed, brand-locked tab schema (fields, labels, evidence chips,
prefilled data joins) and renders it through `@borjie/design-system`. Spec:
[`ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md) (Wave 17B / 18B / 18F).

> Example: owner navigates to a new-buyer flow → `compose_tab_v1` spawns a
> BuyerKYBStart tab with the company name, commodity, and tonnage prefilled.

### 2.3 `compose_doc_v1` — persistent artefact

Composes durable outputs (PDF, DOCX, PPTX, XLSX, MD) from a versioned
recipe + the owner's joined data + corpus citations. Spec: [`DOCUMENT_COMPOSITION_SPEC.md`](./DOCUMENT_COMPOSITION_SPEC.md)
(Wave 17D / 18C / 18G).

> Example: owner says "draft this month's Tumemadini return" →
> `compose_doc_v1` only. Output: a single PDF with the calc table and
> evidence anchors; owner-approval gate before filing.

### 2.4 `compose_media_v1` — brand-locked image + short video

Synthesises images and short-form video from a versioned recipe + brand DNA
+ safety + provenance discipline. C2PA invisible watermark + Borjie wordmark
+ authority-tier gates on every output. Spec: [`MEDIA_GENERATION_SPEC.md`](./MEDIA_GENERATION_SPEC.md)
(Wave 18N).

> Example: owner says "make me a hero image for parcel PRL-001" →
> `compose_media_v1` only. Output: a single still image with the parcel's
> grade, location, and tonnage rendered in.

### 2.5 `compose_campaign_v1` — coordinated multi-asset rollout

Orchestrates the four lower-level capabilities into a multi-channel,
audience-segmented, A/B-tested marketing rollout. Every asset cites its
evidence; brand + claims + disclaimer + geo validators gate publish. Spec:
[`MARKETING_PROMOTION_SPEC.md`](./MARKETING_PROMOTION_SPEC.md) (Wave 18P).

> Example: owner says "announce the Geita pilot to investors" →
> `compose_campaign_v1` internally calls research, doc, media, and tab.
> One owner approval covers the full campaign envelope.

---

## 3. Universal Data Access

Every atomic capability receives the same context object. The MD never asks
"where is the data?" — it joins from the same `OrgUserDataContext` every
time:

```typescript
export interface OrgUserDataContext {
  readonly tenant_id: string;
  readonly user_id: string;
  readonly available_tabs: ReadonlyArray<TabRef>;             // every workspace tab the user can see
  readonly available_data_joins: ReadonlyArray<DataJoinRef>;  // parcels, sites, contracts, KPIs, prices, FX
  readonly owner_profile: OwnerProfile;                       // preferences, language, mastery tier
  readonly corpus_handle: CorpusHandle;                       // regulatory rules, internal docs
  readonly research_session_handle: ResearchSessionHandle | null;
  readonly tenant_brand: TenantBrand;                         // Borjie default; customisable per tenant
  readonly authority_tier_max: 0 | 1 | 2;
}
```

This is the **canonical context type**. Every atomic capability reads from
this same shape. Tenant branding flows through `tenant_brand` so every
artefact (image, doc, tab, campaign) is brand-locked end-to-end.

The `authority_tier_max` field caps what any capability may execute on this
turn — Tier 0 (read / research) is unconditional, Tier 1 (drafts in DRAFT
state) is permitted by default, Tier 2 (publish, file, send, pay) requires
explicit owner approval surfaced above the line.

---

## 4. Composition Patterns

Five canonical patterns illustrate how the atomic capabilities combine.

### 4.1 Image standalone

`compose_media_v1(ctx)` → returns one `MediaArtifact`. The owner asked for
an image; the MD returned an image. No doc, no campaign, no tab.

### 4.2 Doc with embedded image

`compose_doc_v1(ctx)` whose recipe internally calls `compose_media_v1` for
each chart, photo, or hero panel and embeds the binary into the rendered
output. **One artefact is emitted** (the doc); the provenance of each child
media is recorded in the doc's audit chain.

### 4.3 Doc with research-cited claims

`compose_doc_v1(ctx)` whose composer reads `ctx.research_session_handle`. If
null, the composer invokes `research_v1` inline before any claim is
written, then attaches the citations to the doc footnotes.

### 4.4 Tab with pre-filled data

`compose_tab_v1(ctx)` whose composer reads `ctx.available_data_joins` and
populates form fields from the most recently joined buyer / parcel / site /
licence record. Citation chips render next to each prefilled field.

### 4.5 Campaign with everything

`compose_campaign_v1(ctx)` calls all of the others as sub-steps: research
for claim citations, docs for the PR body, media for hero stills and short
video, tab for the in-app launch hook. The campaign envelope is the only
owner-approval gate; sub-step Tier-2s roll up into the envelope.

### 4.6 Image → doc → campaign chain

Three owner turns, three artefacts. Turn 1: `compose_media_v1` returns
`media:abc`. Turn 2: owner says "embed that in the investor pack" —
`compose_doc_v1` references `media:abc` and embeds it. Turn 3: owner says
"announce this to investors" — `compose_campaign_v1` references `doc:xyz`
and ships. Each artefact's audit chain links to the previous one's hash.

---

## 5. The Dispatch Contract — `compose_anything_v1`

To make the universal-creator framing concrete, the persona kernel gains
**one new meta-tool**: `compose_anything_v1`. The MD invokes this when the
owner's intent is in natural language without naming the capability.

```typescript
export interface ComposeAnythingInput {
  readonly intent_natural_language: string;
  readonly hint_capability?: 'research' | 'tab' | 'doc' | 'media' | 'campaign'; // optional owner override
  readonly attach_data?: ReadonlyArray<DataJoinRef>;                            // optional explicit data attachments
}

export interface ComposeAnythingOutput {
  readonly chosen_capability: 'research' | 'tab' | 'doc' | 'media' | 'campaign';
  readonly chosen_recipe_id: string;
  readonly artifact_ref: { kind: string; id: string };  // the produced artifact
  readonly reasoning: string;                            // why this capability + recipe was chosen
  readonly authority_tier: 0 | 1 | 2;
  readonly cost_usd_cents: number;
  readonly duration_ms: number;
}
```

The MD's LLM call interprets the owner's intent and picks the **smallest
atomic capability that fits**. The reasoning string is logged +
audit-chained. Tier 2 outputs still gate on owner approval; the meta-tool
never bypasses the ladder, it picks the right Tier-2 sub-tool to ask for.

The dispatcher itself is **Tier 0** — no side effects beyond invoking its
chosen sub-tool. The sub-tool may be Tier 0, 1, or 2; the owner-approval
gate is raised at sub-tool dispatch time.

---

## 6. What This Is NOT

- **NOT a god-tool.** The atomic tools remain primary entry points. The MD
  calls `compose_doc_v1` directly when the owner says "draft the Tumemadini
  return" — the meta-tool exists for ambiguous intents, not as a funnel.
- **NOT routing-only.** The dispatcher invokes the chosen atomic tool and
  returns the produced artefact. Owners see artefacts, not routing.
- **NOT a way to bypass the authority ladder.** Tier 2 still requires owner
  approval — the meta-tool picks the right Tier-2 sub-tool to gate on.
- **NOT marketing-specific.** The default dispatch is the smallest atomic
  capability that fits — doc-only / image-only / tab-only — not a campaign.
- **NOT a recipe author.** The dispatcher selects an existing recipe;
  recipe authoring is the dynamic-author worker's job (Wave 18M).

---

## 7. Anti-patterns

Mr. Mwikila violates the universal-creator contract when he:

1. **Over-reaches.** Owner asks for an image, MD generates a 12-asset
   campaign. The smallest atomic capability that fits is the right one.
2. **Under-reaches.** Owner asks for a campaign, MD only delivers an image.
   The symmetric failure.
3. **Silently changes capability mid-turn.** The reasoning string in
   `ComposeAnythingOutput` exists to make every pivot visible.
4. **Invokes a Tier 2 capability without raising the owner-approval gate.**
   The meta-tool never suppresses the gate.
5. **Generates an artefact with stale or missing citations.** Cite or stay
   silent applies to every atomic capability.
6. **Drops brand DNA between capabilities.** OKLCH amber-signal palette,
   Fraunces × Geist × JetBrains Mono typography, and the Borjie wordmark
   apply equally to tabs, docs, media, and campaigns. `ctx.tenant_brand`
   is the single source of truth.

---

## 8. Implementation Map

| Capability | Primary package(s) | Wave |
|---|---|---|
| `research_v1` | `packages/ai-copilot/src/retrieval/`, `packages/document-analysis/`, `packages/mining-commodity-intelligence/`, `packages/regulatory-tz-mining/` | 17C / 18D / 18E |
| `compose_tab_v1` | `packages/tab-need-detector/`, `packages/central-intelligence/src/kernel/tools/`, `packages/chat-ui/` | 17B / 18B / 18F |
| `compose_doc_v1` | `packages/document-composer/` (Phase 2), `services/document-intelligence/` | 17D / 18C / 18G |
| `compose_media_v1` | `packages/media-generation/` | 18N |
| `compose_campaign_v1` | `packages/marketing-studio/` | 18P |
| `compose_anything_v1` (this wave) | `packages/ai-copilot/src/personas/tools/compose-anything.ts` — declared in the persona kernel; dispatches to sub-tools registered in `packages/central-intelligence/src/kernel/tools/`. | 18Q |

The dispatcher contains no business logic beyond intent classification and
authority-tier gate enforcement. Artefact-producing logic stays in the
capability packages.

---

## 9. User-facing identity is locked

The user always sees ONE string in every chat / floating-widget / home-shell surface: **"Mr. Mwikila — Borjie's AI Mining Operations Manager"** (or the Boss Nyumba equivalent). No specialisation subtitle. No agent_id. Mr. Mwikila is presented as ONE intelligence — the user never knows whether a turn was handled by the root MD or a scoped specialisation.

The specialisation / agent_id / subtitle remain in the data model for:
- Backend routing (which specialisation logic the LLM draws from)
- Audit logs (`agent_turns` / `cognitive_turns` capture the agent_id)
- Owner admin panel (ONLY surface where internal names appear)

Reference: `packages/agent-platform/src/canonical-display.ts` defines the single source of truth (`MR_MWIKILA_CANONICAL_DISPLAY`).

---

## 10. Cross-references

- Master operating manifesto: [`Docs/MASTER_BRAIN_AUTONOMY_MANIFESTO.md`](../MASTER_BRAIN_AUTONOMY_MANIFESTO.md)
- Autonomous loops spec: [`Docs/DESIGN/AUTONOMOUS_LOOPS_SPEC.md`](./AUTONOMOUS_LOOPS_SPEC.md)
- Deep research spec (Wave 17C / 18D / 18E): [`Docs/DESIGN/DEEP_RESEARCH_SPEC.md`](./DEEP_RESEARCH_SPEC.md)
- Anticipatory UX spec (Wave 17B / 18B / 18F): [`Docs/DESIGN/ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md)
- Document composition spec (Wave 17D / 18C / 18G): [`Docs/DESIGN/DOCUMENT_COMPOSITION_SPEC.md`](./DOCUMENT_COMPOSITION_SPEC.md)
- Media generation spec (Wave 18N): [`Docs/DESIGN/MEDIA_GENERATION_SPEC.md`](./MEDIA_GENERATION_SPEC.md)
- Marketing & promotion spec (Wave 18P): [`Docs/DESIGN/MARKETING_PROMOTION_SPEC.md`](./MARKETING_PROMOTION_SPEC.md)

---

This document is the unification contract. Whenever an engineer reaches for
"build a new feature that generates X", the answer is: it is one of the
five atomic capabilities (or a recipe-driven composition of them), invoked
through the same `OrgUserDataContext`, gated by the same authority ladder,
audit-chained by the same hash-chain. There is no sixth capability. There
is no special path. There is only Mr. Mwikila — the universal creator.
