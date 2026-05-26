# SOTA Gap Analysis — Borjie — 2026-05-26

> A brutally honest, PhD-level audit of where Borjie sits versus the 2025–2026
> state of the art in agentic AI, knowledge representation, learning,
> multimodality, real-world action, and domain-specific deployment.
> This document is for the founder and investors. No marketing fluff,
> no diplomatic phrasing. If a wave is scaffold-only and the spec
> promises orchestration of orchestrators, that gap is stated plainly.
> Every external claim is cited.

**Author method.** Filesystem audit of `Docs/DESIGN/`, `Docs/STRATEGY/`,
`packages/`, and `services/` on the `main` branch; 14 web searches across
the 10 SOTA dimensions; cross-reference against prior audits
(`Docs/SOTA_PARITY_AUDIT_2026-05-24.md`, `Docs/PARITY_AUDIT_2026_05_26.md`,
`Docs/STRATEGY/CAPABILITY_BOOST_VISION.md`). Closure-cost estimates use a
T-shirt scale (S ≤ 1 week, M ≤ 1 month, L ≤ 1 quarter, XL ≥ 1 quarter).

**Companion docs.** `CAPABILITY_BOOST_VISION.md` (north-star thesis),
`SOTA_PARITY_AUDIT_2026-05-24.md` (10-domain product audit), this doc
(10-dimension SOTA-research audit). Differences: prior audit asks
"are we at SOTA versus competitors", this one asks "where is the AI
research frontier and how far behind are we".

---

## 1. Executive summary — the 10 P0 gaps

Borjie has out-paced almost every competing African mining/SaaS startup
on the *surface area* of capability: 124 packages, 20 services, 22
design specs, a manifesto-grade strategy doc, and 1,653 test files.
But surface area is not depth. Six of the most strategically important
2026 SOTA primitives are either missing entirely from our dependency
graph or stubbed at a spec-only level.

The 10 highest-leverage P0 gaps, ranked by closure ROI:

1. **Test-time-compute reasoning (o1/o3-style) is not in the kernel.**
   `extended-reasoning` and `reasoning-substrate` packages exist as
   scaffold; no MCTS-over-tool-calls, no process-reward model, no
   verifier loop. SOTA agents now win on `WebArena` at 68%+ via online
   RL plus PRM-guided MCTS — we have none of these primitives wired
   ([Latent Space / Noam Brown on multi-agent civilizations][s1],
   [ACM / AgentPRM][s2]).
2. **GraphRAG is not the retrieval default.** `knowledge-graph` and
   `cognitive-memory` are present but the dominant retrieval path is
   still vector + per-tenant pgvector. SOTA 2026 production stacks use
   hierarchical community summaries over Neo4j/LanceDB graphs for
   global queries, vector for local ([LanceDB / GraphRAG hierarchical][s3]).
3. **No verifier-based RL post-training loop.** `self-improving-loops`
   spec exists; no GRPO / DAPO / RLVR implementation. SOTA teams ship
   verifier-RL for any task with a structured-output check — exactly
   our regulatory-form and reconciliation use-cases ([dev.to / RLHF in
   2026][s4], [llm-stats / Post-training 2026][s5]).
4. **MCP is one-way only.** We expose three internal MCP servers
   (`mcp-server-process-intel`, `tra`, `tumemadini`) but consume few
   external MCPs. As of March 2026 there are 10,000+ public MCP servers
   and 97 M installs — Borjie is missing a top-tier connector layer
   ([WorkOS / MCP in 2026][s6]).
5. **No mechanistic-interpretability or calibration layer.** `bias-handling`
   and `ethics-framework` packages exist; no sparse-autoencoder probes,
   no Brier-score calibration on advisor outputs. Constitutional AI
   has matured into production but our `compliance-pack` doesn't have
   a SAE-feature dashboard ([MIT Tech Review / Mechinterp][s7]).
6. **Voice + computer-use is spec-only.** `voice-agent` service exists
   but uses an older Realtime API surface; no Gemini Live integration,
   no parallel Computer-Use agent fleet. Sonnet 4.6 + Gemini 3.1 Flash
   Live are the 2026 voice-stack baseline ([Safina / Gemini 3.1 Flash
   Live][s8]).
7. **Durable orchestration is missing.** Long-running agent runs (Apollo
   Gauntlet, Brain Evolution Worker) do not use Temporal or Inngest.
   Process restart loses session state. This blocks `long-horizon-agent`
   from real production use.
8. **Continual + federated learning is not even spec'd.** Mining tenants
   in Geita and Mwanza will never let raw drill-log corpora leave the
   tenant boundary; without a federated DPO loop, every per-tenant
   advisor adaptation has to round-trip through manual SFT ([arxiv /
   FedPDPO][s9]).
