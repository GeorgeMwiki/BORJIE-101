# Agentic Workforce — State of the Art, May 2026

**Audience:** Borjie kernel + product team
**Question:** What does "AI literally manages your employees" look like in 2026, and which patterns survive contact with a Tanzanian estate company?
**Stance:** Opinionated. Citations or omission. Hype labelled.

---

## §1 — Frontier agentic workforce products

The market is bifurcated. **Customer-facing** agents (Sierra, Decagon, Ada) talk to end-users. **Employee-facing** copilots (Glean, Sana, Copilot) help workers. A third, thin slice — what Borjie is becoming — *directs* workers. Most famous names sit in the first two buckets; we synthesise our pattern from pieces.

1. **Sierra (sierra.ai)** — Raised $950M Series E at $15.8B in May 2026; claims >40% of Fortune 50. Agent OS 2.0 ships composable Skills (triage, respond, confirm), declarative Boundaries (deterministic guardrails the model cannot cross — e.g. "orders can only be returned within 30 days"), Workspaces for staging. Customer-service first; expanding into sales with the new capital.

2. **Decagon** — $4.5B valuation in January 2026. Single-model natural-language agent (no flow-chart authoring), omnichannel resolution, "AI Concierge" framing. Faster to set up than Sierra; less expressive at the skill level.

3. **Cognition Devin** — Produces 25% of Cognition's internal code (late 2025). Architecture is the field's most interesting: planner emits a DAG of subtasks, dynamic re-planning on failure, sub-agents for planning/execution/verification/debugging, persistent working memory across sessions, and "Interactive Planning" that asks for human sign-off on the *plan* before execution.

4. **OpenAI Operator** — January 2025 launch; in May 2025 upgraded from GPT-4o to o3-fine-tuned. OSWorld 38.1%, WebVoyager 87%. When stuck, it hands control back — explicit "asks for help" rather than hallucinating success.

5. **Anthropic Computer Use + Claude Agent SDK** — Released October 2024; SDK renamed from Claude Code SDK on September 29, 2025. OSWorld 22.0%, WebVoyager 56% — but the interesting bit is the published multi-agent research pattern: an Opus lead orchestrator spawns Sonnet sub-agents, reported 90.2% lift over single-Opus on internal eval.

6. **Manus AI** (Monica, China) — Beta March 2025. Manus 1.5 (October 2025) cut average task time from ~15 min to <4 min. Pattern: plan-then-execute with deterministic sub-scripts for the boring parts, sub-agent debate for long-horizon planning.

7. **MultiOn / Adept** — Browser "Motor Cortex." MultiOn offers concurrent agents-as-a-service with built-in auth/CAPTCHA/dynamic-content handling. Adept absorbed into Amazon — dead as a standalone.

8. **Cursor Background Agents** — Cursor 0.50 (May 2025); cloud-hosted async agents in sandboxed VMs with ephemeral repo checkouts. Read GitHub issues → produce PRs. 2026 preview extends sessions to hours.

9. **Replit Agent 3** — January 2026; 200-minute autonomous runtime, ~10x Agent V2. UX-targeted at non-engineers.

10. **Workday Sana** — May 13, 2026: Sana Self-Service Agent landed inside M365 Copilot. Sana is "the AI operating system for work" — single front door, bundled for all customers; Sana Enterprise crosses into Salesforce, Slack, Teams, SharePoint. Executes via Workday's *existing* approval matrix rather than reinventing it.

11. **Salesforce Agentforce 360** — Oct 2025; AWS Marketplace Q1 2026. Trust Layer keeps LLM traffic inside Hyperforce's private AWS. Experience Layer separates what an agent does from how it appears. Agents *recommend* permission sets; the grant requires a human.

12. **Microsoft Copilot Studio + Agent 365** — April 2026. Agent 365 is the central control plane across Copilot-Studio and partner agents under one policy umbrella. New Analytics Viewer role separates "I can see what the agent did" from "I can change what the agent does" — a pattern Borjie should copy.

13. **HubSpot Breeze** — GA 2026: Customer/Prospecting/Data Agents. Pay-per-result pricing (the novel idea). Breeze Studio + Marketplace in public beta.

14. **ServiceNow Now Assist** — Thin agentic veneer on a deep workflow engine. Right model if you already live on ServiceNow.

