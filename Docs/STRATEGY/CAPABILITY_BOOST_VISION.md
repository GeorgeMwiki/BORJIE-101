# Capability Boost — The Borjie Differentiator

> The master strategic doc for the Borjie platform. Every product, every
> connector, every prompt, every persona, every UX surface that goes into
> Mr. Mwikila — Borjie's autonomous Managing Director for Tanzanian mining
> operators — bottoms out here.
>
> **Cross-links:** [`MASTER_BRAIN_AUTONOMY_MANIFESTO.md`](../MASTER_BRAIN_AUTONOMY_MANIFESTO.md),
> [`OMNIDATA_CONNECTOR_INVENTORY.md`](../DESIGN/OMNIDATA_CONNECTOR_INVENTORY.md),
> [`TACIT_KNOWLEDGE_HARVESTING_SPEC.md`](../DESIGN/TACIT_KNOWLEDGE_HARVESTING_SPEC.md),
> [`CAPABILITY_CATALOGUE_SPEC.md`](../DESIGN/CAPABILITY_CATALOGUE_SPEC.md),
> [`SELF_IMPROVING_LOOPS_SPEC.md`](../DESIGN/SELF_IMPROVING_LOOPS_SPEC.md),
> [`COGNITIVE_ENGINE_SPEC.md`](../DESIGN/COGNITIVE_ENGINE_SPEC.md),
> [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](../DESIGN/UNIFIED_COGNITIVE_MEMORY_SPEC.md).

---

## 1. The Thesis — Productivity Boost vs Capability Boost

Every productivity tool ever built — from Lotus Notes to Slack to
Microsoft 365 Copilot to ChatGPT Enterprise to Glean to Notion AI —
shares a single, hidden assumption: **the organisation already knows
how to do the work, and the tool simply makes that work faster.** Email
delivers the message faster. Slack threads conversations faster. Copilot
drafts the memo faster. Glean finds the document faster. The unit of
improvement is *minutes saved per existing task*. The ceiling is the
organisation's own existing know-how.

The founder's verbatim brief — written for Borjie, but stated as a
universal principle — names the next thing:

> "Completely moving away from just productivity boost to capability
> boost. That is where we need to be SOTA. Literal ability to poke,
> identify, and document critical know-hows that are in people's heads
> by prompting more or asking follow-ups or curious explanations or
> clarifications into domain knowledge, learning, etc. Think intelligent
> AI-powered organisation with AI-native software — that's the full
> vision. Literal self-improving AI loops from the ground up."

**Capability boost** is what happens when the AI does not just speed
up the things the organisation already does — it makes the
organisation capable of things it could not do before. A 4-person
mining cooperative in Geita gains the regulatory navigation of a 40-
person enterprise. A new owner who has never filed a Tumemadini return
on a Friday afternoon can do so on a Monday morning of their first
month with the platform. A senior mine surveyor's 22 years of pit-edge
intuition becomes available to every junior surveyor on every site,
day one. A buyer-relationship pattern observed at one tenant becomes
(consented, anonymised) a price-floor recommendation at another. The
unit of improvement stops being *minutes saved* and becomes
**capabilities that did not exist yesterday**.

This is the single thing competitors cannot match by going faster.
Glean can index 100 more SaaS apps; it cannot interview the surveyor.
Copilot can draft the memo in 0.4 seconds instead of 4 minutes; it
cannot decide that the memo should be drafted at all. ChatGPT
Connectors can pipe Salesforce data into a chat; they cannot detect
that the org's pricing approach contradicts the buyer's known
provenance preferences captured in last month's WhatsApp threads.
Capability boost is **the organisation becoming a fundamentally
different organisation** — not because anyone got faster, but because
the latent knowledge that lived only in employees' heads, in chat
silos, in inbox archives, in screenshots on phones — is now **active
intelligence** that Mr. Mwikila composes into every decision.

This is the differentiator. This document is the strategic spec for
how Borjie ships it.

---

## 2. The Four Pillars

Capability boost stands on four pillars. Each pillar has its own
detailed spec; this doc is the keystone that names how they fit.

### Pillar 1 — Omnidata

