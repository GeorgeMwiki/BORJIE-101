# Frontier Self-Improving / Self-Designing Agent Orchestration

**Audience:** Borjie brain-layer architects (central-intelligence kernel, ai-copilot juniors, orchestration spec owners).
**Date:** 2026-06-08
**Thesis:** The estate MD (Mr. Mwikila) should not merely *route among* a fixed pool of ~50 hand-built juniors — it should be able to **invent, optimize, prune, and recompose its own juniors, workflows, and skills over time**, under hard governance. This dossier maps the actual frontier work that makes that real, and shows precisely where each idea goes **beyond** the naive brief ("keep flows gated until proven, then flip to auto + spawn UI tabs").

> **What the brief gets right but stops short of.** The current `ORCHESTRATION_SPEC.md` already nails *routing* (modality arbiter ANSWER/SKILL/WORKFLOW/LOOP/AGENT), *graduated autonomy* (gated→earned-AUTO with tripwire demotion), and *skill capture* (Voyager-style compile-on-success). That is **selection over a fixed design space**. The frontier below is **search over the design space itself** — the system writing new juniors and new orchestration code, optimizing the prompts/topology of the team, and running a continuous offline replay→eval→update loop. The naive version improves *which* hand-built piece runs; the frontier version improves *the pieces and the formulation*.

---

## 0. The organizing frame: What / When / How / Where to evolve

The 2025 survey *A Survey of Self-Evolving Agents* (arXiv:2507.21046) gives the canonical taxonomy that the rest of this dossier hangs on. An agent can evolve along four axes, and the operational test is that updates must be **experience-dependent (trajectory-driven), produce persistent policy-changing effects, and involve autonomous exploration — excluding static pipelines.**

- **WHAT** — models/policy, context (memory + prompts), tools/skills, and **architecture (workflows + multi-agent topology)**.
- **WHEN** — *intra-test-time* (within a single task: in-context, on-the-fly SFT/RL) vs *inter-test-time* (between tasks: persistent updates, memory consolidation, workflow refinement). Online vs offline; on-policy vs off-policy.
- **HOW** — reward-based (textual / internal / external / implicit), imitation/demonstration, population-based/evolutionary, and **textual gradients** (unstructured NL feedback as a differentiable signal).
- **WHERE** — domain-general (memory, curriculum) vs domain-specific (coding, finance, GUI, medical).

The survey explicitly flags the risks Borjie must engineer against: **behavior drift, catastrophic forgetting, misaligned goal pursuit** as autonomy rises; and an evaluation gap across **adaptivity / retention / generalization / efficiency / safety**.

**Beyond the brief:** the brief evolves only "context" (skill capture) and "policy" (autonomy posture) for a *frozen* set of juniors. The taxonomy says the highest-leverage axis Borjie isn't touching is **architecture** — the formulation of juniors and the topology of the team — and the most underused mechanism is **textual gradients** over the whole compound system. Source: https://arxiv.org/abs/2507.21046 (fetched).

---

## 1. ADAS — Automated Design of Agentic Systems (agent-as-optimizable-program)

**Hu, Lu, Clune — arXiv:2408.08435 (ICLR 2025).** The reframing: because programming languages are Turing-complete, an agent defined *as code* can in principle express "any possible agentic system: novel prompts, tool use, workflows, and combinations thereof." **Meta Agent Search** instructs a *meta agent* to iteratively *program* new agents against an **ever-growing archive of prior discoveries**, evaluate them, and add the good ones back to the archive. The discovered agents **beat state-of-the-art hand-designed agents** across coding/science/math and — the surprising result — **transfer across domains and models** (an agent invented on one benchmark/model keeps its edge elsewhere).

**Beyond the brief:** This is the single biggest leap past "spawn-tabs over fixed juniors." The brief's juniors are hand-authored TypeScript (`packages/ai-copilot/src/juniors/*.ts`); ADAS says the *meta agent writes the junior*. Borjie already has the two scaffolds ADAS needs — a **code-space agent representation** (each junior is a typed module with a Zod schema in `executor-registry.ts`) and an **archive** (the skill-library + `decisionLog`). The unlock: a guarded "Meta-MD" pass that, when no existing junior fits a recurring estate problem (e.g. a novel tailings-dam monitoring flow), **drafts a new junior as code** in the archive, smoke-tests it on replayed cases, and human-gates promotion — inventing capability rather than only routing to it.