15. **Slack Lists + AI** — In 2026 Lists became agent-readable + writable: agents claim rows, update status, notify owners. Sets a precedent for chat-native task structures.

16. **Glean Agents** — $7.2B valuation, $200M+ ARR (late 2025). 100M+ agent actions/year. May 2026 launch: "enterprise AI coworker — proactively manages tasks, executes multiple workstreams." Introduced the Enterprise Agent Development Lifecycle.

17. **Cresta** — Real-time contact-centre assist. Dec 2025: **Agent Operations Center** supervises both human and AI agents with real-time intervention. Cresta Coach evaluates 100% of conversations and correlates behaviours to outcomes. The closest thing in market to "AI manages your humans" — but only contact-centre.

18. **Stripe Agentic Commerce Suite + ACP** — Dec 2025. Not workforce, but ACP is the first live agent-to-business protocol — precedent for "agent identities" with their own credentials and limits.

**Hype / dead:** Cognosys (dormant), HyperWrite (consumer toy), Adept (absorbed), Lindy / Ema (real but SMB-grade — not the right primitive for a brain).

---

## §2 — Long-horizon task patterns (the hard part)

Demos run 5 minutes; production missions run for days. What survives:

**Multi-day decomposition.** Devin emits a DAG and re-plans on node failure. Manus does plan-then-execute with deterministic sub-scripts. Anthropic's lead/worker pattern (Opus → Sonnet sub-agents) reports the 90.2% lift. **Opinion:** flat ReAct loops plateau quickly and burn tokens; the lead/worker split is real.

**Checkpoint cadence + HITL.** Devin's "Interactive Planning" is the strongest pattern — the human approves the *plan*, not each action. Sierra puts the gate at the Skill boundary as declared deterministic constraints. Workday/Sana defers to the customer's existing approval matrix.

**Self-correction.** Reflexion (Shinn et al., 2023) is canonical: agent generates a natural-language reflection on failure, stores it as episodic memory, retries. 2025 extensions matter: **MAR / Multi-Agent Reflexion** (arXiv:2512.20845) addresses cognitive entrenchment with a separate critic; **PALADIN** (arXiv:2509.25238) targets tool-failure cases specifically; **failure-as-curriculum** (arXiv:2509.25370) treats failed trajectories as training data.

**Cost / budget caps.** No clean solver. Production teams use LangSmith / Langfuse thresholds and human-pause. **Recommendation:** three independent caps per mission — token, wall-clock, tool-call — any one trips → human gate.

**"The goal moved."** Almost no product handles this well. Devin lets the human edit the plan; Manus re-decomposes on prediction-vs-actual divergence. There is no autonomous re-goaling that survives audit.

**Memory.** The 2025 academic consensus (arXiv:2502.06975 — *Episodic Memory is the Missing Piece*) names five properties: long-term storage, explicit reasoning, single-shot learning, instance-specific, contextual. Production pattern is hybrid episodic-semantic: store raw episodes (MemMachine, Zep), consolidate every 50-200 episodes into semantic facts. **Zep** (temporal knowledge graph with episodic/semantic/community subgraphs) is the most cited.