**Every external source the org uses gets ingested, indexed, and made
available to Mr. Mwikila.** Slack, Gmail / Outlook, WhatsApp Business,
Notion, Google Drive / OneDrive / Dropbox, Microsoft Teams,
Salesforce, HubSpot, Linear / Jira / Asana, GitHub / GitLab, Zoom /
Meet recordings, phone calls (via Vapi / Retell / Twilio), Instagram /
Facebook / TikTok / LinkedIn / YouTube for the marketing side, M-Pesa
/ NBC / CRDB bank statements via aggregators, QuickBooks / Xero for
accounting, and the Tanzanian regulator portals (Tumemadini, NEMC,
TRA, BoT) that already have specialised MCP servers in Borjie. The
spec for every connector — auth flow, refresh cadence, PII handling,
volume class, priority phase, MCP-server opportunity — lives in
[`OMNIDATA_CONNECTOR_INVENTORY.md`](../DESIGN/OMNIDATA_CONNECTOR_INVENTORY.md).

### Pillar 2 — Tacit Knowledge Harvesting

**Most organisational knowledge lives in heads, not data.** Squirro's
research, cited widely in the 2026 enterprise-AI literature, puts the
figure at roughly 80% of business value sitting in tacit knowledge —
the intuition, context, unwritten rules, and personal relationships
that make work actually work. Mr. Mwikila is, by design, a
**conversational anthropologist**: a Managing Director who, after
ingesting the omnidata, sits down with each employee and runs a
structured interview that produces typed `KnowHowArtifact`s. Five
harvesting modes — onboarding interview, departure interview, curious
follow-up, methodology elicitation, just-in-time documentation —
ensure no critical know-how leaves the building uncaptured. The spec
lives in [`TACIT_KNOWLEDGE_HARVESTING_SPEC.md`](../DESIGN/TACIT_KNOWLEDGE_HARVESTING_SPEC.md).

### Pillar 3 — Capability Catalogue

