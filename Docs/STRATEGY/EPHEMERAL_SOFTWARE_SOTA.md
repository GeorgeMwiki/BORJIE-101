# EPHEMERAL_SOFTWARE_SOTA — Software becomes a derived runtime output

> **Founder directive (verbatim):** *"Every function can generate its own dashboards
> etc — basically Borjie starts to treat software as it has become ephemeral, can be
> generated, discarded and regenerated. Deep online research here. We need to be SOTA."*

This is an investor-grade master document. It explains why the next paradigm of
business software is not "software you write, deploy, and maintain", but **software
your domain functions generate on demand, the operator uses briefly, and the runtime
discards** — regenerated differently the next time the context shifts. It cites the
SOTA landscape across 15+ sources, documents what no incumbent has yet combined, and
explains why Mr. Mwikila — Borjie's single mind — is positioned to ship the first
defensible implementation in production for African mining tenants.

Author: Mr. Mwikila (Borjie's persona).
Companion design spec: `Docs/DESIGN/FUNCTION_ATTACHED_DASHBOARD_SPEC.md`.
Companion package: `packages/ephemeral-ui/`.

---

## 1. The paradigm shift

For sixty years, software has been an **artifact** — a thing engineers build, ship,
maintain, and version. The UI is a separate codebase from the domain logic. A
dashboard is a file. A form is a component. The act of using software is the act of
walking into a pre-built room. If the room does not suit your task, you wait two
quarters for the next sprint to build a new room. If you are a small operator in a
forgotten market, you wait forever.

Generative AI cracks this open. When the cost of producing a working UI drops from
"days of engineering" to "milliseconds of inference", the artifact model itself
becomes uneconomic. Andrej Karpathy captured the shift bluntly in his 2025
year-in-review when he described "vibe coding entire ephemeral apps just to find a
single bug because why not — code is suddenly free, ephemeral, malleable, discardable
after single use" ([catalaize.substack.com, 2025](https://catalaize.substack.com/p/andrej-karpathy-software-is-changing)).
Karpathy's accompanying disclaimer — *"Code is ephemeral now and libraries are
over"* — is not poetry. It is the new pricing model.

The opposite of the artifact model is the **runtime-output** model. The same domain
function that today returns a JSON payload (e.g. `project_fx_exposure(tenant, q3)`)
tomorrow returns a **runtime-composed dashboard** — chart, table, recommendation,
copy, locale, brand tokens, scope-appropriate redactions — produced fresh from the
function's output plus the operator's current context, lived briefly, discarded when
the operator closes the tab, regenerated differently when the context changes.

This is **software as a derived runtime output** of (function, context). It is what
the Ink & Switch malleable-software essay calls "a software ecosystem that smooths
the transition between using software and creating software" ([Ink & Switch, June
2025](https://www.inkandswitch.com/essay/malleable-software/)). It is what Anthropic
prototypes through Artifacts ([anthropic.com](https://www.anthropic.com/news/artifacts)).
It is what tldraw whispers through Make Real ([tldraw, 2024](https://makereal.tldraw.com/)).
None of them ship the complete loop. We will.

Borjie's bet is that for African mining operators — who *cannot* wait for global SaaS
vendors to model their tax regime, their language, their site-level safety law, their
buyer-network — **the only software that arrives in time is software that generates
itself in time**. Mr. Mwikila is that software.

---

## 2. The principle

Every function carries a latent UI manifest.

A pure domain function — say `project_fx_exposure(tenant_id, quarter)` in
`packages/fx-treasury-advisor/` — is conventionally a typed function that returns a
typed result. Under the ephemeral-software model, the same function additionally
declares a **`FunctionUIManifest`**: a tiny descriptor that says *"my output is best
visualised as a chart-with-table dashboard, sized for an owner reviewing on a
laptop, with brand-locked OKLCH colors from the borjie token set, emphasis on
narrative not data density, and the manifest is ephemeral by default with a 5-minute
cache window"*.

The composer reads the function's output, the manifest, and the operator's full
context (scope, mastery tier, locale, recent turns, memory recall, brand DNA), and
emits a **`TabRecipe`** — the same contract `packages/dynamic-ui/` already speaks —
on the fly. The TabRecipe is rendered, the operator uses it, the tab is closed, and
the recipe is discarded. The next time the operator asks the same kind of question,
the function is called again, the manifest is read again, the composer runs again
with the operator's *new* context, and a *different* recipe is produced — because
the context has changed.

The artifact is gone. The capability remains.

---

## 3. Five properties of ephemeral software

### 3.1 Function-attached

Every domain function declares its dashboard archetype. There is no separate UI
codebase to maintain. When `project_fx_exposure` is renamed, refactored, deleted, or
its output shape changed, the manifest moves with the function. Manifests live in
the same git commit as the function they describe. The UI never drifts from the
domain — because the UI does not exist between requests.

This is the inversion of the Retool pattern. Retool's AppGen ([retool.com,
2024](https://retool.com/blog/ai-generated-apps)) generates apps from natural
language and your schema, but the generated apps are then *saved as artifacts* that
must be maintained. Borjie generates apps too — but **discards them after use** and
regenerates next time. There is no "version skew" between the UI and the function
because there is no UI version.

### 3.2 Context-aware

The same function produces different UIs for different operators in different
situations. An owner of a mining cooperative who asks "show me Q3 FX exposure" sees
a narrative-first dashboard with the treasurer's recommendations and a one-click
hedge action. A site safety officer with no treasury authority sees the same numbers
rendered as a read-only summary with no actions exposed. An auditor sees a
compliance view with citations and hash-chain links.

Context-awareness is what makes ephemeral software better than persistent software,
not just cheaper. A pre-built dashboard cannot be all those things at once; it must
pick one and force the other two into "show all, hide nothing" or "show all, hide
some via permissions". Ephemeral software composes the right view in the moment.

This is the principle Hex Magic gestures at ([hex.tech, fall
2025](https://hex.tech/blog/fall-2025-launch/)) when its Threads agent takes a
natural-language question and returns a dashboard rather than a pre-built artifact.
The difference is that Hex stops at "data team gets a dashboard"; we go further to
*"the same function gives owner, worker, auditor, buyer their own scope-appropriate
view, every time"*.

### 3.3 Discarded by default

Closing the tab discards the generated UI. There is no implicit save. There is no
"recents" list. There is no version that persists to long-term storage.

This is the property that lets the system stay fast and stay honest. If the UI is
persistent, it must be maintained — which means engineering hours, version skew,
brand drift, and the slow ossification that turns every SaaS dashboard into a
museum of "previous quarter's idea of what mattered". If the UI is discarded by
default, none of that happens. The cost of being wrong is zero.

The Indigo AI essay "The End of Permanent UI" frames the same thesis: *"At runtime
we will have apps conjure from nothing and then simply fade away."*
([getindigo.ai](https://www.getindigo.ai/blog/the-end-of-permanent-ui)).
Persistence is the exception, not the default — and we will make it explicit.

### 3.4 Regenerable

Re-opening regenerates from the current state, not from cached pixels. If the
operator asked the same question twice in a row, the second answer would compose
from the same function output and the same context — but the composer is permitted
to choose a different presentation, and indeed *should*, if anything in the context
moved.

This is the inversion of "screenshot a dashboard and pin it to Slack". The screenshot
is dead data. The regenerated dashboard is **live data through live judgement**.
The Live Activities pattern Apple introduced in iOS 18 ([Apple Developer Human
Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/live-activities))
hints at this: the same activity refreshes with the latest state every time it is
shown, in a layout that adapts to the surface — Dynamic Island, Lock Screen,
CarPlay, Apple Watch. Borjie generalises Apple's surface-adaptation pattern to a
full domain-function adaptation: not just "render this state on this screen", but
"compose the right interface for this question, this person, this moment".

### 3.5 Learnable

High-reuse generated UIs get promoted to **learned recipes** via the existing
Wave 17B / 18F lock-improve cycle.

This is the move no one else has made publicly. Vercel v0 ([vercel.com](https://vercel.com/blog/announcing-v0-generative-ui))
generates code on every request — but the code is the artifact, not the manifest;
the generation does not feed back into a registry of patterns that "deserve to be
persisted because operators kept asking for them". Cursor Composer 2.5 ([cursor.com,
May 2026](https://cursor.com/blog/composer-2-5)) excels at agentic code generation
but does not telemetrically promote successful generations into reusable assets.

Borjie does. When the same generated pattern (`(function_id,
generated_recipe_hash)` shape) is reused ≥10 times across ≥3 different users in a
tenant, the system promotes it from "ephemeral" to a static `TabRecipe` in the
registry. From then on, the recipe is loaded instead of generated, can be locked,
A/B tested, and improved via Wave 18F's improve loop. The cognitive memory (Wave
18AA) makes the promotion decisions cross-tenant when federation thresholds are
satisfied: a pattern that proved valuable for ten cooperative mines can be offered
to the eleventh on first run.

Software is ephemeral by default. It becomes durable by *earning durability through
use*.

---

## 4. SOTA landscape

We surveyed fifteen sources spanning incumbents, research labs, and emerging
products. Each has a fragment of the ephemeral-software vision; none has all five
properties.

| # | Source | Year | What they do | Where they stop short |
|---|--------|------|--------------|------------------------|
| 1 | **Vercel v0** ([blog](https://vercel.com/blog/announcing-v0-generative-ui), [2026 review](https://weavai.app/blog/en/2026/04/25/v0-by-vercel-2026-ai-ui-generator-review-pricing/)) | 2023-2026 | Natural-language → shadcn/ui React components; 6M developers; 2026 added full Next.js sandbox, Git, DB connectivity. | Generated code is the artifact — must be deployed, maintained, version-pinned. No function-attached manifest. No context-aware regeneration per operator. |
| 2 | **Anthropic Artifacts** ([anthropic.com](https://www.anthropic.com/news/artifacts), [Suprmind 2026](https://suprmind.ai/hub/claude/features/)) | 2024-2026 | Interactive HTML/SVG/React side panels; 500M artifacts created; April 2026 added Live Artifacts that refresh on reopen with MCP-connected data. | Persisted in conversation, not discarded by default. Not bound to domain functions in a tenant's runtime; bound to chat turns. No brand-lock pipeline; no scope/authority routing. |
| 3 | **ChatGPT Canvas** ([openai.com](https://openai.com/index/introducing-canvas/), [UX Planet 2025](https://uxplanet.org/ui-design-with-chatgpt-5-afc67dc501a1?gi=8c002fdddaeb)) | 2024-2025 | Persistent editable document/code editor side panel; auto-opens at >10 lines; in 2025 added Figma/SwiftUI export. | Canvas persists; not ephemeral. Editor-shaped, not dashboard-shaped. No function manifest; no tenant context. |
| 4 | **Cursor Composer 2.5** ([cursor.com, May 2026](https://cursor.com/blog/composer-2-5)) | 2023-2026 | Agentic code editor; 25× more synthetic tasks than Composer 2; sustained long-running tasks; subagent parallelism. | Targets engineers writing code — the artifact stays. No tenant-runtime ephemerality. No brand-lock; no authority-tier enforcement. |
| 5 | **Apple Live Activities + Dynamic Island** ([Apple HIG](https://developer.apple.com/design/human-interface-guidelines/live-activities)) | iOS 16+ → 18 | Same activity adapts presentation to surface (Dynamic Island ↔ Lock Screen ↔ CarPlay ↔ Watch); refreshes with latest data on reopen. | Surface-adaptive, not function-attached. Developer must hand-author each presentation; no generative composer. |
| 6 | **Hex Magic + Threads** ([hex.tech, fall 2025](https://hex.tech/blog/fall-2025-launch/), [hex.tech AI overview](https://learn.hex.tech/docs/getting-started/ai-overview)) | 2024-2026 | Conversational analytics; Threads agent generates SQL, charts, narrative summary, anomalies; Notebook Agent runs autonomously. | Targets data analysts. Dashboards persist as Hex projects — artifact model. No scope-aware regeneration; no brand-lock pipeline. |
| 7 | **Bardeen Magic Box + Browser Agents** ([Voiceflow 2026](https://www.voiceflow.com/blog/bardeen-ai), [Automation Atlas](https://automationatlas.io/tools/bardeen/)) | 2024-2026 | Natural-language → workflow automation playbooks; 2026 Browser Agents traverse sites autonomously. | Workflow-shaped, not dashboard-shaped. The automation is the artifact; users edit playbooks. No function-attached UI. |
| 8 | **Notion AI + Agent platform** ([Notion 2026](https://www.notion.com/product/ai), [TechCrunch 2026](https://techcrunch.com/2026/05/13/notion-just-turned-its-workspace-into-a-hub-for-ai-agents/)) | 2024-2026 | Workspace + custom AI agents + DB automation + Q&A across knowledge base; May 2026 turned workspace into agent hub. | Pages persist as artifacts. Agents act on pages; pages do not regenerate themselves per operator. No domain-function binding. |
| 9 | **Ink & Switch malleable software** ([essay, June 2025](https://www.inkandswitch.com/essay/malleable-software/), [Litt buttondown](https://buttondown.com/geoffreylitt/archive/new-essay-malleable-software/)) | June 2025 | Research essay + prototypes (Patchwork, Embark, Potluck); argues apps are flawed; AI coding alone is insufficient; needs malleability + local-first data + reshape-with-low-friction. | Research, not productized. No tenant model; no authority tiers; no brand lock. Identifies the *what* and *why*; we ship the *how* for a domain. |
| 10 | **Karpathy "Software 3.0"** ([Sequoia](https://inferencebysequoia.substack.com/p/andrej-karpathys-software-30-and), [VentureBeat](https://venturebeat.com/ai/a-weekend-vibe-code-hack-by-andrej-karpathy-quietly-sketches-the-missing), [catalaize](https://catalaize.substack.com/p/andrej-karpathy-software-is-changing)) | 2017 (S2.0), 2024-2025 (S3.0) | Coined Software 2.0 (NN-as-code); 2025 vibe-code essay declares code "ephemeral, malleable, discardable after single use". Articulates the paradigm. | Manifesto, not infrastructure. We build the runtime. |
| 11 | **End-user programming research** ([arxiv 2311.00382](https://arxiv.org/pdf/2311.00382), [arxiv 2312.16633](https://arxiv.org/pdf/2312.16633)) | 2023-2025 | Studies whether code remains relevant UI for end-user programming with LLMs; participatory-prompting method for eliciting AI-assist opportunities. | Academic. Identifies cognitive load of generated code as primary barrier. Justifies *generated dashboard, not generated code* — our exact choice. |
| 12 | **Live programming environments — Pharo, Squeak, VAST AI** ([arxiv 1703.10862](https://arxiv.org/pdf/1703.10862), [arxiv 2603.02987 IDE 26](https://arxiv.org/pdf/2603.02987), [Ahmed Hamdiy on Pharo](https://medium.com/@ahmed.hamdiy03/a-beginners-guide-to-pharo-why-smalltalk-still-matters-in-2025-a221f0e04a9e)) | 1970s → April 2026 | Smalltalk/Self/Pharo's *"everything is a live, mutable, inspectable object"* lineage; April 2026 paper "It's Alive! What a Live Object Environment Changes". VAST 2026 integrating LLM into live Smalltalk. | Live-object dynamism is per-developer not per-operator. Brilliant heritage; not multi-tenant enterprise. |
| 13 | **Replit Agent 4** ([Replit](https://replit.com/agent4), [StartupHub 2026](https://www.startuphub.ai/ai-news/artificial-intelligence/2026/replit-s-agent-4-ai-building-apps-without-code)) | 2024-2026 | Natural-language → full app + browser test loop + auto-fix; Series D $400M @ $9B valuation. | App is the artifact; persistent project. Targets indie/PM/non-dev builders. No tenant-runtime ephemeral regeneration. |
| 14 | **tldraw Make Real + computer** ([Make Real](https://makereal.tldraw.com/), [tldraw computer](https://computer.tldraw.com/), [hackscience](https://www.hackscience.education/the-computer-you-draw-inside-tldraws-natural-language-os/)) | 2024-2025 | Draw a UI → AI writes HTML → live iframe; tldraw computer is visual prog environment on a canvas where LLM "reads" the diagram. | Designer tool; not bound to a multi-tenant domain. Ephemeral by accident; no manifest contract. |
| 15 | **Retool AppGen** ([retool.com](https://retool.com/blog/ai-generated-apps), [New Stack](https://thenewstack.io/retools-new-ai-powered-app-builder-lets-non-developers-build-enterprise-apps/)) | 2024-2026 | Natural-language → enterprise app from production schema; assembles UI, wires queries, defaults search/pagination/validation; built on tested components. | Apps are still saved and maintained as artifacts. No discard-by-default. Closed runtime; no audit-hash; no scope hierarchy. |

**Two further corroborating sources** worth naming for completeness:

- **Maisem on "Ephemeral Software"** ([maisem.dev](https://maisem.dev/blog/ephemeral)): "The codebase is at most cached and can be discarded and regenerated with high trust. If software generation cost approaches zero, software maintenance looks like a waste of time." — short post, names the economic shift.
- **Indigo AI on "The End of Permanent UI"** ([getindigo.ai](https://www.getindigo.ai/blog/the-end-of-permanent-ui)): coins **"Ephemeral UI"** as "user interfaces generated on demand, used for a task, then gone. When you close the window, the interface ceases to exist."

The pattern across all fifteen: **everyone has one or two of the five properties; nobody combines all five inside a multi-tenant runtime with brand-lock, authority tiers, and learning.** That is the gap.

---

## 5. What is defensible about Borjie's approach

Five existing waves combine into a moat:

1. **Unified cognitive memory (Wave 18AA)** means a generated UI is not a one-shot
   — it can recall every prior generation for the same `(function_id, archetype,
   scope)` tuple across the tenant's history (and, with federation, across all
   tenants), and lean toward presentations that *worked*. Vercel v0 generates each
   time from a fresh prompt; our generator generates from a fresh prompt **plus an
   embedding-indexed recall of every dashboard the tenant has ever seen and
   reacted to**. ([UNIFIED_COGNITIVE_MEMORY_SPEC](../DESIGN/UNIFIED_COGNITIVE_MEMORY_SPEC.md))

2. **Org-scope hierarchy (Wave 18Y)** means the same function call from the same
   user can produce a tenant-customised UI without leaking another tenant's
   patterns. Hex Magic does not have this — its workspace context is shared across
   collaborators. Borjie's scope hierarchy lets `compose_dashboard` know that this
   particular request is "owner of cooperative Mwadui, scoped to Site Mwadui-2, in
   the Q3 fiscal window" — and routes templates, copy, brand tokens, and federated
   recall accordingly.

3. **Brand DNA + ESLint brand-lock (Wave 18K)** means **every generated UI passes
   through the `borjie/no-non-token-style` rule at composition time**. A raw hex
   color in a generated component is rejected and the composer regenerates with the
   `BorjieBrandConstraint` injected explicitly. v0 cannot do this — it has no
   project-level brand-lock pipeline. Our generated UIs are physically incapable of
   shipping off-brand pixels.

4. **Mutation authority + approval matrix (Wave 18S)** means a generated UI cannot
   silently introduce a Tier-2 action button. Authority is enforced at the
   manifest level: a function declaring `authority_tier: 0` may compose into an
   inline tab; a function declaring `authority_tier: 2` (e.g. `commit_hedge_order`)
   composes into a UI whose *submit* surface is auto-routed through the approval
   matrix DSL. No incumbent has this combination of "AI generates UI" + "AI cannot
   bypass the org's authority discipline".

5. **Audit-hash chain (PO-14, `@borjie/audit-hash-chain`)** means every generated
   UI carries an audit-hash record of *what was composed, for whom, from what
   context, when, and what they did with it*. The hash chain is tamper-evident
   (sha256, secret-rotated, verifiable offline). When a Tanzanian regulator asks
   *"how did this operator decide to file this TUMEMADINI return on this date?"*,
   the audit chain shows the function, the generated dashboard, the citations
   surfaced in the UI, and the click history. No SaaS competitor in the African
   mining space — let alone v0 / Cursor / Hex — has this.

The investor read: this is not "v0 for Africa". This is **v0's generation primitive,
inside an audit-grade multi-tenant runtime, governed by a learned memory and a
brand-lock pipeline, gated by an authority matrix, observable end-to-end** — built
for an industry where the artifact model has failed the smallest operators for
fifty years. It is not portable to the v0 model in the other direction; it is the
*next* generation of enterprise software, and Borjie ships it first because the
African mining domain *demands* it.

---

## 6. What this enables — concrete examples

### Example A — Owner asks "show me Q3 FX exposure"

1. Mr. Mwikila's intent recogniser classifies the turn → `intent =
   query_fx_exposure`.
2. The cognitive engine routes to `project_fx_exposure(tenant=mwadui_coop,
   quarter=Q3-2026)` in `packages/fx-treasury-advisor/`.
3. The function returns `{ exposures: [...], recommended_hedges: [...],
   confidence: 0.86 }`.
4. The function's `FunctionUIManifest` says: `archetype = chart_with_table`,
   `emphasis = narrative`, `preferred_size = tab`, `mobile_strategy = simplify`,
   `authority_tier = 1`, `ephemeral_by_default = true`, `cache_ttl_seconds = 300`.
5. `composeDashboardForFunction(manifest, output, user_context)` reads the
   owner's mastery tier (`expert`), locale (`en`), brand tokens, and a cognitive-
   memory recall of two prior Q-end exposure dashboards the owner reacted
   positively to.
6. It emits a TabRecipe: an explanation paragraph in Mr. Mwikila's voice, a
   bar-chart of currency exposures, a table with hedge proposals, a primary
   action `Stage hedge order` (Tier 1, surfaces approval matrix).
7. Owner reviews. Closes the tab. Recipe is discarded. Telemetry row written.
8. Next week, owner asks the same question with a different framing — *"what's
   my dollar risk on this quarter's tea hedge?"*. Same function, different
   context (focused intent + recent buyer turns in memory) → composer emits a
   *different* recipe: a single big-number KPI for USD exposure, a sparkline
   for the trend, no table. Better fit. Still ephemeral.
9. After the 10th such request across the cooperative's three sites, the
   promotion-decider lifts the pattern into a learned `TabRecipe` —
   `fx-exposure-quarterly-owner-en` — which now loads from the registry and
   enters the lock/improve cycle.

### Example B — Site manager asks "what shifts had incidents this week?"

Function `query_incident_shifts(site_id, week)` → returns a list of shifts with
metadata. Manifest: `archetype = list_with_filters`, `emphasis = actionable`.
Composer generates a filterable list with drill-down to each incident's audit
chain. Manager closes — discarded. Next month, same question — generated again
with the latest data + the manager's filtering habits in memory.

### Example C — Buyer asks "which parcels match my offer at $25/g+"

Function `match_buyer_offer(buyer_id, threshold)` in
`packages/buyer-marketplace-advisor/` → returns parcels. Manifest: `archetype =
list_with_filters` + `composite` layout (map overlay), `emphasis = data_density`.
Composer generates a marketplace tab with map markers + a parcel table + a
"place offer" button (Tier 1). Buyer browses, closes tab. Discarded.

### Example D — Auditor asks "show me Mwadui-2's gold export ledger"

Same underlying function `query_export_ledger(site_id, range)` — but the
auditor's context (`scope = audit`, mastery `power-user`) routes the composer
to emit a citations-heavy view, with every row linking to its audit-hash and
its source `TUMEMADINI-4.2` citation. The owner of Mwadui-2 invoking the same
function gets the narrative version. Same function. Two different rooms,
composed in real time.

---

## 7. Risks

1. **UI inconsistency between sessions.** If the composer is too creative, the
   operator never sees the same dashboard twice and trust collapses. *Mitigation:*
   the cognitive-memory recall is the stabiliser — when an operator's recent
   interactions show high engagement with archetype X for question Y, the composer
   anchors to X with mild variation, not radical reinvention. Promotion to a
   learned recipe at the 10×3 threshold further stabilises high-frequency patterns.

2. **Performance.** Composing on every request is slower than serving a static
   asset. *Mitigation:* the cache policy (5 min for ephemeral default, 1 hour for
   high-reuse non-default, invalidated on context change) keeps p95 under a tab's
   patience window. The composer runs server-side; the rendered TabRecipe streams
   over the existing dynamic-ui rail.

3. **Accessibility.** Generated UIs can ship WCAG violations. *Mitigation:* the
   archetype renderers in `packages/ephemeral-ui/src/composer/archetype-renderer.ts`
   only emit UiPart payloads from the brand-locked primitive set — which already
   passes axe-core CI gates today. The composer cannot invent a new HTML element.

4. **Brand drift.** Generated UIs could emit off-brand colors or non-token
   spacings. *Mitigation:* `brand-lock-pass.ts` runs after composition; the
   `borjie/no-non-token-style` rule rejects any recipe with non-token styling;
   composer regenerates with `BorjieBrandConstraint` injected. Three retries; then
   fail loud.

5. **Debugging difficulty.** When something looks wrong in an ephemeral UI, the
   engineer cannot "git blame the component". *Mitigation:* the audit-hash row
   stores `(function_id, manifest_version, generated_recipe_hash, user_context_hash,
   composer_version)` — replay is deterministic from those five fields. Every
   ephemeral UI is reproducible from its row.

6. **Memory bloat.** Discard-by-default does not happen automatically — it
   requires the lifecycle controller. *Mitigation:* `ephemeral_dashboard_telemetry`
   is the only durable trace; the TabRecipe itself is never persisted (lives in
   per-tab memory + 5-min cache). Telemetry has a 90-day TTL by default.

7. **The composer hallucinating affordances.** A generated dashboard could include
   a button labelled `Submit hedge order` that maps to no real action.
   *Mitigation:* the archetype renderer only allows action wiring through
   declared `manifest.allowed_actions` — actions the function explicitly opted
   into. A generated button with no manifest-declared backing is rejected at
   composition time.

---

## 8. Six-month rollout

| Month | Stage | What ships |
|-------|-------|------------|
| 1 | Foundation | This spec + `packages/ephemeral-ui/` package + 1 migration. Manifest registry, composer skeleton, archetype renderer for `list_with_filters` + `chart_with_table` + `kpi_grid`. Brand-lock pass wired. No promotion yet. |
| 2 | Read-only generated UIs | Three pilot functions in `packages/fx-treasury-advisor`, `packages/geology-advisor`, `packages/mining-shift-planner` declare manifests. Composer renders read-only views inside chat-ui tabs. Telemetry written. Audit-hash links. |
| 3 | Interactive generated UIs | Manifest extension to declare `allowed_actions: ReadonlyArray<ActionDescriptor>`. Composer wires action submission through existing approval-matrix-dsl. Authority-tier 0 + 1 supported. Tier 2 surfaced but routed to ApprovalGate. |
| 4 | Learning loop | Reuse counter + promotion decider live. Patterns crossing the 10×3 threshold promote to learned `TabRecipe`s in the existing registry. Wave 18F lock/improve cycle now operates on promoted recipes. |
| 5 | Federated memory integration | Cognitive memory recall feeds composer with cross-tenant patterns (PII-stripped per Wave 18AA). Generated UIs for new tenants benefit from the federated catalogue. |
| 6 | Audit + regulator readiness | Replay-from-audit-row tooling. Hash-chain verification CLI ships. First Tanzanian regulator pilot — auditor asks a question, the generated audit-view is hash-chain-verifiable end to end. |

Stage gates: each month, a Wave 17B/18F-style lock review confirms the prior
month's manifests + archetypes are stable before extending. No new manifests
ship without a brand-lock test + a composer telemetry test.

---

## 9. Open research questions

1. **What should be ephemeral vs. persistent by default?** Heuristic: data-read
   functions ephemeral; mutation-commit functions persistent (operators must be
   able to refer back to "what I committed yesterday"). But the boundary is
   fuzzy — a "scheduled report" is between the two. Open.

2. **How do we cache for performance without losing "regenerate on context
   change"?** Today's heuristic: cache keyed on `(function_id, function_input_hash,
   user_context_hash, brand_tokens_version)`. Open question: how granular should
   `user_context_hash` be? Including recent_turns means almost no cache hit;
   excluding them means stale UI when context shifts mid-conversation.

3. **What composer model is right?** Sonnet 4.5 for default composition (cost +
   quality); Haiku 4.5 for high-frequency low-risk regenerations (per global
   performance rule). Opus 4.7 for the *occasional* "novel archetype" path where
   the composer must reason about a domain shape it has not seen before. Open
   question: when does the composer escalate from Haiku → Sonnet → Opus?

4. **How does promotion interact with multi-tenant brand drift?** If pattern X is
   promoted because Mwadui Cooperative reused it 12 times, but Mkuranga
   Cooperative has very different brand DNA — does X promote globally, or
   per-tenant? Initial answer: per-tenant; federation only via Wave 18AA's
   PII-stripped pathway.

5. **Mobile-first or desktop-first generation?** The `mobile_strategy` field is a
   shortcut; the long-term answer may be that the composer generates two
   recipes (compact + full) every time, and the renderer chooses. Cost
   implications. Open.

6. **What about voice-first ephemeral UIs?** A spoken answer is an ephemeral UI
   too — Mr. Mwikila's audio reply is composed from the same function output,
   discarded after delivery, regenerable. The `ui_hints.preferred_size` may
   need a `voice` variant. Out of scope for Phase 1.

---

## 10. The investor pitch — one sentence

> **Borjie is the first runtime that turns every domain function into its own
> dashboard, composed in real time from the operator's context, brand-locked,
> authority-gated, audit-hash-evident, learned from every prior session — so that
> small operators in markets the global SaaS vendors never modelled get
> SOTA-grade software the moment they ask for it, and discard it the moment they
> are done.**

---

### Sources cited

- [Vercel — Announcing v0: Generative UI](https://vercel.com/blog/announcing-v0-generative-ui)
- [WeavAI Blog — v0 by Vercel 2026 review](https://weavai.app/blog/en/2026/04/25/v0-by-vercel-2026-ai-ui-generator-review-pricing/)
- [Anthropic — Artifacts are now generally available](https://www.anthropic.com/news/artifacts)
- [Suprmind — Claude Features 2026: Projects, Artifacts, Memory, MCP](https://suprmind.ai/hub/claude/features/)
- [OpenAI — Introducing Canvas](https://openai.com/index/introducing-canvas/)
- [UX Planet — UI Design with ChatGPT 5 (2025)](https://uxplanet.org/ui-design-with-chatgpt-5-afc67dc501a1?gi=8c002fdddaeb)
- [Cursor — Introducing Composer 2.5 (May 2026)](https://cursor.com/blog/composer-2-5)
- [Apple — Human Interface Guidelines: Live Activities](https://developer.apple.com/design/human-interface-guidelines/live-activities)
- [Hex — Fall 2025 Launch: Agents, for analytics, for teams](https://hex.tech/blog/fall-2025-launch/)
- [Hex — AI overview](https://learn.hex.tech/docs/getting-started/ai-overview)
- [Bardeen — Voiceflow review 2026](https://www.voiceflow.com/blog/bardeen-ai)
- [Automation Atlas — Bardeen 2026 Browser AI Agent](https://automationatlas.io/tools/bardeen/)
- [Notion — Meet your AI team](https://www.notion.com/product/ai)
- [TechCrunch — Notion turned its workspace into a hub for AI agents (May 2026)](https://techcrunch.com/2026/05/13/notion-just-turned-its-workspace-into-a-hub-for-ai-agents/)
- [Ink & Switch — Malleable software essay (June 2025)](https://www.inkandswitch.com/essay/malleable-software/)
- [Geoffrey Litt — New essay: Malleable Software](https://buttondown.com/geoffreylitt/archive/new-essay-malleable-software/)
- [Sequoia — Andrej Karpathy's Software 3.0 and the New AI Stack](https://inferencebysequoia.substack.com/p/andrej-karpathys-software-30-and)
- [VentureBeat — Karpathy weekend vibe-code hack (2025)](https://venturebeat.com/ai/a-weekend-vibe-code-hack-by-andrej-karpathy-quietly-sketches-the-missing)
- [catalaize — Karpathy: Software is changing (again)](https://catalaize.substack.com/p/andrej-karpathy-software-is-changing)
- [arxiv 2311.00382 — Code as relevant UI for end-user programming with generative AI](https://arxiv.org/pdf/2311.00382)
- [arxiv 2312.16633 — Participatory prompting](https://arxiv.org/pdf/2312.16633)
- [arxiv 1703.10862 — Edit Transactions in Live Programming](https://arxiv.org/pdf/1703.10862)
- [arxiv 2603.02987 — It's Alive! Live Object Environment in Software Engineering Practice (IDE 26)](https://arxiv.org/pdf/2603.02987)
- [Pharo — Why Smalltalk still matters in 2025](https://medium.com/@ahmed.hamdiy03/a-beginners-guide-to-pharo-why-smalltalk-still-matters-in-2025-a221f0e04a9e)
- [Replit — Agent 4](https://replit.com/agent4)
- [StartupHub — Replit's Agent 4 (2026)](https://www.startuphub.ai/ai-news/artificial-intelligence/2026/replit-s-agent-4-ai-building-apps-without-code)
- [tldraw — Make Real](https://makereal.tldraw.com/)
- [tldraw — computer](https://computer.tldraw.com/)
- [hackscience — The Computer You Draw](https://www.hackscience.education/the-computer-you-draw-inside-tldraws-natural-language-os/)
- [Retool — Introducing AI app generation](https://retool.com/blog/ai-generated-apps)
- [The New Stack — Retool's AI-Powered App Builder](https://thenewstack.io/retools-new-ai-powered-app-builder-lets-non-developers-build-enterprise-apps/)
- [maisem.dev — Ephemeral Software](https://maisem.dev/blog/ephemeral)
- [Indigo AI — The End of Permanent UI](https://www.getindigo.ai/blog/the-end-of-permanent-ui)
- [Engineered Intelligence — Ephemeral Software: UI, Data, and Functions in an AI-First World](https://engineeredintelligence.substack.com/p/ephemeral-software-ui-data-and-functions)
- [arxiv 2205.07204 — Mod2Dash: Model-Driven Dashboards Generation](https://arxiv.org/pdf/2205.07204)
- [arxiv 2601.06126 — NL2Dashboard: Lightweight Controllable Framework with LLMs](https://arxiv.org/pdf/2601.06126)
- [Google Cloud — Gemini supports brand consistency](https://cloud.google.com/transform/closing-the-creative-gap-how-gemini-supports-brand-consistency)
- [UXPin — AI in Design Systems: Consistency Made Simple](https://www.uxpin.com/studio/blog/ai-design-systems-consistency-simple/)

— Mr. Mwikila
