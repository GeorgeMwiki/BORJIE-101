# EXECUTION ORCHESTRATION & DONE-CRITERIA — the SOTA of running the wiring program to provable zero

**Document:** `Docs/research/exec-orchestration-done-criteria.md`
**Date:** 2026-06-09
**Branch:** `integration/parity-final`
**Lane:** execution-orchestration-and-done-criteria
**Status:** research dossier — no code, no commit.
**Mandate:** orchestrate a 43-gap / 10-wave wiring program run by an AI-agent fleet so that (a) dependencies hold, (b) waves stay disjoint, (c) nothing regresses, and (d) we can *machine-prove* we are done. Bar: SOTA, fiduciary-grade, **0 gaps, zero-bug, deployment-ready**.
**Companion:** consumes `MASTER_WIRING_CLOSURE_PLAN.md` (the 10 waves, the 8 blockers, the parallelism map). This dossier is the *program-management & done-proof layer* over that plan — it does not re-derive the gaps; it specifies how to run them to completion without failing.

> **One-sentence thesis.** The wiring program does not "fail" because a fix is wrong — it fails because (1) two agents collide on a file, (2) a fix lands out of dependency order and silently no-ops, (3) a fix regresses a sovereign invariant nobody re-checked, or (4) we *declare* done on vibes when a dark port still exists. Each of those four is preventable by a **machine-checkable control**, not by discipline alone. This dossier specifies the four controls and the single gate that fuses them.

---

## PART 0 — THE FOUR FAILURE MODES, AND THE CONTROL THAT KILLS EACH

| # | Failure mode | Why discipline alone fails | The machine-checkable control |
|---|---|---|---|
| F1 | **Collision** — two fleet agents edit the same file / region | A 10-wave plan is "disjoint by file", but an agent reaching for a shared barrel (`brain-tools/index.ts`, `sovereign.ts`, `index.ts` mount block) breaks disjointness silently | **Worktree isolation + a path-ownership lock map + a stack-aware merge queue** (Part 2) |
| F2 | **Out-of-order land** — a fix merges before its dependency edge | A real fix can land, typecheck green, and *do nothing at runtime* because the port it binds into isn't there yet (the `sovereign.ts:631` / Wave-2-after-Wave-1 edges) | **A topological wave scheduler that gates merge on the dependency DAG** (Part 1) + a per-finding re-verify-against-HEAD (Part 4) |
| F3 | **Silent regression** — a wiring fix flips an invariant | Turning the arbiter ON, the durable runner ON, the body-change rail ON changes the default `/ask` topology — a regression here is a *fiduciary* event (money/licence/deletion), not a test flake | **The invariant gate: every wave re-runs the sovereign-invariant suite + the membrane assertions before merge** (Part 3, Part 5) |
| F4 | **False done** — we say "0 gaps" without proof | "Reachability test passed" is per-wave and human-asserted; the *program* has no single oracle that says zero dark ports remain | **The Wiring Completeness Gate (WCG): one CI job whose pass ⇔ 0 dark ports / 0 unmounted routes / 0 stub-on-live-path** (Part 6 — the centerpiece) |

The rest of the dossier builds each control and then fuses F1–F4 into one merge-blocking gate.

---

## PART 1 — TOPOLOGICALLY-SEQUENCED ROLLOUT (dependencies hold)

### 1.1 The program IS a DAG; model it as data, not prose