9. **No Swahili / low-resource fine-tune track.** Tanzania's national AI
   strategy explicitly anchors on Kiswahili NLP ([UNESCO / Tanzania
   readiness][s10]); we ship English prompts only. This is the single
   largest moat we are leaving on the table for any well-funded
   competitor.
10. **No production reliability shadow-deploy.** `observability` and
    `litfin-port-observability-extra` packages emit OTel traces but we
    do not run guarded releases or shadow LLM call mirroring. Langfuse
    plus LaunchDarkly Guarded Releases is the 2026 baseline ([LaunchDarkly
    + Langfuse guide][s11]).

The recommended response — sequenced into waves 19A–24F below — closes
the top six gaps inside one quarter and the remaining four inside two.

---

## 2. Borjie's current architecture inventory

A snapshot at audit time (counts from `ls -1 | wc -l`):

| Layer | Count | Notes |
|------:|------:|-------|
| Design specs (`Docs/DESIGN/`) | 22 | Recent additions: CUSTOMER_GEO_ROUTING, ORG_HIERARCHY_TERMINOLOGY, DATA_ONBOARDING, JUNIOR_DYNAMIC_SPAWNING |
| Strategy docs (`Docs/STRATEGY/`) | 1 | `CAPABILITY_BOOST_VISION.md` (448 lines, manifesto-grade) |
| Packages (`packages/`) | 124 | Includes 20+ AI/brain-tier packages |
| Services (`services/`) | 20 | Including `apollo-gauntlet-runner`, `brain-evolution-worker`, `voice-agent`, `mcp-server-process-intel` |
| Mining-specific route files | 33 hono + 10 internal + 15 OpenAPI | Tumemadini, TRA, mine-planner, geology-advisor wiring |
| Drizzle table definitions | 244 | 115 migration files |
| Test files | 1,653 | (raw count; coverage % unknown without a profile run) |

The **AI/brain tier** is unusually dense for a Series-A-stage SaaS:
`agent-orchestrator`, `agent-platform`, `agent-runtime`, `agentic-os`,
`brain-llm-router`, `brain-self-awareness`, `central-intelligence`,
`cognitive-engine`, `cognitive-memory`, `extended-reasoning`,
`reasoning-substrate`, `scientific-discovery`, `self-codegen`,
`memory-v2`, `module-orchestrator`, `module-spec-engine`, plus the
`long-horizon-agent`, `mutation-authority`, `autonomy-governance`,
`disclosure-layer`, `compliance-pack` stack.

The **honest critique** is that this density is mostly specification
plus interface — the *runtime depth* per package averages ~600 LoC.
Several packages with grand titles (`agentic-os`, `central-intelligence`,
`scientific-discovery`) are still skeletons with TODO comments where
the orchestration loop should live. See section 5 for a wave-by-wave
honesty table.

---

## 3. Ten SOTA dimensions — gap, cost, recommended approach

Gap rating: **1 = match SOTA, 2 = close behind, 3 = noticeable lag,
4 = wide lag, 5 = wide-open gap**. Cost: S/M/L/XL as defined above.

### 3.1 Reasoning (tree-of-thought, self-consistency, MCTS on LLMs, o1/o3)

**SOTA 2026.** Reasoning-native models (o1, o3, DeepSeek-R1, Gemini
2.0 Thinking, Claude 4.7 extended-thinking) plus inference-time MCTS
guided by a process-reward model (PRM) saturate `MATH-500` and push
`AIME` past human-olympiad ceilings ([academia.edu / TTC scaling][s12],
[Latent Space / Noam Brown][s1]). THINKPRM beats LLM-as-judge using
8 K synthetic step labels ([arxiv / Process Reward Models That Think][s13]).

**Borjie state.** `packages/extended-reasoning` and `reasoning-substrate`
are scaffold; `central-intelligence/kernel/` has cot-reservoir, debate,
reflexion modules but no PRM, no MCTS over tool calls, no process-step
scoring. The kernel hand-rolls its own loop instead of consuming a
verifier.

**Gap rating: 4 (wide lag). Cost: L. Approach:** add
`packages/process-reward-model` (small fine-tuned model, scored per
step), wire MCTS into `agent-orchestrator` for any task with a
verifier (regulatory-form filing, reconciliation, geology log). Use
self-consistency for narrative tasks. Pin Claude Opus 4.7 extended
thinking for hard-reasoning hops.

### 3.2 Knowledge representation (GraphRAG, hierarchical retrieval, long context)