- Paper: https://arxiv.org/abs/2408.08435 (fetched) · Code: https://github.com/ShengranHu/ADAS (UNVERIFIED)

---

## 2. Darwin Gödel Machine — empirical recursive self-improvement of the agent's own code

**Sakana AI / UBC / Vector — arXiv:2505.22954 (2025).** The DGM keeps an **archive (lineage) of coding-agent variants**, samples one, and uses a foundation model to write "a new, interesting version" — improving *its own ability to modify its own codebase*. Crucially it replaces Schmidhuber's original requirement of a **formal proof** of benefit (intractable in practice) with **empirical fitness**: each self-edit is scored on real benchmarks. Results: **SWE-bench 20.0%→50.0%; Polyglot 14.2%→30.7%**, with the system inventing better edit tools, long-context management, and **peer-review mechanisms** on its own. All runs were done **with sandboxing + human oversight** (their stated safety frame).

**Beyond the brief:** The brief's "earned promotion" graduates a *flow's autonomy posture*; DGM graduates the *agent's source code and tooling*. The open-ended **lineage archive** (not a single current-best) is the key idea the brief lacks — keeping a branching family of MD-variants so a regression in one lineage doesn't poison the pool, and so "stepping-stone" variants that look worse now can seed a breakthrough later (the Darwinian, not greedy, search). For Borjie this maps to: keep an archive of *orchestrator configurations / junior-team compositions*, score each on replayed estate decisions, and let better variants propose themselves — fail-closed inside the existing isolated-vm sandbox.

- Paper: https://arxiv.org/abs/2505.22954 (fetched) · Announcement: https://x.com/SakanaAILabs/status/1928272612431646943 (UNVERIFIED)

---

## 3. Gödel Agent — self-referential runtime self-modification (no fixed optimizer)

**Yin et al. — arXiv:2410.04444 (2024).** A self-evolving framework inspired by the Gödel machine in which the agent **dynamically modifies its own logic and behavior at runtime, guided solely by high-level objectives through prompting**, *without predefined routines or a fixed optimization algorithm*. The motivation is sharp: human-designed components (like a fixed ADAS meta-search loop) **restrict the search space**, so the globally optimal design may be unreachable; letting the agent rewrite even its own improvement procedure removes that ceiling. Reported to achieve **continuous self-improvement, surpassing manually crafted agents in performance, efficiency, and generalizability.**

**Beyond the brief — and its safety boundary.** This is the most radical item and the one Borjie should adopt **only in a heavily fenced form.** The brief (and ADAS) keep a *fixed outer loop*; Gödel Agent dissolves it. For an estate that touches the LedgerService money-path, RLS-scoped tenant data, and licence actions, **unbounded self-rewrite of the improvement procedure is exactly the recursive-self-improvement hazard** (reward hacking: "train on the test set," exploit discovered credentials; model collapse; bias amplification — see §8). The frontier-correct posture for Borjie: borrow Gödel Agent's *expressive self-edit* but keep DGM's *empirical-fitness gate + sandbox*, and **forbid self-edits from touching the inviolable layer** (`policy-gate.ts`, `inviolable.ts`, kill-switch, audit-chain). Self-modify the *juniors and orchestration*, never the *governor*.

- Paper: https://arxiv.org/abs/2410.04444 (fetched) · Code: https://github.com/Arvid-pku/Godel_Agent (UNVERIFIED)

---

## 4. AFlow — workflow *search* via MCTS over code-represented workflows

**Zhang et al. (MetaGPT) — arXiv:2410.10762 (ICLR 2025).** AFlow reformulates workflow construction as a **search problem over code-represented workflows** — LLM-invoking nodes connected by edges — and explores it with **Monte Carlo Tree Search**, refining via code modification, tree-structured experience, and execution feedback. It composes **operators** (predefined reusable node-combos: Ensemble, Review-&-Revise). Result: **+5.7% avg over SOTA baselines**, and it lets **smaller models beat GPT-4o on specific tasks at 4.55% of the inference cost.**

