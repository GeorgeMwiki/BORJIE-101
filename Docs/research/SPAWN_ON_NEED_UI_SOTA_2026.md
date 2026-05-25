# Spawn-on-Need UI — 2026 State of the Art

**Author:** Research pass for BORJIE Piece-B+ planning
**Date:** 2026-05-22
**Audience:** Architects deciding how UI should appear, evolve, and
disappear per user and per tenant — without ever shipping a hard-coded
tab list.
**Vision under test:** *"If a user isn't using compliance, why have a
Compliance tab? It only appears once compliance becomes a need for that
user. The fields, the layout — everything depends on the person's
needs."*

This is **detect-need → propose-spawn → user-accepts → tab materialises**,
not the easier "user types `/compliance`" path that already ships in
Piece B.

---

## §1 — Spawn-on-need products surveyed

A 2026 snapshot. None of these fully realise the vision; all of them
contribute fragments worth stealing.

| Product | Score | Honest take |
|---|---|---|
| **Anthropic Claude Skills** (Oct 2025 GA) [1][2] | 4 | Progressive disclosure — metadata pre-loaded, body lazy-loaded — is the most defensible LLM-side spawn primitive shipping. Adopt wholesale. |
| **OpenAI GPT Store / Custom GPTs** | 1 | Pull-discover, not detect-spawn. Naming patterns only. |
| **Computer Use / Operator** | 0 | Operates existing UI, doesn't reshape it. |
| **v0.app** [3] | 2 | Prompt to React/Tailwind. No detect stage. |
| **Lovable** [3][4] | 2 | Conversational full-stack with shadcn/ui defaults. Explicit ask only. |
| **Bolt.new** [3][4] | 2 | In-browser multi-framework. Developer-facing v0. |
| **Retool AI App Builder** [5] | 3 | Schema to form/table is a real spawn-on-data signal. |
| **Airtable Cobuilder / Omni** [5] | 3 | First product to put a *suggestion* in the prompt itself — proto detect-spawn. |
| **Power Platform Maker + Copilot** [6] | 3 | Multi-agent workspace derives roles, schema, apps from a problem statement. |
| **Salesforce Agentforce** [7] | 4 | "Topic creation": admin describes need, Agentforce builds agent + minimal UI. Granular spawn target. |
| **HubSpot Breeze** [7] | 3 | LinkedIn-style "are you hiring?" modal is the cleanest detect-spawn pattern. Steal it. |
| **Notion AI Pages / Databases / 3.0 Agents** [8] | 4 | Layout-as-data native. Views = JSON. 20-min autonomous agent always shows the plan first. |
| **Asana AI Workflow Builder** | 2 | Catalogue-pick, not generative. |
| **Glide AI Generator** [5] | 2 | Sheet to mobile app, one-shot. |
| **Mendix Maia** | 2 | Catalogue + templates. |
| **Manus AI** [9] | 1 | Split-screen "Manus's Computer"; UI is the agent's workspace, not the user's. |
| **Claude Artifacts / ChatGPT Canvas** [10][11] | 3 | Versioned inline vs side workspace. Artifact-as-spawnable-tab approximates Piece-G. |

**Aggregate finding.** Nobody ships the end-to-end *detect → propose →
spawn → personalise → mastery-gate* loop. The pieces exist; nobody has
assembled them into a coherent product. That is the opportunity.

---

## §2 — Detect-need-then-spawn — the hard part

The product question is not "how do we render dynamic tabs?" (Piece B
solved that). It is "what signal flips the predicate from false to
true, and how confident must we be before we interrupt the user?"

### 2.1 Signal taxonomy

Four classes, in order of unambiguity:

1. **Document signals (highest confidence).** Contract uploaded → LEGAL.
   KRA filing PDF → TAX_FILINGS. Staff roster CSV → HR. The
   `packages/document-analysis` pipeline already ships; the missing
   piece is the *signal emission* hook on classification.

2. **External signals.** Regulator notice (TRA EMU above turnover X),
   fiscal-year boundary, headcount crossing a threshold. Deterministic
   — never ML. Cron emissions or webhook subscribers.