**SOTA 2026.** Hybrid GraphRAG + long-context: global queries hit
hierarchical community summaries over a Neo4j/LanceDB graph; local
queries hit vector. 1 M-token context windows are useful for
single-document deep reads but ~1,250× cost vs RAG and 30–60× slower
([TianPan / Long-context vs RAG][s14], [LanceDB / GraphRAG][s3]).

**Borjie state.** `knowledge-graph`, `cognitive-memory`, `memory-v2`,
`graph-sync`, `graph-privacy` packages exist. Primary retrieval is
pgvector + per-tenant scope. No community-level summaries, no graph-
hop reasoning across the corpus, no per-query routing between graph
and vector retrievers.

**Gap rating: 4. Cost: M.** Approach: ship a `graph-rag-router`
package; build community summaries in `consolidation-worker`'s sleep
pass; expose a `/retrieve` endpoint that chooses graph-global vs
vector-local based on query class.

### 3.3 Learning (RLHF/DPO, continual, federated)

**SOTA 2026.** The post-training stack is modular: SFT → DPO/SimPO/KTO
→ GRPO/DAPO/RLVR for verifiable rewards. Federated personalised DPO
(FedPDPO) is now the standard pattern when raw data cannot leave the
tenant ([dev.to / RLHF in 2026][s4], [arxiv / FedPDPO][s9]).

**Borjie state.** Zero post-training pipeline. `self-improving-loops`
spec, `brain-evolution-worker` service, but no live SFT or DPO. The
"self-improving" claim is a spec promise, not running code.

**Gap rating: 5 (wide-open). Cost: L.** Approach: ship a `post-training-
pipeline` package — SFT first using Anthropic fine-tune API and an
in-house RLVR loop on regulatory-form correctness. Federated DPO is a
2027 deferral, but the *data-collection* schema must land in 2026 so
the eventual federated round-trip is trivial.

### 3.4 Multi-agent (MoE, MCP, Computer Use, verifiers, swarms)

**SOTA 2026.** MoE inference (Kimi K2.6 with 1.04 T params, 32 B
active) plus 100–300 parallel sub-agents coordinated via a single
orchestrator and 4,000-step swarms is now production-feasible
([Serenities / Kimi K2.5][s15]). MCP is the de-facto wire protocol —
97 M installs, 10,000+ public servers ([WorkOS / MCP 2026][s6]).

**Borjie state.** `agent-orchestrator`, `agent-platform`, three
internal MCP servers. No external MCP consumption. No swarm pattern;
the dispatch-router serialises tasks. The 5 newly-wired persistent
stores noted in the prior audit (`lessonStore`, `wormAudit`,
`skillRegistry`, `aopRegistry`, `a2aTaskStore`) are still constructed
in `service-registry.ts` but not `c.set()` on the Hono context — see
section 5.

**Gap rating: 3. Cost: M.** Approach: ship `packages/swarm-runtime`
on top of `agent-orchestrator`; add MCP-client wiring for ≥10 public
servers (filesystem, github, slack, sentry, google-workspace, etc.).

### 3.5 Safety + evaluation (Constitutional AI, mech interp, calibration)

**SOTA 2026.** Constitutional AI is in production at Anthropic;
sparse-autoencoder feature dashboards (Anthropic Microscope) are
shipping; calibration is evaluated in three layers — technical
faithfulness, operational utility, governance-readiness ([MIT Tech
Review / Mechinterp 2026][s7], [UST / AI interpretability 2026][s16]).

**Borjie state.** `compliance-pack`, `bias-handling`, `ethics-framework`,
`disclosure-layer`, `autonomy-governance`, `audit-hash-chain`,
`security-audit`, `fairness-eval`, `four-eye-approval` (in the brain
kernel). No SAE probes, no Brier-score calibration, no live ETHICS
dashboard.

**Gap rating: 3. Cost: M.** Approach: add `packages/calibration-monitor`
(Brier + ECE per advisor per task class) and `packages/saes-probe`
(small open-weights SAE on top of fine-tuned advisor outputs).

### 3.6 Multimodality (Gemini Live, Voice Engine, VLA models)

**SOTA 2026.** Gemini 3.1 Flash Live offers 90+ language realtime
voice; RT-2 / Gemini Robotics / GR00T N1 / π0 are the production VLA
stack for robotics ([Safina / Gemini 3.1 Flash Live][s8],
[Internet-Pros / VLA models 2026][s17]). For our domain, voice + image
matter most; VLA-style action is overkill until field-mobile is
shipped.