The closure plan already states the edges in prose ("Wave 2's dispatcher binding lands after Wave 1 merges"; "Wave 7 after Wave 2"; "Wave 8-paying after Wave 5"; "Wave 10 last"). SOTA practice in 2026 is to make the dependency graph a *first-class artifact the merge system reads*, not a sentence a human remembers. Stack-aware merge queues now execute build targets in **topological order over an explicit acyclic dependency graph**, and the stack itself is "not just a sequence of PRs — it's a dependency graph where each change builds on the previous one" ([Graphite stack-aware merge queue](https://graphite.com/blog/the-first-stack-aware-merge-queue), [Mergify CI orchestration](https://mergify.com/blog/github-merge-queue-was-step-one-real-ci-orchestration-comes-next)).

**Borjie application — `wiring-dag.json` as the single scheduler input.** Encode the plan's edges as data the merge gate enforces:

```
nodes:  W1..W10  (+ blocker sub-nodes OK-1..OK-8, consolidationRunner)
edges:  W1 → {W2.dispatcher, W3.sovereign-port-block, W7, W8.paying, W10}
        W2 → {W7, W10}
        W5(OK-8a) → {W8.paying, W10.live-binding}
        W1,W2,W5 → W10
ranks:  rank0 = W1 (alone, first)
        rank1 = {W2, W3, W4, W5, W6, W8, W9}   # parallel, separate branches
        rank2 = {W7, W10}                       # after their edges clear
```

The scheduler's job is exactly **Kahn topological sort with rank batching**: emit a wave for execution only when all its in-edges are *merged-and-verified* (not merely "branch exists"). This is the antidote to F2.

### 1.2 Blocker-first risk ordering inside the topology

Topology gives a *partial* order; risk gives the *total* order inside each rank. The plan's blocker burn-down is the correct risk spine: `OK-2 → OK-1 → OK-7 → OK-3` (Wave 1), then `OK-6 → OK-5` (Wave 2), then `consolidationRunner` (Wave 6). The money/licence/deletion path carries the most care and goes through the smallest possible blast radius — which is exactly what progressive delivery prescribes: ship the riskiest change to the smallest slice first, learn from real traffic, expand with confidence ([Octopus progressive delivery](https://octopus.com/devops/software-deployments/progressive-delivery/), [Unleash canary vs progressive](https://www.getunleash.io/blog/canary-release-vs-progressive-delivery)).

**Borjie risk-rank rule (total order within a rank):**
1. **Blockers on the money/licence/deletion path** — Wave 1 conductor, Wave 2 durable/saga, Wave 6 consolidationRunner + jurisdiction four-eye. Highest care, canary-gated, four-eye where sovereign.
2. **Dark organs off the default turn but on a mounted path** — Waves 3, 4, 7 (analytics ports, KG temporal, connectors/e-sig).
3. **Membranes** — Wave 5 (egress + out-of-process rail) — high care because they sit *across* the money path, but they *tighten* not loosen, so they can lead the frontend.
4. **Frontend LAST** — Waves 8, 9 (SSE seam, thin pages). Lowest risk, but gated behind Wave 5 (OK-8a) before any *paying* tenant sees an artifact frame, else mechanic fields leak.

> **Why frontend last is non-negotiable here:** the frontend is the only surface a paying user *sees*, so a frontend regression is the most visible and a frontend wired before its egress membrane (Wave 5) is a live IP-leak. Frontend-last is both lowest-risk-to-build and highest-consequence-if-early — the topology and the risk-order agree.

### 1.3 Each wave carries its own canary flag — the flag IS the rollout control

Every blocker wave flips a default (`BORJIE_MODALITY_ARBITER`, `DURABLE_EXEC_ENABLED`, `BORJIE_BODY_CHANGE`). 2026 progressive-delivery practice: the feature flag *is* the unit of rollout, decoupled from deploy, with a kill path ([LaunchDarkly progressive delivery](https://launchdarkly.com/guides/progressive-delivery/how-feature-management-enables-progressive-delivery/), [Datadog feature flags](https://www.datadoghq.com/knowledge-center/feature-flags/)).

**Borjie application:** a wave merges *code* with the flag default-OFF, then the flag flips per-tenant via canary (internal tenant → 1 design-partner → cohort → all). The merge gate (Part 6) checks the *code is reachable when the flag is ON*; the canary controller checks the *runtime is healthy as the flag ramps*. Two distinct gates, two distinct questions — never conflate "wired" with "rolled out".

---

## PART 2 — MERGE-TRAIN / CHANGE-SET ISOLATION (waves stay disjoint, fleet never collides)

### 2.1 Worktree-per-agent is the substrate; it is necessary but NOT sufficient

The fleet practice we already follow (verified-then-commit, clean-tree, explicit-path commits) is exactly 2026 SOTA: "isolate each agent in a separate git worktree … same repository, different working directories … parallel sessions never step on each other's changes" ([MindStudio worktrees](https://www.mindstudio.ai/blog/git-worktrees-parallel-ai-coding-agents), [Augment multi-agent workspace](https://www.augmentcode.com/guides/how-to-run-a-multi-agent-coding-workspace)). Claude Code added native `--worktree` in Feb 2026 ([MindStudio parallel agents](https://www.mindstudio.ai/blog/parallel-ai-coding-agents-git-worktrees)).

But the field has a sharp warning that maps *exactly* to our risk: **worktree isolation prevents file-level collisions, but if two agents are tasked with the same high-level goal they still conflict, because the task wasn't scoped to be independent. Spec-driven decomposition is the prerequisite that determines whether parallel agents work in parallel or create future merge problems** ([appxlab worktrees](https://blog.appxlab.io/2026/03/31/multi-agent-ai-coding-workflow-git-worktrees/)).

**Borjie reading:** the closure plan's "disjoint by file" claim is the spec-decomposition. It is *mostly* right but has three known shared-file hotspots the plan itself flags: `brain-tools/index.ts` and `sovereign.ts:631` (Wave 1 ↔ Wave 3), and `services/api-gateway/src/index.ts` mount block (Wave 6, coordinate-only-if Wave 1 touches imports). These are the collision risks. They need an explicit lock, not a hope.

### 2.2 The path-ownership lock map — disjointness enforced, not assumed

Define a machine-readable `wave-ownership.json` mapping each wave to the glob set it MAY write, with the three hotspots marked as **serialized-shared** (exactly one wave holds the write-lease at a time, others rebase after):

```
W1: [composition/brain-kernel-wiring.ts, composition/orchestrator-bindings.ts,
     composition/sovereign.ts, kernel/orchestrator/main-loop.ts,
     composition/control-shell-wiring.ts(new)]   # also lease-holder for sovereign.ts:631 first
W3: [kernel/**(new ports), market-intelligence/src/**]
     + SHARED-LEASE: brain-tools/index.ts, sovereign.ts (after W1 releases)
W6: SHARED-LEASE: services/api-gateway/src/index.ts (mount block)
...
```

A pre-commit / pre-merge check asserts a branch's diff touches **only** files in its wave's owned set ∪ currently-held shared leases. A write to an unowned path = hard reject. This converts F1 from "discipline" to "CI". It is the local analogue of architecture fitness functions — automated tests that verify structural rules, "the only reliable way to automatically enforce architecture rules at the speed AI generates code" ([aipatternbook fitness functions](https://aipatternbook.com/architecture-fitness-function), [DEV operationalizing ADRs](https://dev.to/alexandreamadocastro/stop-architecture-drift-operationalizing-adrs-with-automated-fitness-functions-22oi)).

### 2.3 Stacked PRs + a stack-aware merge queue for the dependency edges

Where a true dependency edge exists (Wave 2's dispatcher binding *stacks on* Wave 1; Wave 7 *stacks on* Wave 2's actuator port), model it as a **PR stack**, not two independent PRs. Stack-aware queues validate the whole stack as a unit, run CI on the top-most PR, merge atomically if it passes, and use **topology-aware bisection** to isolate a failing PR (5 CI runs to find the culprit in a 32-PR batch instead of 32) ([Graphite stack-aware queue](https://graphite.com/blog/the-first-stack-aware-merge-queue)). GitHub shipped native stacked PRs (`gh-stack`) in 2026; Shopify reported 33% more PRs merged per dev, Asana cut median PR size 11% and saved 7 hrs/week ([InfoQ GitHub stacked PRs](https://www.infoq.com/news/2026/04/github-stacked-prs/)).

**Borjie application — the merge train:**
- **Rank 0:** Wave 1 merges ALONE through the queue (the most-coupled region; the plan mandates "first and alone"). No other branch in the train until it lands.
- **Rank 1:** Waves 2,3,4,5,6,8,9 enter the queue as **independent** entries (disjoint file sets → the queue can interleave them freely; monorepo-scoped queues understand this, standard queues do not, which is why a *scope-aware* queue matters ([Mergify](https://mergify.com/blog/github-merge-queue-was-step-one-real-ci-orchestration-comes-next))).
- **Dependency edges:** Wave 2.dispatcher, Wave 3.sovereign-port-block, Wave 7, Wave 8.paying, Wave 10 enter as **stacks** on their predecessor — the queue refuses to merge the child until the parent is green-in-trunk.
- **Bisection on red:** if the rank-1 batch fails CI, topology-aware bisection isolates the offending wave without unwinding the innocent ones.

### 2.4 Per-finding, against-HEAD re-verification (the clean-tree discipline, formalized)

Our "verified-then-commit, per-finding re-verify against HEAD" practice is the correct answer to a real 2026 failure mode: **the world moves under the agent.** A finding verified against an old HEAD may be stale by merge time. The rule:

> Before an agent commits a fix, it re-derives the *evidence of the gap* against current `HEAD` (re-greps the dark marker, re-confirms the port is unbound, re-confirms the route is unmounted). If the evidence is gone, the finding is already closed by a sibling wave — **dismiss, do not "fix" a non-gap** (which would be a spurious diff and a collision risk).

This is the merge-train analogue of generation-verification loops where the verifier runs against fresh state, not the snapshot the generator saw ([ReVeal self-verification](https://arxiv.org/html/2506.11442v1)).

---

## PART 3 — NOTHING REGRESSES (the invariant gate)

### 3.1 The non-negotiable invariants are the regression oracle

Borjie has a *closed, enumerable* set of sovereign invariants (CLAUDE.md hard rules): money only through `LedgerService.post()`; RLS FORCE + canonical GUC; Supabase-JWT canonical; kill-switch fail-closed; webhooks at-least-once + idempotent; AI audit chain hash-chained append-only; predictions APPEND never replace; migrations immutable; sovereign paths HITL; no IP leak to client; multi-tenant isolation. Because the set is finite and each is testable, the regression oracle is *exactly* this suite — not "all tests", which is too slow to run per-wave and too noisy to block on.

**Borjie application — the Invariant Suite (`pnpm test:invariants`)** is a curated, fast, deterministic subset that every wave branch MUST pass before entering the merge queue. It is the DoD "technical/quality standard", which DoD theory says should be quality gates, not functional specs ([minware DoD](https://www.minware.com/guide/best-practices/definition-of-done), [ProductPlan DoD](https://www.productplan.com/learn/agile-definition-of-done)). Each invariant maps to ≥1 assertion:

| Invariant | Machine assertion in the suite |
|---|---|
| Money path | static: no ledger write outside `LedgerService.post`; runtime: a posted effect produces a balanced double-entry row |
| RLS FORCE | a cross-tenant read returns 0 rows with the GUC bound; `FORCE ROW LEVEL SECURITY` present on every tenant table (the migration-safety check already exists) |
| Audit chain | append-only: a mutation attempt on a prior hash-chain row fails; chain re-hash verifies |
| Predictions APPEND | a prediction never overwrites a rule-based decision row (insert-only assertion) |
| Sovereign HITL | the four-eye PROPOSE→APPROVE path is required for money/licence/deletion/jurisdiction (the Wave-6 jurisdiction integration test is the canonical example) |
| No IP leak | the egress projection allow-list rejects agent/tool names, arbiter rationale, CoT — asserted on EVERY client emission point (Part 5) |

### 3.2 The wiring-specific regression: a flipped flag must not loosen a rail

The blocker waves flip defaults. The regression risk is *not* a crash — it is a **quiet loosening**: the durable runner turning on but the four-eye queue not being made durable; the body-change rail turning on but bypassing `authorizeBodyChange`; the arbiter routing ACTUATE without the out-of-process controller. The Invariant Suite must therefore include a **"flag-ON adversarial" assertion per blocker**: with the flag ON, attempt the prohibited action and assert it is still denied/HITL'd. This is the adversarial-review discipline applied to invariants — independent evaluation looking specifically for the *flaw the change could introduce* ([adversarial review of agent outputs](https://dev.to/rih0z/why-ai-agent-outputs-need-adversarial-review-and-how-to-add-it-in-one-api-call-1l92)).

---

## PART 4 — THE AI-AGENT FLEET RUNS THIS WITHOUT COLLISION (verified-then-commit, adversarial-verify)

### 4.1 Roles, not just workers — generator / verifier / adversary

2026 multi-agent SOTA splits the fleet into **coordinator / specialist / verifier** roles and routes per-task models ([Augment workspace guide](https://www.augmentcode.com/guides/how-to-run-a-multi-agent-coding-workspace)). The critical, well-documented hazard: **LLM self-review has systematic leniency bias — the reviewer and generator share blind spots and fail in correlated ways** ([LLM code reviewers adversarial study](https://arxiv.org/html/2602.16741v1), [ReVeal](https://arxiv.org/pdf/2506.11442)). So the verifier MUST be *independent of* the generator (different prompt, ideally different model), and it MUST be **adversarial**: its job is to *find the gap still open*, not to confirm the fix looks good.

**Borjie fleet protocol per finding:**
1. **Generator agent** (in its worktree) implements the fix, runs the touched-package typecheck + tests, commits with an explicit-path diff.
2. **Verifier agent** (independent) does NOT read the generator's reasoning. It runs the **reachability proof** for that gap against the branch: a request actually hits the brain tool / the route returns a non-stub body / the SSE event renders. If it can't *reach* the organ, the fix is not done — regardless of green typecheck.
3. **Adversary agent** runs the **flag-ON adversarial assertion** (Part 3.2) and the **path-ownership check** (Part 2.2): did this diff touch an unowned file? does the flipped flag still deny the prohibited action?
4. Only a fix that survives all three enters the merge queue. This is the generation-verification loop with an anti-reward-gaming check, the exact mechanism ReVeal uses to stop "trivial code that hacks the verifier" ([ReVeal](https://arxiv.org/html/2506.11442v1)).

### 4.2 Anti-collision at the fleet level

- **One wave = one branch = one worktree.** No two agents in the same wave's branch concurrently (the plan's waves are the unit of parallelism, not individual gaps within a wave that share files).
- **Shared-lease serialization** (Part 2.2) for the three hotspot files — the lease is a row the fleet coordinator hands out; an agent without the lease for a shared file is blocked from committing to it.
- **Commit granularity = one verified finding.** Incremental commits give the audit trail and make bisection cheap — exactly the 2026 recommendation ([appxlab](https://blog.appxlab.io/2026/03/31/multi-agent-ai-coding-workflow-git-worktrees/)).
- **FIFO merge queue with conflict tiers** for fleet-scale merges (the Overstory pattern: FIFO queue + four-tier conflict resolution + watchdog health monitoring, cited as the larger-scale answer beyond `--worktree` ([MindStudio parallel agents](https://www.mindstudio.ai/blog/parallel-ai-coding-agents-git-worktrees))).

---

## PART 5 — OBSERVABILITY OF THE WIRING *PROGRAM* (a live gap-burndown, every port green)

### 5.1 Burndown is necessary but shallow; pair it with a coverage dashboard

DORA-era practice has moved past raw burndown charts toward dashboards that show *delivery health*, not just remaining count ([Waydev DORA](https://waydev.co/features/dora-metrics-dashboard/), [getdx DORA tools 2026](https://getdx.com/blog/dora-metrics-tools/)). For a wiring program, "remaining gaps" is the burndown; "every port green" is the coverage. Both must be live and both must be derived from the *machine oracle* (Part 6), never hand-maintained — a hand-maintained gap count is itself a place "done" can be faked.

**Borjie application — `wiring-coverage` dashboard (Grafana over a Prometheus recording rule, the cheap ArgoCD-native pattern ([oneuptime ArgoCD DORA](https://oneuptime.com/blog/post/2026-02-26-argocd-dora-metrics-dashboard/view))):**
- **Gap burndown:** `gaps_open` (out of 43) over time, sourced from the WCG oracle output, sliced by wave and by severity (BLOCKER first).
- **Port-green matrix:** one cell per kernel port / brain tool / mounted route / SSE event — green = reachability-proven, red = dark. This is the *coverage* view; "every cell green" is the visual definition of done.
- **Marker trend:** `NOT_YET_WIRED` count (already audited to 0 by `scripts/audit-not-yet-wired.mjs`) and `NotYetWiredError`/`LATER(wire)` count (currently **18** live in `packages/`+`services/` — a concrete burndown target).
- **Orphan trend:** dependency-cruiser `no-orphans` count vs the committed baseline (the plan's "≤16" gate).
- **Regression sentinel:** Invariant-Suite pass-rate per wave merge — any dip is a regression alarm, the DORA "change-failure-rate" analogue.

### 5.2 The composition root IS the wiring source of truth — instrument it

The composition root is, by definition, "the sole location where the entire object graph is instantiated … all dependency configuration in one place" ([Manning composition root](https://freecontent.manning.com/dependency-injection-in-net-2nd-edition-understanding-the-composition-root/), [Fowler dependency composition](https://martinfowler.com/articles/dependency-composition.html)). For Borjie the closure plan already names it: `services/api-gateway/src/composition/`. Therefore the authoritative answer to "what is wired?" is *derivable from the composition root*, not from a spreadsheet.

**Borjie application — a startup self-check (the `assertFullyWired()` boot guard).** At gateway boot, after the composition root builds the graph, assert that **every declared port has a non-stub binding and every declared route is mounted** — and *fail closed* (refuse to boot) if any port resolves to a `NotYetWired`/deny-stub or any expected mount is absent. This is the DI "verify all bindings at startup" pattern ([composition root verification](https://antoinegriffard.com/posts/dependency-injection/)), turned into a deployment gate. It makes the composition root not just the place wiring *happens* but the place wiring is *proven* — a dark port literally cannot ship because the process won't start. This is the strongest single control in the whole program: **F4 (false done) is impossible if the binary refuses to boot with a dark port.**

---

## PART 6 — THE MACHINE-CHECKABLE "WIRING IS COMPLETE + CORRECT" GATE (the centerpiece)

This is the deliverable the mandate asks for: the exact gate whose green ⇔ *zero dark ports / zero unmounted routes / zero stub-on-live-path*, so "0 gaps" is a CI fact, not a claim. It is the fusion of all four controls.

### 6.1 The Wiring Completeness Gate (WCG) — one CI job, six assertions, all must pass

```
WCG (blocking, on PR-to-main + nightly):

A. NO-STUB-ON-LIVE-PATH
   - scripts/audit-not-yet-wired.mjs  → NOT_YET_WIRED literal count == 0   (already at 0)
   - extend to NotYetWiredError / LATER(wire) call-sites reachable from a route/brain-tool/cron
     entry → count == 0   (today: 18 markers → burn to 0)
   - a deny-stub bound where a real port is expected (body-change rail, gepg, e-sig) → FAIL

B. NO-DARK-PORT  (composition-root reachability)
   - boot the gateway in a test harness with ALL wiring flags ON
   - run assertFullyWired(): every declared kernel port has a non-stub binding;
     every brain tool in brain-tools/index.ts resolves; every EstateMind/control-shell
     organ has a runtime caller → any unbound/stub == FAIL
   - this is the F4-killer: the binary won't boot dark

C. NO-UNMOUNTED-ROUTE  (route ⇄ manifest parity)
   - enumerate every *.hono.ts router factory under services/api-gateway/src/routes/**
   - assert each is api.route(...)-mounted in index.ts AND present in src/openapi/manifests.ts
   - delta(declared, mounted) == ∅   (catches /modules, /admin/tenants/:id/jurisdiction)
   - exception list = explicitly-product-deferred routes, each with an owner sign-off row

D. NO-ORPHAN-REGRESSION  (dependency-cruiser fitness function)
   - npx depcruise: no-orphans count <= committed baseline (16); no NEW layer/cycle violation
   - knip: no new unused-files / unlisted-deps   (knip --reporter github-actions inline)
   - ([knip 2026 standard](https://www.pkgpulse.com/guides/knip-vs-depcheck-2026),
      [dependency-cruiser orphans](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/))

E. REACHABILITY-PROOF  (every closed gap has a live-path test)
   - each of the 43 gaps maps to a tagged test (@wiring:OK-1 … @wiring:W9-persona-registry)
   - the test makes a REAL request that exercises the organ on a live path and asserts
     a non-stub effect (tool runs / route returns real body / SSE event renders)
   - coverage(gaps_with_passing_reachability_test) == 43/43

F. INVARIANT-INTACT  (no sovereign regression)
   - pnpm test:invariants green (money/RLS/audit-chain/append/HITL/no-IP-leak)
   - flag-ON adversarial assertions green (prohibited action still denied with each blocker flag ON)
   - the four CI brain evals green: kernel-eval, eval-orchestrator-scenarios,
     lats-search-eval, trajectory-eval (the plan's Part V evals)

WCG PASSES  ⇔  A ∧ B ∧ C ∧ D ∧ E ∧ F
DONE        ⇔  WCG green on main AND gaps_open == 0 on the burndown
```

### 6.2 Why each assertion is necessary (none is redundant)

- **A** alone catches *textual* stubs but not a port that's silently unbound (no marker).
- **B** catches the unbound/dark port that A misses — and does it the strongest way (won't boot). This is the synthetic/smoke-test-at-startup idea: confirm the service is reachable and core paths work right after deploy ([New Relic smoke testing with synthetics](https://newrelic.com/blog/how-to-relic/smoke-testing-with-synthetic-monitors)).
- **C** catches the *route* that exists but is never mounted — invisible to A and B (the router compiles fine; it's just not in the tree). Route⇄manifest parity is a contract test ([Pact + OTel contract testing 2026](https://devops.com/observability-driven-continuous-testing-in-cloud-native-devops/)).
- **D** catches *new* dead code introduced by the wiring itself and any architecture-boundary violation an agent slips in — the fitness-function backstop ([techdebt.fast AI architecture drift](https://techdebt.fast/ai-architecture-drift/)).
- **E** is the positive proof: not "no stubs" but "the thing actually runs on a path a user hits". This is the reachability test the plan's Part V already mandates per-wave — the WCG just *aggregates and counts* it to 43/43.
- **F** ensures the wiring didn't *loosen a rail* while turning lights on — the fiduciary backstop.

### 6.3 The done declaration is itself machine-emitted

When WCG is green AND `gaps_open == 0`, a CI step emits a signed `WIRING_COMPLETE` attestation (commit SHA, the 43 gap-IDs each with their passing reachability-test name, the orphan/marker/invariant counts) into the audit chain. **"Done" is a hash-chained artifact, not a Slack message.** This mirrors the program's own audit-chain invariant and makes the completion claim itself tamper-evident and append-only — the same standard the product holds its money path to.

---

## PART 7 — THE RUN-BOOK (how the program actually executes, end to end)

1. **Freeze the DAG.** Commit `wiring-dag.json`, `wave-ownership.json`, and the 43→test-tag map. These three files are the program's source of truth; they change only by PR.
2. **Stand up the WCG** (Part 6) as a *blocking* check on `integration/parity-final` BEFORE any wave runs — initially it is RED (43 gaps open). The whole program is "drive WCG to green." Burndown is literally the WCG counter falling.
3. **Rank 0 — Wave 1 alone.** Fleet runs the conductor wave in one branch/worktree; generator→verifier→adversary per finding; flags merged default-OFF; canary the arbiter/body-change flips on the internal tenant; WCG sub-assertions B/E/F for OK-1/2/3/7 + OK-4 go green; merge through the queue alone.
4. **Rank 1 — parallel waves.** Waves 2,3,4,5,6,8,9 launch as independent worktrees; path-ownership lock enforced; shared-lease serialization on the three hotspot files; each wave's branch must pass `test:invariants` + its reachability tests before entering the queue; the stack-aware queue interleaves the disjoint ones and stacks the edge-dependent ones.
5. **Rank 2 — stacked waves.** Wave 7 stacks on Wave 2; Wave 10 stacks on {1,2,5}; Wave 8-paying enabled only after Wave 5 (OK-8a) green.
6. **Continuous regression watch.** The `wiring-coverage` dashboard shows burndown + port-green matrix + invariant pass-rate live; any invariant dip halts the train (DORA change-failure-rate gate).
7. **Done.** WCG green on main, `gaps_open == 0`, `assertFullyWired()` passes at boot, the `WIRING_COMPLETE` attestation lands in the audit chain. The "we have the organs, we lack the joints" finding is retired — *provably*, not by vibes.

---

## PART 8 — THE FIVE THINGS THAT WOULD MAKE US FAIL, AND THE RAIL THAT PREVENTS EACH

| If we fail, it will be because… | The rail that makes it impossible |
|---|---|
| Two agents quietly edit `sovereign.ts` / `brain-tools/index.ts` / `index.ts` and one clobbers the other | **Path-ownership lock + shared-lease serialization** (Part 2.2) — a write to an unowned/un-leased file is a hard CI reject |
| A fix lands before its dependency and silently no-ops (green typecheck, dead runtime) | **Topological merge gate + stack-aware queue** (Parts 1, 2.3) refuse the child until the parent is green-in-trunk; **reachability proof E** fails a no-op fix |
| Turning a blocker flag ON quietly loosens a sovereign rail | **Invariant Suite F + flag-ON adversarial assertions** (Part 3) — prohibited action must still be denied with the flag ON |
| The fleet's own verifier rubber-stamps a fix (leniency bias) | **Independent adversarial verifier** (Part 4.1) — different agent/model, job is to find the gap still open, anti-reward-gaming reachability check |
| We declare "0 gaps" while a dark port remains | **WCG + `assertFullyWired()` boot guard** (Parts 5.2, 6) — the binary won't boot dark, and DONE is a hash-chained attestation, not a claim |

---

## APPENDIX — concrete Borjie artifacts this dossier asks the program to create (no code here; these are the named deliverables)

- `wiring-dag.json` — the 10-wave dependency DAG (Kahn-sorted, rank-batched) the merge gate reads.
- `wave-ownership.json` — path-ownership glob map + the 3 shared-lease hotspots.
- `.github/workflows/wiring-completeness-gate.yml` — the WCG (A–F), blocking on PR-to-main + nightly.
- `scripts/assert-fully-wired.mjs` + an `assertFullyWired()` boot guard in the api-gateway composition root — fail-closed on any dark port/unmounted route.
- `scripts/route-manifest-parity.mjs` — assertion C (every `*.hono.ts` router mounted + in `manifests.ts`).
- extend `scripts/audit-not-yet-wired.mjs` — add `NotYetWiredError`/`LATER(wire)` reachable-call-site detection (today 18 live markers → target 0).
- `pnpm test:invariants` — the curated sovereign-invariant + flag-ON-adversarial suite.
- the `wiring-coverage` Grafana dashboard — burndown + port-green matrix + marker/orphan/invariant trends, all sourced from the WCG oracle.
- the 43→`@wiring:<gap-id>` reachability-test tag map — the positive proof that drives assertion E to 43/43.

**Done, machine-defined:** `WCG(main) == green ∧ gaps_open == 0 ∧ assertFullyWired() == pass ∧ WIRING_COMPLETE attestation present in audit chain`.

---

### Sources

- [Graphite — the first stack-aware merge queue](https://graphite.com/blog/the-first-stack-aware-merge-queue)
- [Mergify — GitHub merge queue was step one; real CI orchestration comes next](https://mergify.com/blog/github-merge-queue-was-step-one-real-ci-orchestration-comes-next)
- [InfoQ — GitHub targets the large-merge problem with stacked PRs (2026)](https://www.infoq.com/news/2026/04/github-stacked-prs/)
- [arXiv — Improving merge pipeline throughput via PR prioritization](https://arxiv.org/html/2508.08342v1)
- [MindStudio — Git worktrees for parallel AI coding agents](https://www.mindstudio.ai/blog/git-worktrees-parallel-ai-coding-agents)
- [MindStudio — Run parallel AI coding agents with git worktrees](https://www.mindstudio.ai/blog/parallel-ai-coding-agents-git-worktrees)
- [Augment Code — How to run a multi-agent coding workspace (2026)](https://www.augmentcode.com/guides/how-to-run-a-multi-agent-coding-workspace)
- [appxlab — Multi-agent AI coding workflow: git worktrees that scale](https://blog.appxlab.io/2026/03/31/multi-agent-ai-coding-workflow-git-worktrees/)
- [aipatternbook — Architecture fitness function](https://aipatternbook.com/architecture-fitness-function)
- [DEV — Operationalizing ADRs with automated fitness functions](https://dev.to/alexandreamadocastro/stop-architecture-drift-operationalizing-adrs-with-automated-fitness-functions-22oi)
- [techdebt.fast — AI architecture drift: detection & fix](https://techdebt.fast/ai-architecture-drift/)
- [PkgPulse — Knip vs depcheck (2026)](https://www.pkgpulse.com/guides/knip-vs-depcheck-2026)
- [Xebia — Taking frontend architecture serious with dependency-cruiser](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/)
- [minware — Definition of Done best practices](https://www.minware.com/guide/best-practices/definition-of-done)
- [ProductPlan — The Definition of Done](https://www.productplan.com/learn/agile-definition-of-agile-definition-of-done)
- [Manning — Understanding the composition root](https://freecontent.manning.com/dependency-injection-in-net-2nd-edition-understanding-the-composition-root/)
- [Martin Fowler — Dependency composition](https://martinfowler.com/articles/dependency-composition.html)
- [Antoine Griffard — DI lifetimes, composition root, anti-patterns](https://antoinegriffard.com/posts/dependency-injection/)
- [Octopus Deploy — Progressive delivery: challenges & best practices](https://octopus.com/devops/software-deployments/progressive-delivery/)
- [Unleash — Canary release vs progressive delivery](https://www.getunleash.io/blog/canary-release-vs-progressive-delivery)
- [LaunchDarkly — How feature management enables progressive delivery](https://launchdarkly.com/guides/progressive-delivery/how-feature-management-enables-progressive-delivery/)
- [Datadog — What are feature flags](https://www.datadoghq.com/knowledge-center/feature-flags/)
- [DEV — Why AI agent outputs need adversarial review](https://dev.to/rih0z/why-ai-agent-outputs-need-adversarial-review-and-how-to-add-it-in-one-api-call-1l92)
- [arXiv — ReVeal: self-evolving code agents via iterative generation-verification](https://arxiv.org/html/2506.11442v1)
- [arXiv — LLM code reviewers are harder to fool (adversarial comments study)](https://arxiv.org/html/2602.16741v1)
- [New Relic — Smoke testing in production with synthetic monitors](https://newrelic.com/blog/how-to-relic/smoke-testing-with-synthetic-monitors)
- [Datadog — UX smoke tests with synthetic monitoring](https://www.datadoghq.com/blog/smoke-testing-synthetic-monitoring/)
- [DevOps.com — Observability-driven continuous testing in cloud-native DevOps](https://devops.com/observability-driven-continuous-testing-in-cloud-native-devops/)
- [Waydev — DORA metrics dashboard](https://waydev.co/features/dora-metrics-dashboard/)
- [getdx — DORA metrics tools in 2026](https://getdx.com/blog/dora-metrics-tools/)
- [oneuptime — DORA metrics dashboard with ArgoCD](https://oneuptime.com/blog/post/2026-02-26-argocd-dora-metrics-dashboard/view)