**Capabilities are measurable.** An organisation "can do X with Y
speed at Z accuracy at $C cost per invocation". The catalogue stores
every capability Mr. Mwikila has identified for the tenant — both the
ones the tenant currently has (file a Tumemadini return; reconcile a
buyer settlement against the BoT gold window; draft a board pack) and
the ones that are aspirational gaps (e.g. "negotiate a forward gold
sale with a smelter in Switzerland"). Gaps surface in the owner's
morning briefing as opportunities. New capabilities emerge
continuously — from successful task completions, from omnidata +
tacit-knowledge stitching, from external industry signals. The spec
lives in [`CAPABILITY_CATALOGUE_SPEC.md`](../DESIGN/CAPABILITY_CATALOGUE_SPEC.md).

### Pillar 4 — Self-Improving Loops

**Mr. Mwikila identifies his own weaknesses and closes them.** Five
loops compound: a per-turn loop (every owner turn writes feedback into
the cognitive-memory cells), a per-recipe loop (Wave 17B / 18F and
17D / 18G recipe-variant testing), a per-junior loop (Wave 18V-DYNAMIC
junior lifecycle maturation), a cross-tenant federation loop (patterns
observed in ten or more tenants promote to platform memory, with
strict differential-privacy controls), and a meta-learning loop (the
Master Brain audits its own audit chain weekly, identifies classes of
weakness, and proposes new connectors, new juniors, or new datasets
to close them). The owner sees the meta-loop in a weekly self-
improvement report: "Mr. Mwikila got 23% faster at X; Mr. Mwikila
identified gap Y; Mr. Mwikila proposes capability Z next." The spec
lives in [`SELF_IMPROVING_LOOPS_SPEC.md`](../DESIGN/SELF_IMPROVING_LOOPS_SPEC.md).

Each pillar is independently valuable. Together, the four compound:
omnidata gives Mr. Mwikila the *raw substrate*; tacit-knowledge
harvesting gives him the *interpretation key*; the capability
catalogue gives him the *output surface*; and the self-improving loops
ensure that all three get better every day, in front of the owner,
with the owner's consent, against measurable benchmarks.

---

## 3. The User Journey — Four Concrete Narratives

These are not roadmap items. They are the *lived experience* a Borjie
customer should have on day 1, day 30, day 180, and day 365.

### Narrative A — The New Owner

Aida Mwambukira is a 34-year-old who has just inherited a 12-person
artisanal gold operation in the Geita region from her father. She
signs up for Borjie on a Tuesday at 14:00 on her Android phone in
Mwanza. By 14:20, Mr. Mwikila has:

- run a structured 20-minute conversational interview (in Swahili) that
  caught every operational habit she remembers from her father —
  *"Baba alikuwa anauza dhahabu kila ijumaa kwa Mzee Hassan"* ("Father
  sold gold every Friday to Mr. Hassan") — and every regulatory
  anchor she could name (PML number, NEMC permit date approximate);
- harvested every key relationship she could surface (the licensed
  buyer, the broker, the cousin who handles the diesel run);
- generated a **Day-1 capability map** showing the 18 operational
  capabilities her father's business *de facto* had — file Tumemadini
  weekly return, reconcile BoT gold-window FX, run a 6-person daily
  shift rota, pay GePG royalty bill — and the 7 capabilities her
  business is *missing* (forward-sale hedging, structured grievance
  log, NEMC EIA renewal anticipation).

By 14:40 her PML licence number has been queried against Tumemadini's
cadastre via the [`mcp-server-tumemadini`](../../services/mcp-server-tumemadini)
service; her TIN has been verified through [`mcp-server-tra`](../../services/mcp-server-tra);
the morning brief for Wednesday 06:00 is queued. **She walked into a
business that is already moving.**

### Narrative B — The Existing Employee with 18 Months of History

Joseph Tesha is a 41-year-old mine surveyor for one of Borjie's
larger tenants. He has been at the company for 6 years. When the
omnidata connectors (Slack, Gmail, Notion, Google Drive) are
authorised by the owner, Mr. Mwikila pulls 18 months of Joseph's
Slack DMs, his Gmail attachments, his Notion site-notes, his shared
Drive folder of surveys. By the time Joseph next chats with
Mr. Mwikila — Wednesday morning, *"naomba ripoti ya pit 4"* ("please,
report for pit 4") — Mr. Mwikila already knows that Joseph reports
findings to the geologist Linda on Tuesdays, that he is the only
employee who has used the Marker OCR on hand-drawn pit sketches, that
he flagged a wall-stability concern in pit 3 four months ago that is
still open, and that he speaks more bluntly in DMs with the
mechanical-engineer team than in DMs with the geology team.
**Mr. Mwikila does not need 6 months to "get to know" Joseph — he
already does.**

### Narrative C — The Senior Expert About to Retire

Mr. Yohana Mboya is 63. He has run the cyanide-leach pad at the
tenant's Buhemba site for 22 years. He is retiring in 60 days. His
knowledge — the moisture-content thresholds at which the pad goes
slow, the rainfall pattern that has historically over-saturated the
heap, the smell that means a leak before the conductivity probe
reads — is not in any document. The owner schedules five 90-minute
**departure interviews** with Mr. Mwikila and Mr. Mboya, structured by
the methodology-elicitation harvesting mode. After the five sessions,
the platform has 247 typed `KnowHowArtifact`s, organised into a
**Buhemba Leach-Pad Operations Playbook** that is now available to
every junior leach-pad operator the tenant ever hires. Mr. Mboya
retires on a Friday. On the following Monday, the junior who replaces
him is asked by Mr. Mwikila in chat — *"Have you checked the heap
moisture today? Mr. Mboya's playbook said you should after any rainfall
> 8 mm in the last 24h."* **22 years of pit-edge intuition is now
durable.**

### Narrative D — The New Hire Onboarded in 3 Days

Saada Ngailo joins the same tenant as a junior buyer-relationship
coordinator. Her predecessor would have learnt the buyer landscape
over six months of cold emails, missed calls, and *"why didn't anyone
tell me"* moments. Mr. Mwikila orients her with a 90-minute
onboarding session that pulls from the harvested know-how of the
departed Mr. Mboya, the active Joseph Tesha, every CRM (Salesforce,
HubSpot) row, every relevant Slack thread (PII-redacted at the
boundary), and every WhatsApp conversation the previous coordinator
had with each of the tenant's 14 active buyers. Mr. Mwikila tells her:
*"Mzee Hassan pays 1.2% above spot but only when invoices are issued
on Wednesdays — last 36 transactions, p-value 0.001."* By day 3 Saada
sends her first buyer email with full context. **What used to take 6
months takes 3 days.**

---

## 4. The Defensibility — Why No Incumbent Can Match This

Borjie's defensibility is not in any single component. It is in the
**fusion**. Each of the four pillars, taken alone, is already shipping
somewhere in the market — Glean fuses connectors, Squirro and Deloitte
Tohmatsu fuse AI interviews, Microsoft Work IQ tracks organisational
context, Cohere North bundles agents with private deployment. None of
them fuse all four with a domain-specialised persona (Mr. Mwikila —
mining MD) layered on top, on a phone, in Swahili, with regulator-
specific MCP servers (Tumemadini, NEMC, TRA, BoT) plugged into the
same kernel that drives the chat. That stack is the moat.

The incumbent failure modes are concrete:

- **Glean** ([gosearch.ai/blog/what-is-glean-search/](https://www.gosearch.ai/blog/what-is-glean-search/),
  [docs.glean.com/connectors/about](https://docs.glean.com/connectors/about))
  ships 100+ connectors but is fundamentally a search index — *find
  the document faster*. It does not harvest tacit knowledge, does not
  measure capabilities, does not generate domain artifacts (a
  Tumemadini return, a board pack, a buyer letter). Capability boost
  is outside its surface area.
- **Microsoft 365 Copilot / Work IQ** ([microsoft.com / 365 blog](https://www.microsoft.com/en-us/microsoft-365/blog/2026/05/05/microsoft-365-copilot-human-agency-and-the-opportunity-for-every-organization/),
  [spknowledge.com — Work IQ launch](https://spknowledge.com/2026/01/19/introducing-work-iq-the-intelligence-layer-powering-microsoft-365-copilot/))
  has the deepest fusion of any single vendor — Work IQ explicitly
  targets "individual and organisational knowledge". But it is locked
  into the Microsoft 365 graph; WhatsApp, M-Pesa, Tumemadini, and the
  Tanzania-specific regulator stack are outside its world.
  Capability-boost-as-a-domain-vertical (mining, property, finance)
  is not Copilot's lane.
- **ChatGPT Enterprise Connectors** ([glean.com / 2026 eval](https://www.glean.com/blog/enterprise-search-evaluation-2026))
  is rapidly expanding but human graders in Glean's own benchmark
  still preferred Glean's answers 1.9x over ChatGPT's for correctness.
  ChatGPT's connectors are general — they index, they answer; they do
  not interview, do not measure, do not self-improve at the
  organisational level.
- **Notion AI** ([max-productive.ai / Notion AI Review 2026](https://max-productive.ai/ai-tools/notion-ai/))
  shines once knowledge is already structured. Capability boost is
  about structuring the *unstructured* — heads, chats, calls,
  screenshots.
- **Salesforce Einstein / Data Cloud / Agentforce** ([salesforce.com — Enterprise Knowledge launch](https://www.salesforce.com/blog/salesforce-enterprise-knowledge-data-cloud-unstructured-data/),
  [mindstudio.ai — Agentforce architecture](https://www.mindstudio.ai/blog/salesforce-agentforce-architecture-slack-data-agents))
  is the closest single-vendor analogue at the data-graph level. But
  it is CRM-anchored; the mining operator without Salesforce gets
  nothing. And it does not interview the human.
- **Cohere North** ([cohere.com / North](https://cohere.com/north/workplace-productivity))
  is a private-deployable agentic workspace for regulated industries.
  Closest peer on the agentic side; weakest on the connector breadth
  and tacit-knowledge harvesting fronts.

The pattern: every incumbent owns *some* of the surface. None owns
the **fusion**. None owns the **vertical** (Tanzanian mining; Tanzanian
property — see BossNyumba for the property port). None owns the
**phone-first, Swahili-first, low-bandwidth** experience. None has
five-mode tacit-knowledge harvesting. None publishes a measurable
capability catalogue. None has a weekly self-improvement report
addressed to the owner.

---

## 5. The Deep-Research Synthesis

The state of the art in 2026 (cited inline) confirms three convergent
trends that Borjie sits squarely on:

1. **Connectors are now table stakes.** MCP — Anthropic's open standard,
   [donated to the Agentic AI Foundation under the Linux Foundation in
   December 2025](https://en.wikipedia.org/wiki/Model_Context_Protocol)
   — counts ~10,000+ active servers and hundreds of distinct AI clients
   ([workos.com — MCP in 2026](https://workos.com/blog/everything-your-team-needs-to-know-about-mcp-in-2026)).
   Borjie ships its critical connectors *as* MCP servers ([`services/mcp-server-tra`](../../services/mcp-server-tra),
   [`services/mcp-server-tumemadini`](../../services/mcp-server-tumemadini)
   are already on this contract) so they compose with Claude Desktop,
   the api-gateway MCP client, and any third-party agent the tenant
   wants to plug in.
2. **Tacit-knowledge capture is the next frontier.** Squirro's data
   ([squirro.com — Corporate Amnesia](https://squirro.com/squirro-blog/ai-tacit-knowledge-capture))
   names 80% of business value as tacit; Deloitte Tohmatsu shipped an
   AI Interview Agent in 2026 ([itbusinesstoday.com](https://itbusinesstoday.com/hr-tech/deloitte-tohmatsu-develops-ai-interview-agent-to-digitize-tacit-knowledge-within-companies/));
   KS-Agents ships an AI-powered exit-interview product specifically
   for retiring-employee know-how ([ks-agents.com/offboarding](https://ks-agents.com/offboarding/)).
   Borjie's five-mode harvester (onboarding, departure, curious follow-
   up, methodology elicitation, just-in-time documentation) is, to
   the best of the literature, more comprehensive than any single-mode
   competitor product on the market.
3. **Self-improving agents are operational, not theoretical.** The
   2026 arXiv literature on metacognitive learning and self-evolving
   agents (cf. [arXiv 2506.05109](https://arxiv.org/pdf/2506.05109),
   [arXiv 2508.00271 — MetaAgent](https://arxiv.org/pdf/2508.00271))
   names a path that maps cleanly onto Borjie's existing recipe-
   variant testing (Wave 17B / 18F), reflexion sleep canary
   (`.github/workflows/reflexion-sleep-canary.yml`), and
   `services/brain-evolution-worker/`. The fifth loop — meta-learning
   — is where Borjie goes from "self-improving agent" to "self-
   improving organisation".

The buy-vs-build calls implied by the research:

- **MCP server SDK** — buy ([`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol)).
  Already in use.
- **Connector framework** — extend Borjie's existing
  `@borjie/connectors` rate-limit / circuit-breaker / retry / audit
  scaffold. Build the omnidata abstraction layer (sync scheduling,
  PII redaction, provenance stamping) on top.
- **Differential-privacy primitives for cross-tenant federation** —
  buy (`opacus` / `tf-privacy` style libraries are mature per
  [arXiv 2007.05553](https://arxiv.org/pdf/2007.05553)); wrap
  carefully behind the existing audit-hash-chain so no PII leaks.

---

## 6. Cross-Links to the Supporting Specs

Each pillar's detailed spec is in `Docs/DESIGN/`:

- [`OMNIDATA_CONNECTOR_INVENTORY.md`](../DESIGN/OMNIDATA_CONNECTOR_INVENTORY.md)
  — every external source, auth flow, refresh cadence, PII handling,
  volume class, MCP-server opportunity. P0 = Slack, Gmail / Outlook,
  Google / Outlook Calendar, WhatsApp Business, Notion, Google Drive /
  OneDrive / Dropbox.
- [`TACIT_KNOWLEDGE_HARVESTING_SPEC.md`](../DESIGN/TACIT_KNOWLEDGE_HARVESTING_SPEC.md)
  — five harvesting modes, the `KnowHowArtifact` schema, interview-
  engine contract, consent regime, anti-patterns. Integrates into
  Wave 18W's `CognitiveMemoryCell` substrate.
- [`CAPABILITY_CATALOGUE_SPEC.md`](../DESIGN/CAPABILITY_CATALOGUE_SPEC.md)
  — the `OrgCapability` model, capability-measurement loop, gap
  surfacing, owner-facing catalogue UI.
- [`SELF_IMPROVING_LOOPS_SPEC.md`](../DESIGN/SELF_IMPROVING_LOOPS_SPEC.md)
  — five self-improvement loops, the Meta-Learning Conductor service,
  the weekly owner-facing self-improvement report, cross-tenant
  federation with differential privacy, anti-patterns.

Supporting infrastructure specs (already landed) that capability boost
sits on top of:

- [`MASTER_BRAIN_AUTONOMY_MANIFESTO.md`](../MASTER_BRAIN_AUTONOMY_MANIFESTO.md)
  — the 5 operating principles + 4 autonomous loops + authority ladder.
- [`COGNITIVE_ENGINE_SPEC.md`](../DESIGN/COGNITIVE_ENGINE_SPEC.md)
  — the 6 cognitive disciplines that every capability-boost output
  routes through.
- [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](../DESIGN/UNIFIED_COGNITIVE_MEMORY_SPEC.md)
  — the `CognitiveMemoryCell` shared substrate (where harvested
  `KnowHowArtifact`s become first-class citizens).
- [`DATA_ONBOARDING_SPEC.md`](../DESIGN/DATA_ONBOARDING_SPEC.md)
  — the 7-stage data persistence pipeline (where omnidata-derived
  rows land in the tenant's operational substrate).

---

## 7. The Six-Month Phasing

Capability boost ships in four waves, sequenced for compounding value.

### Month 1 — Wave OMNI-P0 (Critical Omnidata)

`packages/omnidata/` scaffold lands (this wave). The six P0
connectors — Slack, Gmail / Outlook, Google / Outlook Calendar,
WhatsApp Business Cloud API, Notion, Google Drive / OneDrive /
Dropbox — ship as concrete connectors *and* (where MCP is a natural
fit, i.e. all six) as MCP servers under `services/mcp-server-<source>/`.
Auth flows wired through the existing `@borjie/connectors` OAuth
broker. PII redaction via the existing
`packages/observability/src/pii-redactor.ts`. Provenance stamping via
`@borjie/audit-hash-chain`. Sync via `services/proactive-triggers-worker/`
+ a new `services/omnidata-sync-worker/`.

### Month 2 — Wave HARVEST (Tacit Knowledge Engine)

`packages/tacit-knowledge/` ships the five-mode interview engine and
the `KnowHowArtifact` schema. New migration:
`0029_tacit_knowledge.sql` adds `know_how_artifacts`,
`interview_sessions`, `interview_turns`, `follow_up_threads`,
`knowhow_provenance`, `consent_records`. Persona-kernel tools:
`run_onboarding_interview_v1`, `run_departure_interview_v1`,
`run_methodology_elicitation_v1`, `harvest_follow_up_v1`,
`offer_jit_documentation_v1`. UI surfaces: new chat-mode
"interview" with structured cards.

### Month 3 — Wave CAPABILITY (Catalogue + Gap Surfacing)

`packages/capability-catalogue/` ships the `OrgCapability` model and
the capability-measurement worker
(`services/capability-measurement-worker/`). Owner-facing dashboard
under `apps/owner-dashboard/src/capabilities/`. Gaps surface in the
existing morning-briefing surface and trigger
`compose_tab_v1` proposals for capability-relevant tabs.

### Month 4 — Wave OMNI-P1 (CRM + Tickets + Code)

The P1 connectors — Microsoft Teams, Salesforce, HubSpot, Linear / Jira /
Asana, GitHub / GitLab, Zoom / Meet recordings, Vapi / Retell / Twilio
call transcripts — land. Each rides the same scaffold from Month 1.

### Months 5–6 — Wave SELF-IMPROVE + OMNI-P2

`services/meta-learning-conductor/` ships the weekly self-improvement
report. Cross-tenant federation goes live behind the differential-
privacy wrapper (gated on per-tenant consent; off by default). P2
public-social connectors (Instagram, Facebook, TikTok, Twitter / X,
LinkedIn, YouTube) land for marketing-side capabilities. P3 specialised
(M-Pesa / NBC / CRDB bank-statement aggregators, QuickBooks / Xero,
Tumemadini / NEMC / TRA browser-automation extensions where MCP coverage
is incomplete) lands selectively per-tenant demand.

---

## 8. The One-Sentence Pitch

> "Borjie is the first AI-native platform where every external system
> your business touches and every piece of know-how in your people's
> heads become **one mind** that manages your business while you sleep,
> ships new capabilities every week, and audits its own gaps — turning
> a 4-person artisanal mining operation into a 40-person enterprise
> without hiring a single new employee."

That is capability boost. Every line of Borjie code, every persona
prompt, every connector, every interview question, every measurement
loop bottoms out here.
