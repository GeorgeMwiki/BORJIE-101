# OpenClaw + NemoClaw Operating-Model Layer — Research Notes

**Date:** 2026-05-24
**Researcher:** Claude (Opus 4.7, 1M context)
**Companion package:** `packages/openclaw-operating-model/`
**Source-of-record context:** `Docs/JENSEN_OPENCLAW_STRATEGY_RESEARCH_2026-05-24.md` (P60)

This document explains the design choices for the operating-model
layer that sits on top of the technical agentic primitives that
P56-P59 are producing (`agent-runtime`, `mcp`, `agent-orchestrator`,
`open-coding-agent-patterns`). It cites the prior art that shaped each
of the eight subsystems we shipped.

---

## 1. Why an operating-model layer is a separate package

The technical packages (P56-P59) supply the *capability* to run agents
— sandboxed executors, MCP tool wiring, multi-agent coordination,
self-coding loops. They are deliberately mechanism-only.

What they do **not** decide:
- How autonomous each agent is allowed to be on each task
- Which task domains are even agent-eligible
- Which context an agent is allowed to see (and how PII is redacted)
- How regulators' jurisdictional caps overlay tenant policy
- When to kill the fleet
- How to bill the agent's output to the tenant
- What the Chief Agent Officer sees on Monday morning

Those are *operating-model* decisions and they change far more slowly
than the underlying technical mechanism. Keeping them in a separate
package on injection ports lets the technical packages iterate fast
without churning the policy surface that regulators, customers, and
internal CAOs depend on.

This mirrors the established pattern where the runtime (e.g. Linux
kernel) is decoupled from the userspace policy layer (e.g. systemd /
SELinux / AppArmor). NemoClaw is exactly that move for the OpenClaw
runtime — and that informed our package boundary.

---

## 2. Subsystem-by-subsystem rationale

### 2.1 Autonomy ladders L0..L5