**Borjie state.** `voice-agent`, `audio-capture`, `audio-logics-litfin`,
`media-generation`, `content-studio`, `document-ai` packages. Voice
agent uses an older OpenAI Realtime API surface. No Gemini Live, no
on-device whisper-vector spell-check, no Swahili STT/TTS.

**Gap rating: 4. Cost: M.** Approach: dual-provider voice agent
(Anthropic + Gemini Live), Swahili STT/TTS evaluation gauntlet, route
realtime hops through Gemini Live for latency.

### 3.7 Real-world action (computer use, browser automation, voice calls)

**SOTA 2026.** Claude Mythos Preview leads `WebArena` at 68.7%;
Browser Use ships at 89.1% on `WebVoyager`. WAREX shows severe
degradation under bot-defence, Cloudflare, DataDome ([awesomeagents
/ benchmarks][s18], [arxiv / WAREX][s19]).

**Borjie state.** `browser-perception`, `action-runtime`, `dispatch-router`,
`probe-runners` packages. No production Browser Use / Computer Use
loop yet. Apollo Gauntlet runs synthetic gauntlets, not live
browser action.

**Gap rating: 4. Cost: L.** Approach: stand up a `services/browser-
action-fleet` (managed Chrome containers, Browser Use as the harness),
focus initial domain on Tumemadini portal + TRA portal automation. The
mining permit web-form economy in Tanzania is exactly the high-value
ROI surface for browser-action agents.

### 3.8 Production reliability (Langfuse, shadow deploy, guarded releases)

**SOTA 2026.** Langfuse over OTel is the 2026 default LLM observability
stack; LaunchDarkly Guarded Releases is the canonical shadow-deploy
pattern; preferred deployment is Kubernetes (Helm) ([Langfuse / OTel][s20],
[LaunchDarkly + Langfuse guide][s11]).

**Borjie state.** `observability`, `litfin-port-observability-extra`
emit OTel traces. No Langfuse, no guarded releases, no shadow LLM
mirror, no per-tenant model A/B harness.

**Gap rating: 3. Cost: S.** Approach: deploy Langfuse self-hosted
(Helm), wire OTel exporters, add a `packages/shadow-deploy` thin
client.

### 3.9 Cutting-edge frontiers (test-time compute, speculative decoding, neuro-symbolic)

**SOTA 2026.** SAGUARO + Jakiro speculative decoding deliver 5× over
autoregressive at parity ([arxiv / Speculative Speculative Decoding][s21]).
Neuro-symbolic systems (Permion, SynaLinks) embed neural reasoning
inside finite-state machines with schema-constrained decoding
([cogentinfo / Year of neuro-symbolic AI 2026][s22]).

**Borjie state.** None. Our `extended-reasoning` package is a thin
shell over the LLM provider's own thinking mode.

**Gap rating: 4. Cost: L.** Approach: defer speculative decoding (we
host nothing yet — provider concern). Adopt neuro-symbolic schema-
constrained decoding for any regulatory-form-fill task: combine
JSON-schema enforcement + DSL constraints + LLM completion.

### 3.10 Domain-specific (mining AI, property AI, Tanzania/East Africa)

**SOTA 2026.** Mining AI: 4× exploration acceleration via satellite +
AI; ROCs automating ESG dashboards; NI 43-101 compliance increasingly
demands AI-traceable data ([farmonaut / Remote sensing mineral
exploration 7 top 2026][s23], [farmonaut / NI 43-101 2026][s24]).
Property AI: AppFolio Realm-X + Yardi Chat IQ + Entrata Leasing AI
saving 10 h/week per user with agentic triage and dispatch
([AppFolio / Best property management software 2026][s25], [Haven /
Third-party PM AI 2026][s26]). Tanzania: 2022 PDPA + Kiswahili NLP
anchor; Africa Mining Week 2026 is centred on AI exploration
([UNESCO / Tanzania readiness][s10], [tech.africa / African Mining
Week 2026][s27]).

**Borjie state.** Mining: `mine-planner-advisor`, `geology-advisor`,
`mining-commodity-intelligence`, `regulatory-tz-mining`,
`mcp-server-tumemadini`, `mcp-server-tra`, `process-intel` services
are unique strengths. Property (parent fork): geo-parcels,
fleet-management, procurement-coordination, inventory-management,
field-capture-service, property-voices-debate. Swahili: nothing
specific.