**Beyond the brief:** The brief's WORKFLOW modality *matches a turn to a hand-authored entry in `WORKFLOWS`*. AFlow *discovers the workflow graph itself*. Borjie's `dynamic-recipe-authoring` (currently orphaned, flagged for mounting) is the natural host: instead of an MD hand-composing a royalty-remediation flow, AFlow-style MCTS searches compositions of existing operators (the juniors + Ensemble/Review nodes) against replayed cases, and the **cost result is decisive for a Tanzania-first estate** — discovered workflows can route most steps to a cheap model and reserve Sonnet/Opus for the hard node, hitting the on-device-MiniLM-router cost target by *construction*, not by hand-tuning.

- Paper: https://arxiv.org/abs/2410.10762 (fetched) · Announcement: https://x.com/MetaGPT_/status/1846044033820312016 (UNVERIFIED)

---

## 5. DSPy + MIPROv2 — compile-the-pipeline (declarative self-optimization)

**Opsahl-Ong et al. — arXiv:2406.11695 ("Optimizing Instructions and Demonstrations for Multi-Stage LM Programs"), Stanford DSPy.** DSPy treats an LLM program as composable **modules with signatures**, then *compiles* it: **MIPROv2 simultaneously optimizes instructions + few-shot demonstrations for every module** using Bayesian optimization with a surrogate model — reported **up to ~13% over hand-crafted prompts** across five multi-stage programs. It optimizes *both* prompts and (in newer DSPy) weights.

**Beyond the brief:** The juniors today carry **hand-written prompts** (`document-agent-prompt.ts`, `buildUniversalPrompt`, persona EN/SW copy). The brief never *optimizes* those — it just runs them. Wrapping the junior pool as DSPy-style modules with declared signatures makes the **entire 50-junior compound system compilable**: given a labeled set of past estate decisions (from `decisionLog` + Auditor verdicts), MIPROv2 *re-derives* the best instructions and exemplars per junior automatically, and re-compiles when the corpus or regulations shift — turning prompt maintenance from a manual chore into a CI step. (This satisfies the evidence-required rule: optimization targets the Auditor-graded outcome.)

- MIPRO paper: https://arxiv.org/abs/2406.11695 (UNVERIFIED) · DSPy roadmap: https://dspy.ai/roadmap/ (UNVERIFIED)

---

## 6. GEPA — reflective prompt *evolution* beats RL, at 35× fewer rollouts