**Frameworks:** LangGraph (Python, production leader, checkpointing), CrewAI (Python, role-playing crews, hierarchical-process bugs documented at GitHub crewAIInc/crewAI#4783, token-hog), AutoGen v0.4 / AG2 (Microsoft, event-driven, Azure-first), OpenAI Agents SDK (Python, minimal), Anthropic Claude Agent SDK (TS + Py, three-phase loop, sub-agents-as-tools, MCP), **Mastra** (TypeScript-native), and LATS (ICML 2024, arXiv:2310.04406 — MCTS over ReAct trajectories with backtracking; already cited in Borjie's kernel).

---

## §3 — Employee-facing copilots vs employee-as-managed-resource

Three patterns:

**(a) Productivity copilots that HELP humans.** M365 Copilot, Gemini in Workspace, Glean Assistant, Cursor chat. Agent sits beside the human; human keeps the wheel. Accountability unchanged.

**(b) Customer-facing orchestration.** Sierra, Decagon, Ada, Forethought (acquired by Zendesk March 2026). Agent replaces the human at the front line. Accountability shifts to the vendor's Boundary config + audit logs.

**(c) Internal orchestration — assign-and-measure.** What Borjie is becoming. Genuinely thin slice. Closest analogs: Cresta Agent Operations Center (supervises human + AI contact-centre agents from one hub), Workday Sana (assigns via Workday's process engine), Glean's May 2026 "enterprise AI coworker," Slack Lists + AI.

Emerging patterns in (c):
- **Agent owns the plan; humans own the work.** Agent decomposes, assigns, follows up, escalates. Humans execute leaves.
- **Audit-first.** Every assignment, follow-up, decision is hash-chained. The audit *is* the accountability surface (Borjie already does this in `packages/observability/`).
- **Manager-of-record stays human.** No 2026 product positions the AI as "the manager" — even Cresta keeps a human supervisor. **This is the right framing for Borjie:** AI proposes, human confirms.

---

## §4 — Performance signals + advisory loops

The 2026 toolkit is mature but shallow.

**Behavioural signals (passive):** latency to first-touch, escalation rate per assignment, re-assignment rate, communication-pattern changes. Cresta Coach evaluates 100% of conversations and correlates behaviours to outcomes.

**Sentiment signals (active):** periodic micro-surveys (Enculture AI, Betterworks, ChartHop in 2026), NLP over chat/email — Everworker AI reports "early disengagement detected weeks before traditional methods."

**Coaching prompts.** Cresta Coach surfaces per-agent reinforcement actions. Betterworks auto-generates 1:1 prep notes. **Honest assessment:** most "AI coaching" is template-fill with personalised context. It works because managers were doing nothing before — not because it's brilliant.

**Roll-ups.** Field's weakest area. Most products do per-individual summaries; few do org-level pattern surfacing. Piece C executive brief is a head-start — extend it to workforce.

---

## §5 — Approval matrices in agentic systems

**Sierra Boundaries.** Declarative deterministic constraints enforced *outside* the model, not by prompting. Treat the approval matrix as code, not as instructions.

**Agentforce Trust Layer.** Three-layer gate: data access (platform), action execution (Boundaries), permission elevation (human approval workflow). The agent recommends; the human grants.

**Operator's "asks for help."** Explicit hand-back. Operator does *not* try mid-action; it pauses, surfaces a clear question, waits.

**Agent 365.** Centralised control plane. Analytics Viewer role separates observation from configuration rights.

**The 2026 consensus pattern** (Strata, Bonjoy, StackAI): trust boundaries are set by **reversibility**, not by importance. Auto-approve cheap-to-undo actions; gate the irreversible ones.

Reversibility rubric to adopt directly:
- **Reversible / low-impact** — agent acts, logs, notifies.
- **Reversible / high-impact** — agent acts, logs, notifies, requires same-day human ack.
- **Irreversible / low-stakes** — agent proposes, human one-click approves.
- **Irreversible / financial or legal** — named-role approval (manager / four-eye / C-level), enforced as a policy-gate predicate, not free-text.
- **Sovereign / inviolable** — already special-cased in Borjie's `inviolable.ts`. Never reason-resolved.

Tier + role + amount predicates compose. Sierra and Agentforce both encode them as types, not paragraphs — copy this.

---

## §6 — Open-source frameworks Borjie could leverage

| Framework | Lang | Strength | Weakness for us |
|-----------|------|----------|-----------------|
| LangGraph | Python | Production-ready, checkpointing, LangSmith | Python adds a service boundary in our TS monorepo |
| CrewAI | Python | Best DX for role-playing crews | Hierarchical-process bugs; token-hog at scale |
| AutoGen v0.4 / AG2 | Python | Event-driven, MS-aligned | Azure-first; sparse non-MS adoption |
| OpenAI Agents SDK | Python | Simplest starting point | Too thin for our HITL + audit needs |
| Anthropic Claude Agent SDK | TS + Py | Three-phase loop, sub-agents, MCP | Newer (Sept 2025); ecosystem catching up |
| **Mastra** | **TypeScript** | Native to our stack; agents+workflows+RAG+eval | Smaller community; less battle-tested >100 agents |
| LATS (pattern) | any | Right pattern for MCTS-style planning | We implement it ourselves |

**Recommendation:** stay on Mastra + Claude Agent SDK. No Python orchestration service. The TS ecosystem in 2026 is mature enough that "Python-or-die" is wrong. Borrow LangGraph *patterns* without the runtime.

---

## §7 — Africa-specific considerations

Most workforce products target desk-bound knowledge workers in low-latency markets. Borjie's workforce is field staff in TZ/KE: caretakers, plumbers, security, station masters, inspectors.

**Offline-first.** Kwendo (Kenya, expanding to TZ + UG 2026) is the proof-point: micro-apps that work offline, sync on reconnect. Sokowatch/Wasoko, Twiga, M-KOPA all built mobile-first with offline + SMS fallback as *requirement*, not afterthought. Assignments must work the same way.

**WhatsApp as primary channel.** Sierra added WA in 2025; nobody has shipped a workforce-grade WA task system. Constraints: WhatsApp Business API templated messages outbound (24h session rule); free-form inbound; the worker's WA is *also* their personal channel — agents must be tone-aware; photos are first-class evidence (a caretaker WhatsApps a photo of the fixed drain — OCR + classify).

**Mobile money.** M-Pesa, Tigo Pesa, Airtel Money. Workforce per-task bonuses ride existing `services/payments-ledger/` rails.

**Language.** Swahili-first for ops; English for executive briefs. Claude 4.5+ and GPT-4o-2026 handle Swahili at production quality; smaller models (Haiku, Mistral) degrade — keep the workforce agent on a frontier model.

**Cellular cost.** Workers pay for data. WhatsApp is metered. Assume 3G with drops. No video. Compressed images.

**Regulatory.** TZ PDPA + KE DPA both require employee consent for behavioural monitoring. Extend the existing consent + audit chain to workforce signals.

---

## §8 — Implementation recommendations for Borjie

### Tables to add (Drizzle, RLS-enforced)

```
workforce_assignments         — agent-issued tasks
workforce_followups           — nudges, reminders, escalations
workforce_check_ins           — structured employee responses (incl. WA photos)
workforce_performance_signals — passive + active behavioural signals
workforce_advisory_briefs     — weekly/monthly AI-written manager briefs
workforce_approval_requests   — pending HITL gates blocking agent action
```

All FK into existing `employees` and respect `app.current_tenant_id` RLS.

### Agent loop shape

```
plan      → decompose mission into assignments (Opus-lead pattern)
assign    → emit workforce_assignments + WhatsApp/SMS via Piece E
monitor   → poll check_ins, recompute signals, prediction-vs-actual gap
nudge     → low-cost reminder, no approval needed
escalate  → triggers workforce_approval_requests against the manager
roll-up   → daily/weekly/monthly advisory_briefs feed Piece C executive brief
```

Slots cleanly between the existing think-pipeline (sensors → policy-gate → debate → LATS) and Piece E action runtime. The workforce agent is one more kernel sensor/effector pair.

### HITL gates (reversibility rubric from §5)

- **Auto:** nudge, reminder, sentiment compute, passive signal capture, brief drafting.
- **One-click:** re-assign, change priority, extend deadline <24h.
- **Manager approval:** escalate across teams, cancel, flag as struggling.
- **Four-eye / C-level:** payroll-impacting, PIP, termination recommendation, cross-tenant signal share.
- **Inviolable:** never the agent. Hardcoded in `inviolable.ts`.

### Five concrete design decisions

1. **AI proposes, human confirms — always.** No autonomous reassignment above reversible / low-impact. The agent is a manager's assistant, not the manager. Survives audit, regulatory scrutiny, TZ/KE cultural expectations.

2. **WhatsApp is the canonical worker channel.** SMS fallback. App for managers. 4-inch screen on 2G. Photos as first-class evidence.

3. **Reversibility-keyed approval matrix encoded as policy predicates.** Sierra-style typed Boundaries in `packages/central-intelligence/src/kernel/policy-gate.ts`, not prompt-stuffed instructions.

4. **Hybrid episodic-semantic memory per worker.** Raw check-ins as episodes; consolidate every ~100 episodes into a semantic worker profile (strengths, blockers, response patterns) à la Zep/MemMachine. Becomes the "weekly 1:1 prep" data source.

5. **Lead/worker agent split.** Opus-class workforce-orchestrator decomposes; Sonnet/Haiku-class workforce-executor runs per-assignment loops. The Anthropic 90.2% lift is too large to ignore.

### Explicit anti-recommendations

- No autonomous performance reviews. Even Cresta keeps a human supervisor.
- No AI termination recommendations. Lawsuit magnets.
- No covert sentiment monitoring. Consent + transparency under TZ PDPA / KE DPA.
- No Python orchestration service. TS-native is the right call in 2026.
- No flat single-agent loop. The lead/worker lift is too large to ignore.

---

## Sources

- [Sierra raises $950M — TechCrunch, May 2026](https://techcrunch.com/2026/05/04/sierra-raises-950m-as-the-race-to-own-enterprise-ai-gets-serious/)
- [Sierra Agent OS 2.0](https://sierra.ai/blog/agent-os-2-0)
- [Sierra Agent SDK (Skills + Boundaries)](https://sierra.ai/product/agent-sdk)
- [Decagon vs Sierra 2026 buyer guide — Cresta](https://cresta.com/guides/decagon-vs-sierra)
- [Devin's 2025 Performance Review — Cognition](https://cognition.ai/blog/devin-annual-performance-review-2025)
- [How Devin AI Actually Thinks: DAG Execution and Dynamic Re-Planning](https://medium.com/@nitinmatani22/how-devin-ai-actually-thinks-autonomous-planning-dag-execution-and-dynamic-re-planning-explained-997be175a475)
- [Introducing Operator — OpenAI](https://openai.com/index/introducing-operator/)
- [Anthropic Computer Use vs OpenAI CUA — WorkOS](https://workos.com/blog/anthropics-computer-use-versus-openais-computer-using-agent-cua)
- [Anthropic Multi-Agent Research System](https://aiagentwire.com/ai-agent-posts/anthropic-multi-agent-research-system)
- [Manus AI — 2025 AI Agent Index, MIT](https://aiagentindex.mit.edu/2025/manus/)
- [From Mind to Machine: Manus AI (arXiv:2505.02024)](https://arxiv.org/pdf/2505.02024)
- [Cursor: Expanding long-running agents](https://cursor.com/blog/long-running-agents)
- [Replit: Introducing Agent 3](https://blog.replit.com/introducing-agent-3-our-most-autonomous-agent-yet)
- [Workday brings Sana into M365 Copilot — May 13, 2026](https://newsroom.workday.com/2026-05-13-Workday-Brings-Sana-Self-Service-Agent-for-HR-and-Finance-Into-Microsoft-365-Copilot)
- [Agentforce 360 launch — Salesforce, Oct 2025](https://www.salesforce.com/news/press-releases/2025/10/13/agentic-enterprise-announcement/)
- [Zero-Trust Infrastructure Powering Agentforce 360](https://engineering.salesforce.com/behind-the-zero-trust-infrastructure-powering-agentforce-360-platform-protecting-20-trillion-transactions/)
- [Microsoft Copilot Studio April 2026 governance](https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/new-and-improved-agent-governance-intelligent-workflows-and-connected-app-experiences/)
- [Cresta launches Agent Operations Center — Dec 2025](https://www.prnewswire.com/news-releases/cresta-launches-agent-operations-center-to-manage-the-human-ai-hybrid-workforce-for-the-customer-experience-302636142.html)
- [Glean: enterprise AI coworker — May 2026](https://www.glean.com/blog/may-2026-launch)
- [Reflexion (Shinn et al.) — Semantic Scholar](https://www.semanticscholar.org/paper/Reflexion:-an-autonomous-agent-with-dynamic-memory-Shinn-Labash/46299fee72ca833337b3882ae1d8316f44b32b3c)
- [Language Agent Tree Search (LATS) — arXiv:2310.04406](https://arxiv.org/html/2310.04406v3)
- [Anthropic Claude Agent SDK — Augment Code analysis](https://www.augmentcode.com/guides/anthropic-agent-sdk-what-ships-vs-what-you-build)
- [Human-in-the-Loop AI Agents — StackAI design guide](https://www.stackai.com/insights/human-in-the-loop-ai-agents-how-to-design-approval-workflows-for-safe-and-scalable-automation)
- [Kwendo: Kenya's offline-first payroll, TZ expansion](https://techparley.com/kenyas-kwendo-targets-africas-600b-informal-economy-with-digital-payroll-revolution/)
- [Stripe Agentic Commerce Suite + ACP](https://stripe.com/blog/agentic-commerce-suite)
