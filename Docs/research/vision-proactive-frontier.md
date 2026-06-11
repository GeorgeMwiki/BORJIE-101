# Vision Dossier — Proactive / Ambient Agency and the Frontier Beyond 2026

**Lane:** `proactive-ambient-and-beyond-2026`
**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Author:** frontier-research pass (deep current online survey + invented beyond-today leaps)
**Scope:** What it means for Mr. Mwikila — the brain inside Borjie (AI-native mining-estate OS) — to *act without being prompted*: continuous org-optimization loops, ambient agency, and the most ambitious angles the owner has **not** yet named. Survey of real June-2026 work, then a deliberate push past it.

> **Sibling parity note.** Everything here is domain-neutral by construction. Borjie = mining-estate deep; BossNyumba = real-estate deep. The proactive/ambient *engine* (sensor → trigger → simulate → propose → gate → act → verify → learn) is the SAME body in both repos; only the domain sensors and the deterministic engines differ. Every section below ends with the BN-parity implication.

---

## 0. The one-paragraph thesis

The 2026 frontier has moved the center of gravity from **prompt → answer** to **observe → anticipate → act → verify**, with the human setting policy *once* and the agent executing *many instances* inside guardrails ([MindStudio post-prompting](https://www.mindstudio.ai/blog/what-is-the-post-prompting-era-proactive-ai-agents), [BuildBetter observational AI](https://blog.buildbetter.ai/ai-agents-that-watch-you-work-how-personal-ai-learns-from-observation-in-2026/)). Borjie already has the *defense moat* (meta-rail, policy-gate, RLS, hash-chained audit, kill-switch) that makes proactivity *safe to ship* — which is exactly the gate the rest of the industry is still scrambling to build ([Aisera agentic compliance](https://aisera.com/blog/agentic-ai-compliance/)). The gap is not safety; it is that almost every proactive organ in `MASTER_GAP_REGISTER.md` (ambient runtime EA-07, self-extension AUT-02, sleep-loop AUT-06, proactive-triggers worker AUT-12) is **built-but-dark**. This dossier maps each frontier capability to a real 2026 source, then names the leap the owner has not articulated.

---

## 1. Proactive / ambient agency — "the best agents have stopped waiting for prompts"

### State of the art (real, June 2026)
- **The post-prompting paradigm is named and operational.** Proactive agents "run in the background continuously, checking conditions and acting only when necessary" — the industry calls this **ambient AI**: always present, surfaces only when relevant ([MindStudio](https://www.mindstudio.ai/blog/what-is-proactive-ai-agents-shifting-reactive-anticipatory), [Buttondown: Proactive AI](https://buttondown.com/verified/archive/proactive-ai-the-paradigm-shift-from-prompts-to/)). Observational agents "watch what you do, learn from patterns, and reach out when they can actually help" — **OpenAGI runs as a daemon that learns by watching** ([BuildBetter](https://blog.buildbetter.ai/ai-agents-that-watch-you-work-how-personal-ai-learns-from-observation-in-2026/)).
- **The hard problem is timing, and it's now a measured RL problem.** **ProActor** (ACL 2026, [arXiv 2605.24900](https://arxiv.org/html/2605.24900v1)) makes proactivity a *timing-aware* RL objective via GRPO at the dialogue-turn level. It defines explicit metrics: **Proactive Timing (PT)** rewards firing inside the "reference-ready window," **Fault Trigger Rate (FTR)** penalizes firing outside valid ranges, **Ready Action Rate (RAR)**. The decision rule: act "no later than the reference-ready window" — *early-but-not-premature*. This is the formal answer to "when should the MD speak up vs stay silent."
- **Intent + long-term memory gate the action.** **PASK** ([arXiv 2604.08000](https://arxiv.org/pdf/2604.08000)) only acts proactively when (a) inferred intent confidence exceeds a threshold and (b) long-term memory shows a recurring pattern — explicit **confidence-thresholding** to "balance helpfulness with avoiding unwanted interventions."

### Where Borjie stands
The proactive substrate exists and is dark: `ambient-listener` is STT-only, `proactive-triggers-worker` subscribes to no estate event stream, `proactive-nudge` has no event sink (EA-07, AUT-12 in the gap register). The owner's own UI invariant already encodes the *right* answer — "change only upon reasoned need," propose-and-gate — which is precisely ProActor's PT/FTR trade-off expressed as product policy.

### BEYOND-TODAY LEAP (owner has not named this)
**A calibrated "interruption budget" as a first-class, conformal-gated resource.** Every other product treats proactivity as a binary (notify / don't). Borjie should treat the owner's *attention* as a scarce, **conformally-priced** asset: bind ProActor's PT/FTR directly to the already-built `conformal-calibration-online` (COG-03) so the MD only surfaces a proactive proposal when calibrated value-of-information exceeds the *measured* annoyance cost for that specific owner — and **the threshold itself is learned per-owner from accept/dismiss/undo telemetry** (the EA-09 VoI scorer). The leap: a **silent estate that earns the right to speak** — proactivity that gets *quieter and more precise* the longer it runs, with a provable miscoverage bound on "should I have interrupted." No competitor has wired calibration into the interruption decision.

**BN parity:** identical engine; mining sensors (assay drift, royalty-due, FX cliff) swap for RE sensors (lease expiry, arrears, valuation drift).

---

## 2. Continuous org-optimization loops & self-healing operations

### State of the art (real, June 2026)
- **Closed-loop self-healing is the canonical operations pattern.** Agentic SRE = detect → classify → remediate → **verify** → escalate, where "every action is validated by continuous monitoring and reverted if it produces adverse effects" ([Unite.AI Agentic SRE](https://www.unite.ai/agentic-sre-how-self-healing-infrastructure-is-redefining-enterprise-aiops-in-2026/), [aicompetence closed-loop](https://aicompetence.org/closed-loop-remediation-self-healing-aiops/)). Multi-agent LLM pipelines (drift detector → root-cause analyzer → remediation generator → **post-remediation validator**) self-correct in "small, controlled increments" ([Zenodo self-healing IaC](https://zenodo.org/records/19234454)).
- **There is an explicit autonomy maturity curve**: read-only insights → advised actions → approval-based remediation → autonomous-with-guardrails ([Rootly AI SRE](https://rootly.com/ai-sre-guide), [Komodor](https://komodor.com/blog/komodor-introduces-autonomous-self-healing-capabilities-for-cloud-native-infrastructure-and-operations/)). "Autonomous" explicitly does *not* mean unsupervised — the human "sets policy once and the agent executes many instances."

### Where Borjie stands
The detect→remediate→verify loop is exactly the shape of the missing self-improvement spine: replay→eval→update (AUT-06), earned/graduated autonomy with tripwire auto-demote (AUT-04), the autonomy-controller meta-rail (RSS-16). Borjie already has the *verify-and-revert* primitives — shadow→canary→burn-rate rollback (EA-12, AUT-15) — that the SRE world calls closed-loop. They are simply not chained to the body-change executor yet.

### BEYOND-TODAY LEAP
**Self-healing applied to the *business* layer, not just infra.** Everyone self-heals Kubernetes. Nobody self-heals a *mining estate*. The leap: a closed-loop remediation pipeline whose "incidents" are **operational/financial drifts** — a royalty filing trending late, a licence renewal inside its risk window, an offtake contract breaching an elasticity threshold, gold-room mass-balance out of tolerance (DM-04), a tenant's KYC expiring. The MD runs the SRE loop over the *estate's economic state*: detect drift → root-cause via the world-model → generate the corrective action (file the return, draft the renewal, re-hedge) → **simulate it before commit** (RSS-17) → propose-and-gate → execute through `LedgerService.post` → **post-action validator confirms the books balanced and the licence row is correct**, else auto-rollback the saga (EXEC-saga). The owner directive "an estate that runs itself overnight" is *literally* the SRE maturity curve applied to mining operations. **The graduated-autonomy engine (AUT-04) is the maturity curve made executable**: a flow earns AUTO only after N clean closed-loop runs, and a single tripwire demotes it to `gated`.

**BN parity:** RE drifts (rent-roll arrears, WALT erosion, debt-covenant DSCR breach, lease expiry) ride the identical loop.

---

## 3. Compliance-as-code that re-checks itself

### State of the art (real, June 2026)
- **Compliance has shifted from point-in-time to continuous, PR-gated, self-checking.** "2026 marks a fundamental shift from point-in-time inspection to continuous assessment and pulse monitoring"; **Violation Detection Agents scan 24/7** against rules + ML and "map 10,000 controls against every applicable regulation in seconds" ([Panto compliance-as-code](https://www.getpanto.ai/blog/ai-powered-code-compliance-platforms), [Digiqt](https://digiqt.com/blog/ai-agents-in-regulatory-compliance/), [Lyzr](https://www.lyzr.ai/blog/ai-agents-for-compliance-checks/)).
- **"Compliance by design"** embeds regulatory/legal/ethical requirements *into the architecture* via an AI integrative layer, not as a downstream audit ([4CRisk](https://www.4crisk.ai/post/four-core-concepts-in-the-new-2026-ai-powered-compliance-by-design), [RegTech Analyst](https://regtechanalyst.com/four-ways-ai-powers-compliance-by-design-in-2026/)).

### Where Borjie stands
Borjie's `inviolable.ts` meta-rail, evidence-required junior outputs, and the Auditor Agent already *are* compliance-by-design. The dark piece is the **standing regulatory-change sensor** (KI-17) and the real **regulator-feed adapter** (Tumemadini/NEMC/TRA/BoT/GePG, KI-16) — the corpus pipe that would let compliance *re-check itself against a moving rulebook*.

### BEYOND-TODAY LEAP
**Compliance that rewrites its own checks when the law changes — a closed regulatory loop.** Wire the regulator-feed sensor (KI-16/17) → diff today's regulation against the corpus → when a delta is verified, the MD **proposes an amendment to its own compliance rules** (a new check, a changed threshold, a new required evidence type), routes it through the body-change meta-rail for four-eye approval, and on approval the new check goes live *and is replayed against the existing estate* to surface any position that just became non-compliant. This is "compliance-as-code that re-checks itself" taken one level up: the *code that does the checking* is itself synthesized, gated, versioned, and rollback-able. Pair with **sleep-time compute** (§7): the nightly pass pre-computes "which of my 10,000 controls would fire if regulation X drifts by Y" so the morning brief already carries the answer. No GRC vendor closes this loop back into self-modifying checks under a hard human gate.

**BN parity:** swap TZ mining regulators for RE/planning/land-tenure/REIT regulators; the self-rewriting-check loop is identical.

---

## 4. Autonomous negotiation & procurement

### State of the art (real, June 2026)
- **Negotiation is now protocol-based and machine-speed.** Autonomous Negotiation Agents conclude in *seconds* what took weeks, operating inside **"elasticity thresholds"** (price, quality, ESG blockers) with auto-escalation when a counterparty exits bounds, and running **thousands of parallel negotiations across the supplier tail** ("Implicit Consortia," "dynamic demand pooling") ([Keelvar](https://www.keelvar.com/knowledge-hub/autonomous-negotiation-agents-the-end-of-the-chatbot-era-in-sourcing), [SupplyChainBrain](https://www.supplychainbrain.com/blogs/1-think-tank/post/43687-why-2026-is-the-year-of-ai-agents-for-autonomous-procurement), [Pactum](https://procurementmag.com/news/pactum-transforms-procurement-with-its-agentic-ai-platform)).
- **The payment rails for agent-to-agent commerce now exist as standards.** Google's **AP2** (donated to the FIDO Alliance, May 2026; v0.2 added **"Human Not Present" autonomous payments**) represents every agent purchase as three cryptographically-signed **Mandates**: Intent → Cart → Payment, signed by verifiable credentials ([AP2 protocol](https://ap2-protocol.org/), [Google Cloud AP2](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol), [No Hacks: 60 orgs](https://nohacks.co/blog/agent-payments-protocol-60-organizations)). The broader plane: **UCP / A2A / MCP** for agent interoperability ([BattleBridge ACP guide](https://battlebridge.com/blog/agentic-commerce-protocol/), [Wikipedia: agentic commerce](https://en.wikipedia.org/wiki/Agentic_commerce)). Note the live attack surface: **prompt-injection red-teaming of AP2** is already published ([arXiv 2601.22569](https://arxiv.org/pdf/2601.22569)).

### Where Borjie stands
The marketplace, bids, buyers-KYC, and sales-offtake juniors exist; FX-treasury exists. There is no autonomous *negotiation* organ, no elasticity-threshold engine, and no agent-payment-mandate layer. But Borjie's money path already mandates `LedgerService.post` + four-eye dual control — the perfect substrate onto which AP2's Intent/Cart/Payment mandate triad maps almost 1:1.

### BEYOND-TODAY LEAP
**The MD negotiates the offtake/procurement book autonomously inside owner-set elasticity thresholds, settling via signed mandates — with the audit chain as the mandate ledger.** The leap is twofold: (1) **map AP2's three-mandate structure onto Borjie's existing hash-chained audit + policy-gate** so every autonomous negotiation produces an Intent Mandate (owner's authorized range, e.g. "sell ≥ X grade at ≥ Y price, ESG-clean buyers only"), a Cart Mandate (the deal the MD assembled across parallel buyer negotiations), and a Payment Mandate (settled through `LedgerService.post`) — each a row in the append-only chain, each four-eye-gated above threshold. (2) **"Implicit Consortia" for artisanal-to-mid-tier miners**: the MD pools demand across *many small Borjie tenants* (privacy-safe, §5) to negotiate buyer terms no single artisanal miner could command — a structural advantage impossible without a multi-tenant brain. Defense moat is non-negotiable here: every autonomous negotiation passes the already-built `tool-use-validator` + `indirect-injection-detector` (SEC-G1) *because* AP2 is a known prompt-injection target.

**BN parity:** lease/acquisition/vendor negotiation for RE; same mandate triad, same consortia pooling across landlords/funds.

---

## 5. Privacy-safe cross-tenant network effects & benchmarking

### State of the art (real, June 2026)
- **Cross-tenant benchmarking without raw-data sharing is a solved pattern class.** Tenants contribute *summarized* data to a secure commingling layer and receive the pooled benchmark in return, "maintaining privacy over their detailed data" ([USPTO summary-based benchmarking](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10606906), [USPTO differential-privacy benchmarking](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11853461)).
- **The PET toolkit is mature**: Differential Privacy, Homomorphic Encryption, Secure MPC, TEEs; **federated analytics** with Byzantine-robust aggregation is the 2026 default for decentralized data ([arXiv federated analytics survey](https://arxiv.org/pdf/2404.12666), [Preprints federated zero-trust](https://www.preprints.org/manuscript/202510.1928)).

### Where Borjie stands
Borjie ships `dp-federation`, `graph-privacy`, an RDP accountant, and the `privacy-router` — but the accountant is closed-form only (no subsampled-Gaussian/PRV, DP-07) and the two ledgers don't share a unit. RLS + the global corpus (`tenant_id = NULL`) already enforce strict isolation. The cross-tenant *value-creation* layer is entirely unbuilt.

### BEYOND-TODAY LEAP
**A privacy-preserving estate benchmark that makes Borjie smarter the more estates join — a true data network effect under DP.** The leap the owner has not named: a **DP-gated cross-tenant benchmark** that lets a Tanzanian artisanal miner see "your processing recovery is in the 30th percentile of comparable gold operations; your royalty-to-revenue ratio is 1.4× the cohort median; your assay-to-payment lag is the cohort's worst quartile" — **without any tenant ever seeing another's raw data**, enforced by the existing `privacy-router` + a finished subsampled-RDP accountant (DP-07). Three compounding effects: (1) the benchmark is a product moat that grows with every tenant; (2) the *pooled, de-identified* corpus feeds the self-improvement loop (AUT-06) so the brain literally gets better for everyone as the network grows; (3) it powers the §4 Implicit Consortia. This is the one capability a single-tenant competitor *structurally cannot* replicate. Hard invariant: the offense (network learning) is safe ONLY because of the defense (DP budget + RLS + WITH-CHECK corpus split, DP-02) — one system, never separable.

**BN parity:** RE cohort benchmarks (cap-rate, WALT, arrears, opex/sqft percentile) — arguably an even stronger network effect given denser comparables.

---

## 6. Predictive org design & the self-constructing organizational brain

### State of the art (real, June 2026)
- **Org charts are becoming fluid "work charts."** Agentic AI "changes the shape of the organization": spans of control widen, new supervisory roles appear, the junior-does/senior-reviews pyramid inverts ([MIT Tech Review](https://www.technologyreview.com/2026/05/26/1137584/rethinking-organizational-design-in-the-age-of-agentic-ai/), [PwC no-more-pyramids](https://www.pwc.com/us/en/tech-effect/ai-analytics/agentic-ai-workforce-redesign.html), [Inkeep org chart](https://inkeep.com/blog/org-chart)). A small operator can "restructure without a reorg consultant by answering one question per agent: who owns it, who reviews it, who catches the edge cases" ([CloudRadix](https://cloudradix.com/blog/rethinking-org-design-agentic-ai-mid-market-2026/)).
- **The Predictive Organization** ([SSRN 6230780, Feb 2026](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6230780)) proposes a tripartite architecture: a **State layer (the Map)**, a **Dynamics layer (the Physics)**, and an **Agentic layer (the Player)**, over a **claims-based knowledge representation grounded in standardized ontologies** — the org models, simulates, and predicts its own future states.

### Where Borjie stands
This is the owner's *core* vision — "a self-constructing organizational brain that synthesizes the org data-model, surfaces, org-graph, task-routing dynamically." Borjie already has the exact tripartite shape latent: the **system-graph / body-schema** (EA-01) is the *Map*; the **world-model + counter-model** (RSS-17) is the *Physics*; the kernel orchestrator + juniors are the *Player*. The `org-graph` package and `self-extension` keystone (AUT-02 — `detectRecurringGap → proposeNewSubMd → four-eye → compileAndDeploySubMd`) are the self-constructing mechanism. All dark.

### BEYOND-TODAY LEAP
**The MD doesn't just staff the org — it *predicts the org it will need next quarter* and pre-builds it under gate.** The Predictive Organization's Map/Physics/Player maps directly onto Borjie's body-schema/world-model/kernel. The leap: run the **org-design loop as a forward simulation** — the MD uses the world-model (Physics) to roll the estate forward ("if this licence is granted and we add a second pit, I will need a metal-accounting junior, a closure-provisioning junior (DM-06), and a third KYC reviewer by Q3"), then **proactively drafts those sub-MDs via self-extension (AUT-02)** and surfaces them as gated proposals *before the bottleneck arrives*. This is ProActor's "reference-ready window" (§1) applied to *organizational capacity itself*: spawn-the-capability-before-the-need, the embodiment EA-07 directive lifted from UI to org structure. The owner has named "synthesizes the org-graph dynamically"; the unnamed leap is **predictive, simulation-driven org design** — the estate restructures itself ahead of demand, reversibly, under four-eye.

**BN parity:** EA-10 flags BN has actuators but ZERO body-model layer — porting system-graph + world-model to BN is the prerequisite for predictive org design there.

---

## 7. The estate that runs itself overnight — sleep-time compute & nightly self-improvement

### State of the art (real, June 2026)
- **Sleep-time compute is a quantified, real technique.** Pre-compute useful quantities from context *while idle*, before queries arrive: **~5× less test-time compute** for equal accuracy, **+13–18% accuracy** when scaling sleep-time, and **2.5× cost reduction per query** when ~10 related queries share a context — *most effective when queries are predictable from context* ([arXiv 2504.13171](https://arxiv.org/html/2504.13171v1)).
- **Autonomous overnight continual learning is here.** Wake/sleep oscillation (online learning awake, restricted offline consolidation asleep — [SIESTA](https://arxiv.org/pdf/2303.10725)); **ACuRL** autonomous curriculum RL adapts agents to an environment with **zero human data** ([arXiv 2602.10356](https://arxiv.org/abs/2602.10356)); "continual learning, not training — online adaptation for agents" ([arXiv 2511.01093](https://arxiv.org/abs/2511.01093)).
- **Counterfactual world models** let an agent simulate "what if I intervene?" before acting ([CWMDT, arXiv 2511.17481](https://arxiv.org/abs/2511.17481)). **Vendors are shipping the autonomous enterprise**: SAP's Autonomous Suite orchestrates 200+ agents to run processes "start-to-finish," human "sets goals and limits" ([SAP Sapphire 2026](https://news.sap.com/2026/05/sap-sapphire-sap-unveils-autonomous-enterprise/), [Help Net Security](https://www.helpnetsecurity.com/2026/05/12/sap-autonomous-enterprise-business-workflows/)); ServiceNow + Google Cloud likewise ([Google Cloud](https://www.googlecloudpresscorner.com/2026-04-22-ServiceNow-and-Google-Cloud-Unite-AI-Agents-for-Autonomous-Enterprise-Operations)).

### Where Borjie stands
The "gets better every night while the mine sleeps" promise is the entire Wave D tail: sleep-pass-orchestrator, replay→eval→update (AUT-06), GEPA/AFlow/ADAS/DGM (AUT-08/07/09/10), Voyager autotelic curriculum (AUT-11). The workers exist but have **no Dockerfile/manifest and are not deployed** (AUT-12). Borjie's `world-model`/`counter-model` (RSS-17) is the counterfactual organ — unwired as a forced pre-commit gate.

### BEYOND-TODAY LEAP
**The overnight pass doesn't just consolidate memory — it pre-computes tomorrow's decisions and pre-stages the morning's proposals.** Sleep-time compute's core finding (most valuable when queries are *predictable from context*) is a perfect fit: a mining estate's next-day questions are *highly* predictable from today's state (open bids, due royalties, FX exposure, licence windows, pending KYC). The leap: the nightly sleep-pass (a) **runs sleep-time compute** to pre-answer the owner's likely morning questions against the day's accumulated context (2.5×+ cheaper, 5× less morning latency, near-instant brief); (b) **runs counterfactual world-model rollouts** ("if FX moves 3%, if this assay comes back low, if the regulator publishes the expected amendment") and **pre-stages gated proposals** so the morning brief is a *set of one-click decisions*, not a report; (c) **runs the ACuRL-style autotelic curriculum (AUT-11)** over the day's failures to harden weak juniors with zero human data; (d) does it all **as a leader-elected, single-replica cron** (RSS-06 cluster-lock) so it runs once, not 26× (the real cost trap). The owner's "runs itself overnight" becomes literal: **the estate wakes up having already done the thinking, simulated the risks, and queued the decisions — the owner's first coffee is a sequence of approve/undo, not a backlog.** Pair with §1's interruption budget so the morning surfaces only the proposals that cleared the conformal VoI bar.

**BN parity:** identical sleep-pass; RE's overnight is even more predictable (rent cycles, lease calendars, debt service dates).

---

## 8. The unifying frontier picture (one loop, named)

Every section above is the **same loop** at a different altitude:

```
        ┌────────── ambient SENSE (event streams, regulator feeds, telemetry) ──────────┐
        │   EA-07 ambient runtime · KI-16/17 regulator sensor · EA-03 proprioception     │
        ▼                                                                                  │
  ANTICIPATE (timing) ── ProActor PT/FTR window · PASK intent+memory · sleep-time precompute
        ▼                                                                                  │
  SIMULATE before act ── world-model/counterfactual (RSS-17) · org-design forward roll      │
        ▼                                                                                  │
  PROPOSE under gate ── body-change meta-rail · conformal interruption budget · UI invariant │
        ▼                                                                                  │
  ACT inside thresholds ── elasticity bounds · AP2 mandate triad · LedgerService.post        │
        ▼                                                                                  │
  VERIFY & heal ── post-action validator · saga rollback · graduated autonomy tripwire ──────┘
        ▼
  LEARN overnight ── replay→eval→update · GEPA/AFlow/ADAS/DGM · DP-pooled network learning
```

**The keystone remains `COG-07/AUT-14` (the modality arbiter):** proactive agency needs a head that can choose ANSWER / SKILL / WORKFLOW / **LOOP** / AGENT. The LOOP variant *is* ambient agency. Until it ships, every organ in this dossier has nowhere to land.

**The invariant that makes all of it shippable:** the offense moat (proactivity, self-extension, autonomous negotiation, network learning) is safe ONLY because of the defense moat (meta-rail, policy-gate, RLS+WITH-CHECK, hash-chained audit, kill-switch fail-closed, conformal abstention). They are ONE system. Money / licence / deletion stay dual-control HITL forever; the agent grows capability but can never touch its own gate/audit/test machinery (`inviolable.ts`). This is also *why Borjie can ship proactivity that the SAP/ServiceNow tier is still building the guardrails for* — the guardrails came first.

---

## 9. Prioritized "turn-the-lights-on" sequence for the proactive frontier

1. **Modality arbiter + LOOP executor** (COG-07/AUT-14) — the head ambient agency lands on. *Without this nothing else is reachable.*
2. **Ambient sensor plane** (EA-07 event subscriber + KI-16/17 regulator feed) — the SENSE half of the loop.
3. **Conformal interruption budget** (new, on COG-03) — the TIMING gate; turns proactivity from noisy to earned.
4. **Forced simulate-before-act** (RSS-17 pre-commit) + **counterfactual nightly rollouts** — the FORESIGHT half.
5. **Deploy the sleep-pass workers** (AUT-12 Dockerfiles/CronJobs, leader-elected via RSS-06) + **sleep-time precompute** — "runs itself overnight."
6. **Graduated autonomy + self-healing business loop** (AUT-04 + AUT-06) — the VERIFY/HEAL/earn-AUTO spine.
7. **Self-rewriting compliance checks** (KI-17 → body-change) and **predictive org design** (AUT-02 self-extension) — the two highest-leverage *beyond-today* leaps, both already substrate-ready.
8. **DP cross-tenant benchmark** (finish DP-07) + **AP2-mapped autonomous negotiation** (on existing audit/policy-gate) — the network-effect and revenue moats, shipped last because they compound on 1–7.

Each line is already a row (or a near-neighbor of a row) in `MASTER_GAP_REGISTER.md` — the frontier is not a rewrite, it is **wiring the dark organs into one proactive loop and adding the named leaps on top.**