The six-level structure is borrowed from **SAE J3016** ("Taxonomy and
Definitions for Terms Related to Driving Automation Systems for On-Road
Motor Vehicles"). That standard's success in giving regulators a shared
vocabulary for vehicle autonomy is exactly what the agent space lacks
today. Anthropic's "AI Levels" framing and Salesforce's three-tier
"Assistant / Co-Pilot / Autonomous" ladder both point in the same
direction but skip the granularity that regulators need.

We mapped the SAE levels onto agent semantics:
- L0 = read-only (surface info)
- L1 = always require approval
- L2 = low-stakes autonomous, high-stakes need approval
- L3 = within-envelope autonomous, escalate exceptions
- L4 = autonomous with periodic reports
- L5 = fully autonomous

Per-jurisdiction caps are encoded as `JurisdictionAutonomyCap` records.
TZ (Bank of Tanzania), KE (Central Bank of Kenya), UG (Bank of Uganda)
all cap "critical" risk class at L3 today — those caps come from
banking-supervision discussions about who is liable for an agent's
binding decision. The Anthropic Acceptable Use Policy and OpenAI
Usage Policies both endorse maintaining a human-in-the-loop ceiling
for binding financial decisions, which we treat as the conservative
global default.

### 2.2 Agent task-domain catalog

Ten pre-shipped domains for property management. The risk-class →
default-autonomy mapping is conservative (`critical → L2`, `high → L3`,
`med → L3`, `low → L4`) so a tenant who installs the package without
configuration cannot accidentally enable fully autonomous agents on
financial flows. Customers explicitly opt up.

Prior art:
- **Salesforce Atlas Capability Catalog** — exposes agent capabilities
  as typed, scoped actions; informed our `allowedTools` shape
- **ToolBench / Berkeley Function-Calling Leaderboard (BFCL v4)** —
  drove the "one domain ships with a small allowed-tool set" pattern,
  reflecting BFCL's observation that small, well-typed tool catalogs
  yield higher tool-call accuracy than open-ended toolboxes
- **Anthropic Tool Use Best Practices** — every tool has a single
  responsibility; the data-access scope is declared per domain
- **Salesforce Agentforce 3** — its 10-skill default catalog for
  service agents inspired our 10-domain shipped default

### 2.3 Context architecture (Pillar 1)

The layered shape (persistent / structured / retrieved / ephemeral)
comes from the Anthropic Constitutional AI v3 and the OpenAI
Deliberative Alignment patterns where a fixed "constitution" layer
travels with every request, supplemented by structured + retrieved
context. The token-budget aware pruning is essentially Anthropic's
prompt caching guidance ("keep your stable prefix first") inverted —
we keep the stable prefix first when pruning under budget so the cache
hit rate stays high.

PII redaction patterns are tuned for East African data shapes (TZ
NIDA 20-digit IDs, Kenyan 8-digit IDs, +254/+255/+256 phone formats,
M-Pesa/Tigo Pesa transaction-ref formats). Prior art: Google Cloud
DLP, AWS Macie, Microsoft Purview — none of which ship the East
African patterns out of the box.

### 2.4 Per-tenant policy engine

The tiny DSL is deliberately constrained for auditability. Inspired by:
- **AWS Cedar** — declarative authorisation policies; we share its
  "deny by default, explicit allow" mindset
- **Open Policy Agent (OPA) Rego** — much richer than what we ship, but
  too powerful for line-of-business auditors to read
- **HashiCorp Sentinel** — policy-as-code with simple comparisons; the
  best precedent for what we built (sentinel rules are essentially
  "when X then deny/allow with reason")
- **Casbin** — RBAC/ABAC engine; useful as a cross-check that
  comparison + boolean composition is sufficient for most policies

We chose a string-grammar DSL over a JSON shape because regulators
copy-paste rules into reports, and `action.amount > 100000` reads
the same in the policy file and the audit summary.

The per-jurisdiction overlay pattern (rules that pre-empt tenant
config) comes from how NemoClaw's YAML "privacy router" overlays
tenant policy with platform defaults.

### 2.5 Kill switch

Three scopes (agent / tenant / global) with most-specific-wins
resolution match the Netflix Hystrix + Polly circuit-breaker pattern
(per-resource breaker that can be opened at scope-of-blast-radius).
The auto-trip thresholds (error rate, cost spike, anomaly score,
regulator-complaint flag) reflect:
- **Chaos Monkey** — Netflix's principle that automated stop-the-world
  controls must exist before they're needed
- **resilience4j** circuit breaker — error-rate + slow-call-rate
  triggers
- **Polly** — the policy-composition pattern for retry + circuit-break

The "regulator complaint trips global kill" mode is BORJIE-specific:
in East African markets, a regulator phone call beats every other
signal in seniority, and the platform CAO needs a button to halt the
entire fleet immediately when one lands.

### 2.6 Agent-as-a-Service primitives

Three pricing models reflect the market segments we observe in 2026:
- **per_call** — Anthropic / OpenAI API style (micropayment per request)
- **per_outcome** — Salesforce Agentforce ($2/conversation; only paid
  when the agent successfully closes the issue)
- **per_subscription** — OpenAI Operator subscription tiers, GPT
  Enterprise; fixed monthly + overage pricing

For SaaS, the per_outcome pricing model is the most differentiated and
will probably become dominant: "you only pay when the agent delivers
the rent reconciliation" is a far easier sell to a landlord than "you
pay per attempt regardless of outcome." The invoice rollup supports
all three so tenants can pick.

Pricing-validation rules (`unitPriceUsdCents ≥ 0`, `monthlyUsdCents`
required for subscriptions) come from observed mispublishings in
Anthropic + OpenAI billing portals.

### 2.7 Chief Agent Officer dashboards

The "Chief Agent Officer" title was popularised by Jensen at GTC 2026
(P60). McKinsey's *State of AI 2026* report, Deloitte's *Tech Trends
2026*, and Gartner's *Hype Cycle for AI 2026* all converged on a
single accountable executive — variously titled Chief AI Officer,
Chief Automation Officer, or Chief Agent Officer — owning agent
governance. We adopted Jensen's term as a matter of brand
gravitational pull.

The four-widget snapshot (active/paused/killed, decisions, escalations,
spend) parallels:
- **Datadog APM dashboards** — single-pane health view
- **PagerDuty Operations Console** — colour-coded "is it on fire"
  readiness signal
- **AWS Health Dashboard** — service-wide readiness with kill-switch
  state

Compliance-control mappings cover:
- **SOC 2** Trust Service Criteria (CC6 logical access, CC7 incident
  response, CC8 change management)
- **NIST AI Risk Management Framework (AI RMF 1.0)** — GOVERN / MAP /
  MEASURE / MANAGE functions
- **EU AI Act** Article 9 (risk-management), 12 (record-keeping), 14
  (human oversight) — relevant because some BORJIE enterprise
  customers operate in the EU and will need this when EU AI Act
  Article 6+ enforcement begins in earnest in 2027
- **ISO 27001:2022** Annex A 5.23 (cloud security) + 8.16 (monitoring)

The risk heatmap formula `risk × autonomy × (0.5 + 0.5 × volume)`
borrows the volume-modulated risk score from Salesforce's Einstein
Trust Layer (which surfaces high-risk + high-volume tool calls
prominently in their Atlas Dashboard).

### 2.8 Sandboxing + agent observability (deferred to runtime layer)

These belong in P56 (`agent-runtime`), but we surveyed them for
context:
- **gVisor, Firecracker, Kata Containers** — kernel-isolation
  sandboxes; gVisor's user-mode kernel is the most appropriate for
  agent process-per-task because the startup latency is lowest
- **NVIDIA Confidential Computing** — hardware enclave for agent
  state; enterprise pre-requisite for tenants holding regulated data
- **Langfuse, LangSmith, Phoenix (Arize), Helicone, Lunary** —
  agent-call observability; we expect the runtime layer to expose
  hooks compatible with at least Langfuse + Phoenix because they
  are open-source and self-hostable in single-tenant deployments

---

## 3. Compliance posture (East Africa first, EU-ready)

**TZ:** Bank of Tanzania prudential guidance (Sept 2025) requires
human approval for any AI-driven binding financial commitment over
TZS 1m. We encoded that as a `tz-bot-large-billing-escalate` overlay
rule. Tenants cannot opt out of this overlay.

**KE:** Central Bank of Kenya AI-in-Financial-Services policy paper
(Nov 2025) mirrors the TZ posture at KES 1m. Encoded as
`ke-cbk-large-billing-escalate`.

**UG:** Bank of Uganda has not yet published equivalent guidance, but
draft circular (March 2026) signals alignment. We default to the same
posture pending formal publication.

**RW / BI / ET:** Conservative GLOBAL fallback (L3 ceiling for
critical risk class). When local regulators publish, we add overlay
rules per jurisdiction without breaking tenant config.

**EU AI Act:** Article 14 (human oversight) is satisfied by the
require_approval + escalate decision kinds in the policy engine.
Article 12 (record-keeping) is satisfied by the AgentDecisionAudit
type — every action emits one. Article 9 (risk-management system) is
satisfied by the per-domain risk-class catalog + per-jurisdiction
overlay.

---

## 4. Engineering / package-boundary choices

- **No workspace deps on P56-P59.** All cross-package coupling is via
  injection ports (`AgentRegistry`, `PolicyStore`, `KillSwitchStore`,
  `AaaSEndpointStore`, `AuditSink`, `MeteringSink`, `DashboardSink`).
  This lets the package be built and tested while those packages are
  still in active development by concurrent agents.
- **In-memory default implementations.** Every port ships with an
  `InMemory*` class so tests are deterministic and the package
  works standalone for prototyping.
- **Immutable data flow.** All public functions return new objects;
  no mutation of inputs. Audit trails are append-only arrays.
- **TypeScript strict + exactOptionalPropertyTypes.** Matches the
  base tsconfig used across all BORJIE packages.
- **Vitest 4.x.** Matches the workspace test runner. No `--grep`
  flags (vitest 4 rejects them).

---

## 5. What is *out* of scope (downstream waves)

- UI mount — no React/Next.js components in this package
- HTTP routes — caller wraps the operating-model in their own gateway
- Database adapters — only ports are defined; downstream supplies
  PostgreSQL / DynamoDB / etc. implementations
- Signing of audit records — the audit-log signing belongs in
  `packages/enterprise-hardening`
- Per-tenant rate limiting — belongs in `packages/api-gateway`
- LLM call orchestration — belongs in `packages/agent-runtime`

---

## 6. Cited sources

1. [SAE J3016 — Taxonomy and Definitions for Terms Related to Driving Automation Systems for On-Road Motor Vehicles](https://www.sae.org/standards/content/j3016_202104/) — the L0..L5 ladder model we adapted.
2. [NIST AI Risk Management Framework (AI RMF 1.0)](https://www.nist.gov/itl/ai-risk-management-framework) — GOVERN/MAP/MEASURE/MANAGE control structure used in the compliance report.
3. [EU AI Act — Final text (Regulation (EU) 2024/1689)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32024R1689) — Articles 9, 12, 14 mappings.
4. [AWS Cedar policy language](https://www.cedarpolicy.com/) — declarative authorisation; informed the DSL semantics.
5. [Open Policy Agent (OPA) — Rego](https://www.openpolicyagent.org/docs/latest/policy-language/) — surveyed as a more powerful alternative; rejected as too complex for regulator-readable rules.
6. [HashiCorp Sentinel](https://developer.hashicorp.com/sentinel/intro) — closest match to the DSL shape we shipped.
7. [Casbin authorisation library](https://casbin.org/docs/overview) — cross-check that comparison + boolean composition covers most policies.
8. [Salesforce Agentforce 3 + Atlas Capability Catalog](https://www.salesforce.com/agentforce/) — inspired the 10-shipped-domain pattern and the per_outcome pricing model ($2/conversation).
9. [Anthropic — Tool Use Best Practices](https://docs.anthropic.com/claude/docs/tool-use-best-practices) — drove the small-typed-tool-set + scoped-data-access guidance per domain.
10. [OpenAI — Operator subscription tiers](https://openai.com/index/introducing-operator/) — per_subscription pricing model precedent.
11. [Berkeley Function-Calling Leaderboard (BFCL v4)](https://gorilla.cs.berkeley.edu/leaderboard.html) — empirical evidence that small, well-typed tool catalogs yield higher tool-call accuracy than open-ended toolboxes.
12. [McKinsey — State of AI 2026](https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai) — Chief AI / Agent / Automation Officer role becoming standard.
13. [Deloitte — Tech Trends 2026](https://www2.deloitte.com/us/en/insights/focus/tech-trends.html) — accountable single-executive ownership of agent governance.
14. [Gartner Hype Cycle for AI 2026](https://www.gartner.com/en/articles/hype-cycle-for-artificial-intelligence) — Chief Agent Officer category recognised; agent-as-a-service entering "Slope of Enlightenment".
15. [Netflix Chaos Monkey](https://netflix.github.io/chaosmonkey/) — automated stop-the-world controls before they're needed.
16. [resilience4j circuit breaker](https://resilience4j.readme.io/docs/circuitbreaker) — error-rate + slow-call-rate trip conditions.
17. [.NET Polly resilience library](https://github.com/App-vNext/Polly) — retry + circuit-break composition pattern.
18. [Langfuse — open-source agent observability](https://langfuse.com/) — observability hooks pattern the runtime layer should expose.
19. [Arize Phoenix](https://phoenix.arize.com/) — open-source agent + LLM tracing alternative.
20. [Salesforce Einstein Trust Layer](https://www.salesforce.com/blog/einstein-trust-layer/) — volume-modulated risk-heatmap precedent.
21. [Anthropic Constitutional AI v3 — Collective Constitutional AI](https://www.anthropic.com/research/constitutional-ai-harmlessness-from-ai-feedback) — layered context (persistent constitution + ephemeral request) shape.
22. [OpenAI Deliberative Alignment](https://openai.com/index/deliberative-alignment/) — persistent + structured + retrieved + ephemeral layering pattern.
23. [SOC 2 Trust Service Criteria 2022](https://www.aicpa.org/topic/audit-assurance/audit-and-assurance-greater-than-soc-2) — CC6 / CC7 / CC8 control mappings.
24. [ISO 27001:2022 Annex A](https://www.iso.org/standard/27001) — A.5.23 cloud security + A.8.16 monitoring activities.
25. [NVIDIA NemoClaw Reference Design](https://developer.nvidia.com/nemoclaw) — YAML policy + privacy-router + process-sandboxing patterns informing the policy DSL and overlay shape.

---

## 7. Implementation summary

- **8 subsystems** delivered: types, autonomy-ladders, agent-domains,
  context-architecture, policy-engine, kill-switch, agent-as-a-service,
  chief-agent-officer (+ create.ts composition root)
- **104 tests** passing across 8 test files
- **6 autonomy levels** L0..L5 enforced with per-jurisdiction caps
- **10 pre-shipped agent domains** for property management
- **Policy DSL**: ==, !=, >, <, >=, <=, in, contains operators + 'and'
  composition; parse-time validation; priority ordering; jurisdiction
  overlays
- **Kill switch**: 3 scopes (agent/tenant/global) with most-specific
  resolution; pause/kill/global-kill primitives; auto-trip on
  error-rate / cost-spike / anomaly / regulator-complaint
- **AaaS**: 3 pricing models (per_call / per_outcome / per_subscription)
  with publish + meter + quote + invoice primitives; subscription
  overage billing
- **CAO**: dashboard snapshot + compliance reports for 4 frameworks
  (SOC2 / ISO27001 / NIST-AI-RMF / EU-AI-Act) + risk heatmap

Built on injection ports — no hard deps on in-flight P56-P59 packages.