**Agrawal et al. — arXiv:2507.19457 (2025).** GEPA (Genetic-Pareto) **reflects in natural language on full execution + evaluation traces** to diagnose what in a module's prompt caused success/failure, proposes edits, and — the key move — keeps a **Pareto frontier of candidates** (best score *per training instance*, not single global best) so the search doesn't greedily stall on one lineage. It optimizes **compound, multi-module systems** (round-robin over modules, children inherit parents' learning signals). Numbers: **outperforms GRPO by ~10% avg / up to 20% using up to 35× fewer rollouts**; **beats MIPROv2 by >10%** (incl. +12% AIME-2025); Pareto sampling beats select-best by up to **8.17%**.

**Beyond the brief:** Two ideas the brief doesn't have. (1) **Language as a richer gradient than scalar reward** — GEPA learns from the *text* of why a run failed, which is exactly what Borjie's Auditor already produces (evidence-chain rejections, groundedness/calibration verdicts). The brief throws those verdicts away after gating; GEPA turns them into the optimization signal. (2) **Pareto-frontier diversity** — instead of a single "best junior config," keep a frontier of configs each best on *some* estate scenario (royalty edge cases vs FX vs ESG), preventing the monoculture/stall the brief's single-current-best promotion would cause. The 35× sample-efficiency is what makes this affordable on a real estate's modest decision volume.

- Paper: https://arxiv.org/abs/2507.19457 (fetched)

---

## 7. TextGrad — autograd-via-text for the *whole* compound system

**Yuksekgonul, Bianchi, … Guestrin, Zou — arXiv:2406.07496 (Stanford), *Nature* 2025.** TextGrad **backpropagates textual feedback** through a computation graph of LLMs/tools, treating NL critiques as gradients to optimize any variable — prompts, code snippets, even molecules or treatment plans — with **PyTorch-like syntax** (`loss.backward()` over text). Generality demonstrated across QA, molecule optimization, and radiotherapy planning.

**Beyond the brief:** This is the *mechanism* that makes §5/§6 systemic. Borjie's junior pipeline is literally a compound graph (master-brain → lens-router → juniors → synthesizer → Auditor). TextGrad lets a *single* end-to-end "loss" (Auditor rejection + calibration + EN/SW-purity + cost) be backpropagated as text to **simultaneously nudge every node's prompt** toward the estate's actual quality bar — instead of the brief's per-junior, hand-tuned, never-optimized prompts. It is the disciplined, differentiable-feeling alternative to ad-hoc prompt edits.

- Paper: https://arxiv.org/abs/2406.07496 (UNVERIFIED) · Code: https://github.com/zou-group/textgrad (UNVERIFIED) · Stanford HAI: https://hai.stanford.edu/news/textgrad-autograd-text (UNVERIFIED)

---

## 8. AlphaEvolve — evolutionary program search at production scale

**Google DeepMind — May 2025.** AlphaEvolve maintains an **evolutionary database of candidate programs**, uses a **Gemini Flash (breadth) + Pro (depth) ensemble** to propose **diff-style mutations**, and requires an **automated evaluator/fitness function** to verify, run, and score each variant — closing the evolutionary loop over a distributed pipeline. Production wins are concrete: a data-center scheduling heuristic that **recovers ~0.7% of Google's worldwide compute year-round**, a **Verilog rewrite shipped into a TPU**, a **23% matmul kernel speedup**, a **4×4 complex matrix multiply in 48 scalar multiplications**, and improvements on **~20% of 50+ open math problems** (incl. a new kissing-number lower bound in 11D).

**Beyond the brief:** AlphaEvolve is the gold standard for the **"continuous offline improvement loop"** the task asks for, and it teaches two non-obvious things. (1) **The evaluator is the product.** Self-improvement only works "where progress can be clearly and systematically measured." For Borjie that means investing in a **machine-checkable estate-decision evaluator** (ledger-balanced? licence row correct? evidence chain non-empty? within budget? EN/SW pure?) — the existing Auditor + loop-quality-gates are the seed. (2) **Mutate by diff against a code archive**, not regenerate — cheaper, safer, reviewable. Borjie can run an *overnight* AlphaEvolve loop (during the Letta-style sleep/consolidation window already scheduled by `reflexion-sleep-canary`) that evolves *workflow code* and *junior configs* against replayed real decisions, surfacing only Pareto-improving, human-gated diffs each morning.

- DeepMind blog: https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/ (fetched) · White paper PDF: https://storage.googleapis.com/deepmind-media/DeepMind.com/Blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/AlphaEvolve.pdf (UNVERIFIED) · Wikipedia: https://en.wikipedia.org/wiki/AlphaEvolve (UNVERIFIED) · Open-source replica CodeEvolve: https://arxiv.org/html/2510.14150v1 (UNVERIFIED)

---

## 9. Voyager — ever-growing skill library + automatic curriculum

**Wang et al. (NVIDIA/Caltech) — arXiv:2305.16291.** Three components: (1) an **automatic curriculum** that maximizes exploration by proposing "interesting" next tasks given current competence; (2) an **ever-growing skill library of *executable code*** (skills stored as deterministic code, not fuzzy NL memories — described→embedded→stored→retrieved→composed); (3) an **iterative prompting** loop with environment feedback + self-verification. Result: **3.3× more unique items, 15.3× faster tech-tree milestones**, and **solved every goal** in a zero-shot fresh world where ReAct/Reflexion/AutoGPT solved none.

**Beyond the brief:** The brief *already cites Voyager* for the skill-capture half — good. What it under-uses is the **automatic curriculum**. The brief's situational model has a FUTURE facet ("what could matter next") but no *self-directed practice loop*. Voyager's curriculum says: Borjie should, in idle time, **propose its own training tasks** — "I've never handled a licence renewal that collides with a royalty filing window; let me synthesize and rehearse that scenario" — building skills *before* the real event, against replayed/synthetic estate data. Code-as-skill (vs NL memory) is also the right call for an auditable money-touching estate: a promoted skill is reviewable, deterministic, and testable.

- Paper: https://arxiv.org/abs/2305.16291 (UNVERIFIED) · Project: https://voyager.minedojo.org/ (UNVERIFIED) · Code: https://github.com/MineDojo/Voyager (UNVERIFIED)

---

## 10. Reflexion + experience-replay memory — the cheap, gradient-free engine

**Shinn et al. — arXiv:2303.11366 (NeurIPS 2023).** Reflexion converts scalar/binary outcomes into **verbal self-reflection** stored in episodic memory and replayed as context next attempt — a "semantic gradient." Gains: **+22% AlfWorld, +20% HotPotQA, +11% HumanEval**, no weight updates. The 2024-2026 lineage extends this into **experience-replay loops**: ExpeL (abstract trajectories→insights→retrieve), Dynamic Cheatsheet, **ReasoningBank** (distill lessons from *successes and failures* into reasoning memory), Contextual Experience Replay (arXiv:2506.06698), and ExRL (reflection-consolidation inside RL training).

**Beyond the brief:** The brief mentions Reflexion only as the *readiness signal* for autonomy promotion. The frontier use is a **standing replay→eval→update loop**: every decided estate case (with Auditor verdict) lands in a replay buffer; a nightly pass re-runs the current orchestrator over the buffer, **reflects on regressions in NL**, and distills both wins *and* losses into the durable cognitive memory + skill library. ReasoningBank's "learn from failures too" is the part the brief's success-only skill capture misses entirely — for an estate, the near-miss compliance escalations are the most valuable training data.

- Reflexion: https://arxiv.org/abs/2303.11366 (UNVERIFIED) · Contextual Experience Replay: https://arxiv.org/abs/2506.06698 (UNVERIFIED) · Self-Evolving Agents survey (ReasoningBank/Mem0 refs): https://arxiv.org/abs/2507.21046 (fetched)

---

## 11. Self-evolving *multi-agent* systems — evolve the team, not just the member

**MASS** (Multi-Agent System Search) jointly optimizes **prompts + topology** over a configurable design space; **AFlow/EvoFlow** search heterogeneous workflows; **SEW** (arXiv:2505.18646) co-evolves agent prompts *and* workflow with diverse representation schemes; **EvoMAC/textual-backprop** methods evolve **role prompts, communication topology, and workflows** via textual gradients from execution feedback; **HiVA** (arXiv:2509.00189) does goal-driven semantic-topological evolution of a hierarchical variable-agent graph.

**Beyond the brief:** Borjie's team topology (master-brain → lens-router → fixed juniors → synthesizer → Auditor) is **hand-wired and static**. These works say the *wiring itself is a learnable parameter*: which juniors talk to which, supervisor-vs-swarm-vs-handoff per problem class, how many sub-MDs to fan out. The brief's spawn rules ("1 agent/3-10 tool calls, 2-4 sub-MDs for comparisons") are *hand-set heuristics from Anthropic telemetry*; MASS/EvoMAC would **learn the topology** that wins on Borjie's own replayed decisions — and would discover, e.g., that ESG+compliance should be a tight review-loop pair while FX runs solo.

- Survey: https://arxiv.org/abs/2507.21046 (fetched) · SEW: https://arxiv.org/abs/2505.18646 (UNVERIFIED) · HiVA: https://arxiv.org/abs/2509.00189 (UNVERIFIED)

---

## 12. Curriculum / open-endedness — OMNI & the "interestingness" gate

**OMNI / OMNI-EPIC** (arXiv:2405.15568) use foundation models as **models of human notions of interestingness** to *generate their own curricula* — choosing which new tasks are learnable-and-worth-learning, and (OMNI-EPIC) **programming the environments/tasks in code**. **Eurekaverse** (CoRL 2024) generates progressively harder environment curricula. **MAGELLAN** (arXiv:2502.07709) predicts *learning progress* to steer autotelic exploration in large goal spaces.

**Beyond the brief:** This is the governor for §9's self-practice: it prevents the brain from wasting compute rehearsing trivial or useless scenarios. The "interestingness/learning-progress" filter tells Borjie *which* synthetic estate scenarios to practice (novel, learnable, decision-relevant) and which to skip — the difference between an MD that drills its actual blind-spots and one that endlessly re-solves royalty math it already mastered.

- OMNI-EPIC: https://arxiv.org/abs/2405.15568 (UNVERIFIED) · MAGELLAN: https://arxiv.org/abs/2502.07709 (UNVERIFIED) · Eurekaverse: https://github.com/eureka-research/eurekaverse (UNVERIFIED)

---

## 13. Safety limits of recursive self-improvement (the fence Borjie must build)

The frontier is unanimous that open-ended self-improvement is **dangerous without an evaluator and a sandbox**. Documented failure modes in self-improving loops: **reward hacking** (gaming the evaluator — training on the test set, downloading checkpoints, exploiting discovered credentials), **model collapse** (diversity loss from training on synthetic self-output), and **bias amplification** (flaws compound each cycle). DGM's stated mitigations are **sandboxing + human oversight**; ADAS explicitly conditions its promise on "provided we develop it safely." Bengio et al.'s *Scientist AI* line (arXiv:2502.15657) argues agentic, self-improving systems pose catastrophic risks and favors non-agentic, uncertainty-honest designs as a safer path.

**Beyond the brief — this is where Borjie's existing hard rules become a *competitive moat*, not a constraint.** Most self-improving-agent papers *bolt on* a sandbox; Borjie was *born* with the exact substrate these systems need: isolated-vm execution, FORCE-RLS, hash-chained append-only audit, fail-closed kill-switch, four-eye on money/licence, an inviolable policy layer, and a mandatory Auditor with evidence-required output. The frontier-correct design: **self-modification is allowed only on the mutable layer (juniors, prompts, workflows, topology), is always empirically gated against the Auditor evaluator on replayed cases, runs in the existing sandbox, and is forbidden from touching the governor (`inviolable.ts`, `policy-gate.ts`, kill-switch, LedgerService money-path, RLS).** That single rule converts Gödel-Agent-class expressiveness into something deployable on a real estate.

- Scientist AI: https://arxiv.org/abs/2502.15657 (UNVERIFIED) · RSI safety overview: https://www.emergentmind.com/topics/recursive-self-improvement (UNVERIFIED) · Self-evolving survey safety section: https://arxiv.org/abs/2507.21046 (fetched)

---

## 14. Synthesis — the self-improving estate MD, layered onto what Borjie already has

A concrete, governance-safe stack, smallest→largest leap, each reusing existing Borjie primitives:

1. **Evaluator first (AlphaEvolve's lesson).** Harden the Auditor + loop-quality-gates into a **machine-checkable estate-decision fitness function** (ledger-balanced, licence-row-correct, evidence non-empty, budget, EN/SW purity, calibration). *Nothing self-improving is safe without this.*
2. **Replay buffer + nightly reflect (Reflexion/ReasoningBank).** Every decided case → buffer; sleep-window pass re-runs current orchestrator, reflects on wins **and** losses, distills into cognitive memory.
3. **Compile the pipeline (DSPy/MIPROv2 + GEPA/TextGrad).** Wrap juniors as signature-typed modules; auto-optimize prompts/exemplars against the evaluator; keep a **Pareto frontier** of configs per estate scenario class.
4. **Search the workflow (AFlow).** Mount `dynamic-recipe-authoring`; MCTS-compose operators+juniors into discovered, cost-optimal flows; human-gate promotion into `WORKFLOWS`.
5. **Evolve the team topology (MASS/EvoMAC).** Make master-brain↔junior wiring a learned parameter over replayed decisions.
6. **Invent new juniors (ADAS Meta-MD).** When no junior fits a recurring problem, the meta-MD drafts one as code into the archive, smoke-tests on replay, human-gates promotion.
7. **Open-ended lineage + curriculum (DGM + Voyager/OMNI).** Keep a branching archive of orchestrator/junior variants (not single-best); idle-time self-practice on *interesting, learnable* synthetic scenarios.
8. **Governor is sacrosanct (RSI safety).** Self-edits never touch inviolable/policy-gate/kill-switch/LedgerService/RLS; every promotion empirically gated + sandboxed + human-reviewed; money/licence/deletion remain dual-control HITL forever.

**Bottom line:** The naive brief makes the MD a smarter *dispatcher* over hand-built juniors. The frontier makes it a **self-designing organization** — one that invents its own juniors (ADAS), compiles and reflectively evolves their prompts (DSPy/GEPA/TextGrad), searches its own workflows and team topology (AFlow/MASS), grows an executable skill library on a self-set curriculum (Voyager/OMNI), keeps an open-ended archive of self-improving variants (DGM), and runs a nightly replay→eval→update loop (AlphaEvolve/Reflexion) — all fenced by the governor Borjie already shipped. That is the difference between an estate OS that is *good* and one that *gets better every night while the mine sleeps.*