3. **Behaviour signals (medium confidence).** Repeated manual
   workarounds (same export 3 months running with the same column
   edits), zero-result searches, frustration markers (rapid-fire
   resubmits, repeated undo). Literature [12][13]: behaviour flags in
   the first 7–14 days predict retention 40% better than demographics.

4. **Conversation signals (lowest confidence).** Explicit ("I need
   compliance") is easy. Implicit — NER finds compliance entities in
   the past 30 turns — is hard. Claude Skills `description`-based
   triggering [1] under-triggers more than it over-triggers; this
   generalises.

### 2.2 Over-eager vs under-eager

NN Group [14] and OWASP 2025 [15] both lean conservative: **prefer
under-eager, ask the user.** Claude undertriggers skills by design [1] —
Anthropic ate the data on how badly over-eager spawning erodes trust.
Mirror that. CI-able metrics:

- `spawn_offer_acceptance_rate` ≥ 60% (below = over-eager)
- `dismissed_then_needed_within_30d` ≤ 10% (high = under-eager)
- `time_to_first_spawn` per signal class

### 2.3 How real products decide

Linear Custom Views [16] are purely user-driven — no detection.
Notion [8] can create a database from a phrase but never auto-spawns
inside an existing one. HubSpot/LinkedIn ship the *contextual question*
("are you hiring?"), never autonomous creation. Salesforce Agentforce
Topics [7] gate on a human intent statement.

**Universal pattern.** Zero shipping products auto-create UI without an
explicit yes. Every "smart" detect-spawn product offers; never imposes.

---

## §3 — Per-user / per-tenant layout generation

Three competing models in 2026:

- **Filter-as-view (Linear / Notion)** — saved filter+sort+group on a
  static schema. Cheap, debuggable, no LLM. BORJIE's
  `packages/dynamic-sections` already does this via `VisibilityPredicate`
  (`has-entities`, `role-allowed`, `feature-flag`, `and`, `or`). Extend
  for layout, not just visibility.
- **Adaptive layout (Material 3 / Apple)** — responds to window class
  and user state, not user filters. Material 3 ships canonical layouts
  [17]; SwiftUI does the same via `GeometryReader` + Dynamic Type [18].
  This is *device adaptivity*, not *user adaptivity* — necessary but
  insufficient for "Compliance tab appears."
- **LLM-generated layouts (v0 / Lovable / Bolt)** — converging on
  shadcn/ui + Tailwind v4 + OKLCH [3][4]; LLM picks from a known
  primitive set, not arbitrary HTML. This is the "generative UI on
  rails" pattern Piece-G's catalog already enforces.

**Refactoring UI principles still apply** [19] — visual hierarchy by
size+colour+placement, then whitespace, then typography. Honour them in
the *templates* the spawn system picks from.

**Layout-as-data is non-negotiable.** Notion blocks [8], GitHub custom
views, Linear Views — every shippable solution treats layout as JSON,
never JSX. JSX in core is a security and i18n hazard (see §4–§5).

---

## §4 — Zero-hardcoded principles

Hard rules for a product where every user gets a different shape:

1. **i18n — every string is a key.** `t('forms.save')`, never `"Save"`.
2. **Roles — tenant-defined titles, tier-mapped capabilities.** Piece D
   ships this; never branch on a literal role string.
3. **Entity types — data-driven via Piece A registry.**
4. **Currency / jurisdiction — resolved at request time.**
   `formatCurrency(amount, currencyCode)` only.
5. **Layout — JSON-driven.** Never JSX in core. Piece-G's 32-component
   catalog already enforces this; extend to `tab_layouts` and
   `panel_layouts`.
6. **Tools — registry + manifest.** Claude Skills pattern [1]: name +
   description + lazy-loaded body.

**CI scanners to add** on top of the existing j7 zero-hardcoded suite:
layout literals in non-test source, tab keys in non-registry source,
role-string compares outside `policy-gate.ts`, JSX returned from any
tool call, `dangerouslySetInnerHTML` outside the DOMPurify-wrapped
artifact renderer.

---

## §5 — Anti-patterns to avoid

Confirmed by the Vercel AI SDK 5 architecture debate [20] and OWASP LLM
Top-10 2025 [15]:

1. **LLM emits raw JSX/HTML.** v0/Lovable get away with it because
   output is dev-reviewed; in a production runtime, prompt-injection
   XSS is the textbook case the A2UI critique [20] highlights.
   Mitigation: LLM emits tool-call args that select+parameterise
   pre-registered components — Piece-G's pattern already.
2. **LLM emits raw SQL.** Same reasoning, worse blast radius — RLS
   bypass. Only constrained primitive specs cross the LLM boundary.
3. **Per-tenant runtime migrations.** Adaptive schema is a supply-chain
   risk; new per-tenant fields live in `attributes_jsonb`, never as
   columns.
4. **Hiding critical safety actions.** Kill-switch, audit-log link,
   policy-violation banner: always visible regardless of mastery, role,
   or layout. NN Group [14]: hidden critical actions are accessibility
   failures.
5. **"Smart" UI users can't predict.** NN Group [14] and Nielsen's own
   critics [21] are blunt: interfaces that rearrange without warning
   destroy learnability. Every spawn event announced, every layout
   change reversible.
6. **Auto-spawn without consent.** Even Notion's 20-minute autonomous
   agent [8] shows the plan first. Match that.

---

## §6 — Generative UI streaming

Vercel AI SDK 5 [20][24] introduced typed `UIMessage`/`ModelMessage`,
agentic loop control, tool-input streaming. The most important 2026
architecture debate: **transport React component trees (Vercel
default) vs transport JSON data (A2UI alternative)** [20]. For
BORJIE's finance and compliance surfaces, JSON-data wins; the
catalog whitelist is the security boundary.

Claude Artifacts (inline, git-like version history) vs ChatGPT Canvas
(side workspace, back-button restore) [10][11]. Claude added inline
SVG charts March 2026 drawing between paragraphs.

For BORJIE: Piece G already ships 32 component types with the
catalog as security boundary, projector to AgUiUiPart, and SSR for
email/WhatsApp. **The gap is the promotion path from artifact to
persistent tab** — once an artifact has been opened 3+ times, offer to
pin it.

---

## §7 — Mobile considerations

Africa-realistic [22]: 75% mobile traffic, intermittent power,
fluctuating bandwidth, 2Africa cable landings only finishing late 2025.

1. **Push-spawn vs pull-discover.** A tab cannot just appear on mobile;
   the user opens the app on the train and is bewildered. Pattern:
   push notification + foreground bottom-sheet that the user
   acknowledges before the tab is pinned into navigation.
2. **Offline-first.** Tab spawned but data not synced — show skeleton,
   not empty state. react-query + IndexedDB + service-worker; sync on
   next online tick.
3. **Per-device personalisation.** Same user across phone + laptop:
   different *layouts* are fine; different *available tabs* are not.
   Spawn state is per-tenant-user, not per-device.
4. **Native adaptive layouts.** Material 3 Adaptive [17][25] and
   Flutter LayoutBuilder [18] handle the *responsive* axis. The
   *spawn* axis is orthogonal and must live in the same Section
   registry as web.

---

## §8 — Implementation recommendations for BORJIE

### 8.1 Tables to add (Drizzle migrations, append-only)

```sql
-- Raw observations from the four signal classes
tab_spawn_signals (
  id, tenant_id, user_id, signal_class,        -- document|external|behaviour|conversation
  signal_source,                                -- module/cron name
  proposed_section_key,                         -- joins ai-copilot module registry
  confidence_numeric,                           -- 0..1
  evidence_jsonb,                               -- raw payload (audit only)
  observed_at, dedupe_hash
)

-- One row per *offer* shown to a user (not per signal)
tab_spawn_proposals (
  id, tenant_id, user_id, section_key,
  offer_surface,                                -- banner|modal|chat|notification
  offer_message_key,                            -- i18n key
  outcome,                                      -- accepted|dismissed|expired|auto_revoked
  decided_at, snoozed_until
)

-- Per-user layout overrides on top of tenant defaults
tab_personalization (
  tenant_id, user_id, section_key,
  pinned, sort_override, density,               -- compact|comfortable|spacious
  mastery_level,                                -- novice|practitioner|expert
  updated_at
)

-- Per-tenant layout overrides on top of platform defaults
layout_overrides (
  tenant_id, scope, section_key,
  layout_jsonb,                                 -- catalog-constrained
  approved_by_user_id, approved_at
)
```

All four are RLS-FORCED, RLS-keyed on `tenant_id`. Audit chain entries
on every accept/dismiss go to the existing hash-chained audit table.

### 8.2 Need-detection cron / streaming subscriber

Three runners:

- **Document signal subscriber** — hooks the `document-analysis`
  classifier; emits to `tab_spawn_signals` on confident classification.
- **External signal cron** — hourly, joins regulator + fiscal calendars.
- **Behaviour signal materialised view** — nightly aggregation of
  product-analytics events; only the *aggregate* crosses thresholds,
  never raw events.

Conversation signals are emitted by the brain's NER pass directly
(`packages/central-intelligence`), not by this cron.

### 8.3 Spawn-offer UX

Following HubSpot/LinkedIn's "are you hiring?" pattern [7] and Notion's
"plan first" pattern [8]:

| Confidence | Surface | Copy pattern |
|---|---|---|
| ≥ 0.85 | Persistent banner above main nav | "We noticed X. Want a Y tab?" |
| 0.60 – 0.85 | In-chat suggestion card | LLM offers; user accepts inline |
| 0.40 – 0.60 | Quiet notification badge | User must open to see |
| < 0.40 | Silent — log only | Visible in admin diagnostics |

Acceptance creates a row in `tab_personalization`; dismissal sets a
30-day cooldown on that `(section_key, user_id)`.

### 8.4 Per-user layout overrides on tenant defaults

Three-layer chain — *platform default → tenant override → user
override* — mirroring the existing currency preference chain
documented in user memory. Section visibility uses the union (any layer
shows = shown). Section *order* and *density* use the user-most-specific
layer.

### 8.5 Mastery-gate integration

Already shipped: UI-3 MasteryGate in `packages/chat-ui`. Plug it into
the layout chain: novice → fewer fields, comfortable density, more
hand-holding; expert → dense, more shortcuts visible, fewer banners.
This is the IDE-toolbar-by-proficiency pattern from progressive-
disclosure literature [23].

### 8.6 Five concrete design decisions

1. **JSON-only layout transport across the LLM boundary.** Never JSX.
   The Piece-G catalog is the security boundary; extend it to layouts,
   never to raw component code.

2. **Detect → offer → accept, never detect → create.** Even at
   confidence 0.99 the system asks. Adoption of Notion-3.0-style
   "show the plan first" is mandatory.

3. **Section registry stays the source of truth.** Spawn = flipping
   `tab_personalization.pinned = true` + writing into
   `layout_overrides`. The registry never gains rows at runtime; new
   sections ship in code reviews like everything else.

4. **Critical actions are pinned in code.** Kill-switch, audit-log
   link, policy-violation banner: `visibility_predicate = always_true`.
   No spawn / unspawn path may remove them.

5. **CI scanners enforce the rules.** Add lints for layout literals,
   tab-key literals, JSX-from-tools, role-string compares outside
   `policy-gate.ts`. Per the existing j7 hardening pattern.

---

## §9 — What to reject

Africa-realistic, opinionated:

- **Reject** the "fully LLM-generated runtime UI" vision. Cool demos,
  unshippable for finance + compliance. The catalog-on-rails pattern
  is correct.
- **Reject** auto-spawn without consent, regardless of confidence. The
  literature [14][15][21] is unanimous; ignore the hype.
- **Reject** per-device personalisation of *which tabs exist*. Same
  user across phone + laptop must have the same available tabs, or
  bewilderment results.
- **Reject** more than 3 banners on screen at once. Quiet UI > smart
  UI.
- **Reject** more than one auto-spawn offer per session unless the
  user has accepted the prior offer. Trust budget is finite.

---

## §10 — Sources

[1] [Equipping agents for the real world with Agent Skills — Anthropic](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
[2] [Introducing Agent Skills — Anthropic](https://www.anthropic.com/news/skills)
[3] [V0 vs Bolt.new vs Lovable: AI App Builder Comparison 2026 — NxCode](https://www.nxcode.io/resources/news/v0-vs-bolt-vs-lovable-ai-app-builder-comparison-2025)
[4] [Choosing your AI prototyping stack — Anna Arteeva, Medium](https://annaarteeva.medium.com/choosing-your-ai-prototyping-stack-lovable-v0-bolt-replit-cursor-magic-patterns-compared-9a5194f163e9)
[5] [10 Best AI App Builders for 2026 — Airtable](https://www.airtable.com/articles/best-ai-app-builder)
[6] [Inside the new Power Apps: The future of app development — Microsoft Power Platform Blog (Nov 2025)](https://www.microsoft.com/en-us/power-platform/blog/2025/11/18/inside-the-new-power-apps-the-future-of-app-development/)
[7] [HubSpot Breeze AI 2026 Complete Guide — SyncBricks](https://syncbricks.com/hubspot-breeze-ai-complete-guide-2026/)
[8] [Notion AI for databases — eesel AI](https://www.eesel.ai/blog/notion-ai-for-databases)
[9] [Manus AI Analytical Guide 2025 — BayTech](https://www.baytechconsulting.com/blog/manus-ai-an-analytical-guide-to-the-autonomous-ai-agent-2025)
[10] [Claude's Generative UI vs Canvas vs Artifacts — MindStudio](https://www.mindstudio.ai/blog/what-is-claude-generative-ui-vs-canvas-artifacts)
[11] [ChatGPT Canvas vs Claude Artifacts Technical Comparison — XsOne](https://xsoneconsultants.com/blog/chatgpt-canvas-vs-claude-artifacts/)
[12] [The Exact Framework for Intent-Based User Clusters — The Good](https://thegood.com/insights/intent-based-segmentation/)
[13] [Intent Prediction in 2026: Models, Taxonomy & Metrics — Prospeo](https://prospeo.io/s/intent-prediction)
[14] [Adaptive design topic hub — Nielsen Norman Group](https://www.nngroup.com/topic/adaptive-design/)
[15] [LLM01:2025 Prompt Injection — OWASP Gen AI Security Project](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
[16] [Custom Views — Linear Docs](https://linear.app/docs/custom-views)
[17] [Adaptive design — Material Design 3](https://m3.material.io/foundations/adaptive-design)
[18] [Best practices for adaptive design — Flutter Docs](https://docs.flutter.dev/ui/adaptive-responsive/best-practices)
[19] [Refactoring UI — Adam Wathan & Steve Schoger](https://refactoringui.com/)
[20] [A2UI vs Vercel AI SDK (2026 Edition): Architecture Deep Dive](https://hia2ui.com/blog/a2ui-vs-vercel-ai-sdk/)
[21] [On Nielsen's ideas about generative UI for resolving accessibility — Per Axbom](https://axbom.com/nielsen-generative-ui-failure/)
[22] [Why 2025 marked a turning point for African telecoms — TechCabal](https://techcabal.com/2025/12/23/how-pricing-fibre-and-5g-collided-in-african-telecoms-in-2025/)
[23] [The Power of Progressive Disclosure in SaaS UX Design — Lollypop](https://lollypop.design/blog/2025/may/progressive-disclosure/)
[24] [AI SDK 5 release — Vercel](https://vercel.com/blog/ai-sdk-5)
[25] [Goodbye Mobile Only, Hello Adaptive — Android Developers Blog (Dec 2025)](https://android-developers.googleblog.com/2025/12/goodbye-mobile-only-hello-adaptive.html)