**Gap rating: 2 for mining domain (we're ahead of every peer);
5 for Swahili/Kiswahili (open goal). Cost: M.** Approach: ship a
Kiswahili-tuned advisor lineage by Q4 2026; deepen the satellite-RSe
integration (Sentinel-2/Landsat exploration probes) into
`geology-advisor`.

---

[s1]: https://www.latent.space/p/noam-brown "Latent Space — Scaling Test Time Compute, Noam Brown 2026"
[s2]: https://dl.acm.org/doi/10.1145/3774904.3792551 "ACM — AgentPRM: Process Reward Models for LLM Agents 2026"
[s3]: https://www.lancedb.com/blog/graphrag-hierarchical-approach-to-retrieval-augmented-generation "LanceDB — GraphRAG hierarchical retrieval"
[s4]: https://dev.to/saurabh_naik_b213f3bbeafe/rlhf-in-2026-when-to-pick-ppo-dpo-or-verifier-based-rl-542o "dev.to — RLHF in 2026: PPO vs DPO vs verifier-based RL"
[s5]: https://llm-stats.com/blog/research/post-training-techniques-2026 "llm-stats — Post-Training in 2026: GRPO, DAPO, RLVR & Beyond"
[s6]: https://workos.com/blog/everything-your-team-needs-to-know-about-mcp-in-2026 "WorkOS — Everything your team needs to know about MCP in 2026"
[s7]: https://www.technologyreview.com/2026/01/12/1130003/mechanistic-interpretability-ai-research-models-2026-breakthrough-technologies/ "MIT Tech Review — Mechanistic interpretability: 10 Breakthrough Technologies 2026"
[s8]: https://safina.ai/en/blog/gemini-3-1-flash-live-realtime-voice-ai/ "Safina — Gemini 3.1 Flash Live 2026"
[s9]: https://arxiv.org/abs/2603.19741 "arxiv — FedPDPO: Federated Personalized DPO for LLMs"
[s10]: https://www.unesco.org/en/articles/ai-ready-and-responsible-tanzania-unveils-national-assessment-africa-internet-governance-forum "UNESCO — Tanzania AI readiness assessment"
[s11]: https://dev.to/alexiskroberson/opentelemetry-for-llm-applications-a-practical-guide-with-launchdarkly-and-langfuse-1a3a "dev.to — OpenTelemetry for LLM apps: LaunchDarkly + Langfuse"
[s12]: https://www.academia.edu/165704995/Test_Time_Compute_Scaling_and_Reasoning_Models_Foundations_Benchmarks_and_Implications "Academia — Test-Time Compute Scaling and Reasoning Models 2026"
[s13]: https://arxiv.org/pdf/2504.16828 "arxiv — Process Reward Models That Think (THINKPRM)"
[s14]: https://tianpan.co/blog/2026-04-09-long-context-vs-rag-production-decision-framework "TianPan — Long-Context vs RAG: 1M-token decision framework 2026"
[s15]: https://serenitiesai.com/articles/kimi-k2-5-deep-review-agent-swarm-benchmarks-pricing-2026 "Serenities — Kimi K2.5 Agent Swarm 2026"
[s16]: https://www.ust.com/en/insights/ai-interpretability-explainability-2026-executive-view "UST — AI Interpretability 2026 Executive View"
[s17]: https://internet-pros.com/blog/vision-language-action-models-robotics-2026/ "Internet-Pros — VLA Models 2026"
[s18]: https://awesomeagents.ai/leaderboards/web-agent-benchmarks-leaderboard/ "Awesome Agents — Web Agent Benchmarks Leaderboard Apr 2026"
[s19]: https://arxiv.org/pdf/2510.03285 "arxiv — WAREX: Web Agent Reliability Evaluation"
[s20]: https://langfuse.com/integrations/native/opentelemetry "Langfuse — Native OpenTelemetry integration"
[s21]: https://arxiv.org/pdf/2603.03251 "arxiv — Speculative Speculative Decoding 2026"
[s22]: https://www.cogentinfo.com/resources/the-year-of-neuro-symbolic-ai-how-2026-makes-machines-actually-understand "Cogent — The Year of Neuro-Symbolic AI 2026"
[s23]: https://farmonaut.com/mining/remote-sensing-mineral-exploration-7-top-2026-advances "Farmonaut — Remote sensing mineral exploration 7 top 2026"
[s24]: https://farmonaut.com/mining/ni-43-101-report-essential-2026-mining-compliance-guide "Farmonaut — NI 43-101 compliance 2026"
[s25]: https://www.appfolio.com/blog/best-property-management-softwares-compared-2026 "AppFolio — Best property management software 2026"
[s26]: https://www.usehaven.ai/post/third-party-property-management-ai-ultimate-guide "Haven — Third-party PM AI 2026 Ultimate Guide"
[s27]: https://tech.africa/african-mining-week-2026-ai-exploration/ "tech.africa — African Mining Week 2026"
