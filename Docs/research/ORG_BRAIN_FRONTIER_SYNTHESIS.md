# ORG-BRAIN FRONTIER SYNTHESIS — the master plan to make the estate ALIVE

**Document:** `ORG_BRAIN_FRONTIER_SYNTHESIS.md`
**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Author:** consolidation pass folding the four frontier dossiers (`frontier-unified-surfaces.md`, `frontier-admin-data-boundary.md`, `frontier-tool-synthesis.md`, `frontier-unknown-unknowns.md`) into the existing org-brain corpus (`MASTER_GAP_REGISTER.md` · `ORG_BRAIN_GAP_REGISTER_AND_ROADMAP.md` · `SELF_ORGANIZING_ORG_BRAIN_VISION.md` · `OPERATIONAL_CLOSED_LOOP_FABRIC.md` + `fabric-sota.md`/`fabric-code-audit.md` + the eight `vision-*.md`).
**Status:** master synthesis — no code, no commit. Every claim resolves to a buildable lane already carried in the registers; this document is the *single coherent whole* those lanes compose into, plus the three frontier dossiers folded in as first-class pillars and the unknown-unknowns folded in as a deduped, severity-ranked register.
**Bar:** SOTA, best-in-the-world, PhD/MIT-level. The estate must become a living, self-constructing organism — not a chatbot with tools.

> **Sibling invariant (load-bearing, stated once).** Borjie (mining-estate OS) and BossNyumba / "BN" (real-estate OS) are the **same brain, same capability layer, same wiring, same intelligence** — the only difference is the **domain layer** (a swappable ontology pack: entity/edge classes + SHACL shapes + deterministic domain engines). Every organ below is built **once**, domain-agnostic, in Borjie, and inherited by BN by pointing it at the other ontology pack. The ironic parity dividend: Borjie's *current* built-ins, org-graph projector, and KG ontology are still real-estate — wrong for Borjie, but **exactly the seed pack BN needs**.

---

## 0. The one-sentence thesis

> The estate's data-model, surfaces, org-graph, routing, capability set, and its own *shape* are **generated and continuously reconciled by the brain** — reasoned-need-only, proposal-gated, chat-refinable, reversible, rail-protected — and **every generated organ enters the world through the same conformance gate and the same body-change chokepoint that govern hand-built artifacts**, so the offense (self-construction) is safe *only because* of the defense, and they are **one system, never separable**.

The four frontier dossiers are not four topics. They are the **four faces of one organism**:

1. **Unified surfaces** = the organism's *skin and senses* — every screen is a living semantic LENS over the org-graph (INV-B).
2. **Admin/owner data-boundary** = the organism's *immune system* — a cryptographic, attested firewall so the operator *cannot* (not merely *must not*) read tenant business data (INV-A).
3. **Self-extending nervous system** = the organism's *growth* — missing tool → CREATE-or-COMPOSE, proven-safe-before-use, persisted forever (INV-C).
4. **Unknown-unknowns** = the organism's *homeostasis* — the seam between the construction engine and the defense moat, sealed so generated organs are coherent, fair, legible, recoverable, and uncompromised.

All four ride **one keystone** (the body-change meta-rail) and obey **one invariant** (the offense moat is safe only because of the defense moat).

---

## 1. THE ONE COHERENT ARCHITECTURE — the lens engine, the data-firewall, and the self-extending nervous system as one organism

The `SELF_ORGANIZING_ORG_BRAIN_VISION.md` ring (5 capability pillars + 1 meta-rail) is the skeleton. The four frontier dossiers fold onto it without contradiction — each supplies the *frontier mechanism* for a pillar the register already named, and adds the *conformance seam* the register left open.

```
              ┌──────────────────────────────────────────────────────────────────┐
              │  (6) BODY-CHANGE META-RAIL — the ONE chokepoint (Pillar 6 / K-3)   │
              │  every construction below is a PROPOSAL through this rail:          │
              │  reasoned-need · approval-gated · chat-refinable · reversible ·     │
              │  hash-chain audited · STACKED with the CONFORMANCE GATE (UU-15)     │
              │  and (for tools) the PROVE-SAFE correctness gate (INV-C §2)         │
              └───▲────────────▲────────────▲────────────▲────────────▲────────────┘
                  │ proposes    │ proposes    │ proposes    │ proposes    │ proposes
  reality /       │             │             │             │             │
  evidence  ┌─────┴──────┐ ┌────┴───────┐ ┌───┴────────┐ ┌──┴─────────┐ ┌─┴──────────┐
  (corpus,  │(1) SCHEMA  │ │(2) SURFACE │ │(3) ORG KG +│ │(4) SKILL/  │ │(5) PROACTIVE│
  uploads,  │ SYNTHESIS  │►│ LENS ENGINE│►│ DIGITAL    │►│ CAPACITY + │►│ ORG-DESIGN  │
  chat,     │ induce     │ │ semantic   │ │ TWIN       │ │ TOOL-SYNTH │ │ LOOP +      │
  event-    │ types/     │ │ LENSES     │ │ (the model │ │ NERVOUS    │ │ CLOSED-LOOP │
  outbox,   │ fields/    │ │ over the   │ │ the brain  │ │ SYSTEM     │ │ FABRIC      │
  ledger,   │ edges as   │ │ org-graph  │ │ reasons    │ │ CREATE-or- │ │ (org        │
  telemetry)│ DATA       │ │ (INV-B)    │ │ over)      │ │ COMPOSE    │ │ redesigns   │
      │     └─────┬──────┘ └────┬───────┘ └───┬────────┘ │ (INV-C)    │ │ itself)     │
      │           │             │             │          └──┬─────────┘ └─┬──────────┘
      ▼           │   the schema, surfaces,   │             │ reads graph  │ DETECT→SCHEDULE
  ┌──────────────┐│   people, assets, flows,  │ reads graph │ skill/owner  │ →LADDER→ROUTE
  │ INV-A DATA-  ││   ownership, skill = NODES;│ ◄───────────┘ /capacity    │ →ACT→ESCALATE
  │ FIREWALL     ││   data-flow/skill/owner/  │ edges                       │ →CLOSE→AUDIT
  │ (immune sys) ││   mirrors = EDGES;        │                             │ →LEARN
  │ control vs   ││   bi-temporal + PROV-O    │   every loop above is        ▼
  │ data plane;  │└───────────────────────────┘   a LENS the arbiter   ┌─────────────┐
  │ break-glass; │                                 can land on, a node  │ MODALITY    │
  │ BYOK/CMK;    │     ┌───────────────────────────►an organ can grow,  │ ARBITER     │
  │ attested     │     │   CONFORMANCE GATE (UU-15) every artifact a    │ (COG-07 /   │
  │ enclave      │◄────┘   carried onto generated organs:               │ AUT-14) —   │
  └──────────────┘         EN/SW purity · a11y · PII/permission · evidence-TRUST · │ the head    │
                           coherence/lens-binding · concurrency · reversal · routing-integrity └─ everything
                                                                                       lands on
```

### 1.1 — The five pillars, re-stated with the frontier mechanism folded in

| Pillar | What it is | Frontier mechanism folded in (from the 4 dossiers) | Register anchor |
|---|---|---|---|
| **1 · Schema synthesis** | the data-model the org *induces* (EDC: Extract→Define→Canonicalize) | UU-5/UU-10: induced fields are born **classified** (PII/residency/ACL) and pass an **induction-TRUST gate** (consistency + provenance-trust + injection-scan + re-homing simulation), not a presence-check | P1-3/P1-4, MEM-06/07 |
| **2 · Surface LENS engine** | screens as living **semantic lenses** over the org-graph | **The entire unified-surfaces dossier**: `LensDefinition` (semantic layer/OSI) + KG-OLAP roll-up/drill-down operators + self-re-categorizer + headless multi-consumer + context-graph back-link + plane-typed lenses (INV-A) + predictive warm-expansion. UU-2/UU-4/UU-7 fold here: generated surfaces pass EN/SW + a11y purity and bind through a Cambria lens | P2-1..P2-7, GAP-LENS-1..8 |
| **3 · Org KG + digital twin** | the model the brain reasons over | KG-OLAP contextual hierarchy as the roll-up spine; context-graph (read+write decision traces); simulatable twin ("org git" branch-on-history); UU-6/UU-8 fold here (DR coherence + constructed-world inspector over PROV-O) | P3-1..P3-6 |
| **4 · Skill/capacity + tool-synth NERVOUS SYSTEM** | right node, free-now, fair — AND the capability that *grows* | **The entire tool-synthesis dossier**: the synthesis loop with a **verifier-dominant prove-safe gate** (CREATE/COMPOSE → draft+contract → sandbox self-correct → static/semantic/contract/risk/provenance gates → trust-tier → persist → grow-able registry); UU-14 folds here (gate-routing monotone, never optimizable downward); Dispatch Kernel (Hungarian/CP-SAT/auction/MARL) is the capacity half | P4-1..P4-5, EA-06, AUT-03 |
| **5 · Proactive org-design loop + closed-loop fabric** | the org redesigns *itself*; consequential events run to closure | self-extension on durable execution + empirical-fitness gate + twin-driven proposals; **the 9-stage fabric** (detect→schedule→ladder→route→act→escalate→close→audit→learn) is the *operational* loop that keeps the estate running while the *structural* loop redesigns it; UU-9/UU-13 fold here (posture-composition algebra + construction-budget governor) | P5-1..P5-5, X-1..X-8, fabric stages 1-9 |

### 1.2 — The data-firewall (INV-A) is the *immune system*, not a sixth pillar

INV-A wraps the whole organism: it is the membrane between Borjie-internal control plane (admin-web :3020) and the owner's data plane (owner-web :3010). The dossier's **5-rung ladder** is the maturity model the architecture climbs:

- **Rung 1-3 (policy + audit, ship now):** break-glass spine — `operator_access_grants` (justification-coded, deny-by-default, time-boxed, single-tenant), wired impersonation route, hash-chained Access-Transparency log, tenant-visible Trust-Center mirror, deny-by-default gateway middleware on tenant-business routes, and **strip `SUPABASE_SERVICE_ROLE_KEY` from admin-web entirely**. This closes the four confirmed leaks (`/warehouse`, `/decision-trace` service-role, `support-tickets`/`daily-brief` content, `/data-privacy`).
- **Rung 4-5 (cryptography + attestation, the beyond-today wall):** per-tenant BYOK/CMK envelope encryption with Key-Access-Justification on every unwrap (operator sees ciphertext); attested confidential-compute enclave (Nitro/PCC pattern) for the break-glass read path (no shell, no debugger, attestation-gated key release); non-targetability (blind-signed relayed requests); published transparency log of the admin/gateway build. INV-A becomes enforced **by cryptography and attestation, not by code review**.

The decisive fold: the unified-surfaces dossier's **plane-typed lens** (§3.6) makes INV-A enforceable *at the lens-definition level* — a lens is typed `control` | `data` at authoring time, and the meta-rail rejects any control-plane lens whose definition touches a tenant business table. No BI vendor encodes a plane type into the semantic layer; Borjie does, and it is what makes "metadata-only by construction" a *typed* guarantee rather than a review convention.

### 1.3 — The meta-rail (Pillar 6 / K-3) is the *one chokepoint*, now triple-stacked

Today K-3 is a fail-closed **deny-stub** (`orchestrator-bindings.ts:1098-1104`) — every capability-growth path falls back to `chat`. Binding the real `authorizeBodyChange` is the single highest-leverage change (Wave 0). The synthesis adds **two more gates stacked under the rail**, fail-closed, in order:

```
proposed organ (surface | type | field | edge | skill | tool | sub-MD | workflow | lens)
  → CONFORMANCE GATE (UU-15, the seam-sealer): one judge enforcing the full invariant set
        · EN/SW language-purity (UU-2)        · accessibility WCAG 2.2 AA (UU-4)
        · PII/permission classification (UU-5) · evidence-TRUST not presence (UU-10)
        · coherence / lens-binding (UU-7)      · concurrency-safety / CAS (UU-3)
        · reversal-semantics declaration (UU-11) · routing-integrity floor (UU-14)
  → PROVE-SAFE CORRECTNESS GATE (tools only, INV-C): static(G1) → semantic-intent(G2)
        → contract discharge (SEVerA pre/post) → manifest-hash + Ed25519 (provenance)
  → BODY-CHANGE META-RAIL (authority/risk): inviolable.ts + policy-gate + controller
        → money/licence/deletion forced HITL four-eye regardless of confidence
  → trust-tier assign (T1 read-only default) → PERSIST → grow-able registry → MONITOR/demote
```

The offense moat (induction, surface synthesis, tool synthesis, org redesign) is safe **only because** the three gates are immutable to the agent: it can grow capability but can **never** touch its own gate/audit/test machinery (`inviolable.ts:482`), and — critically — **can never optimize the classifier that routes to the gate downward** (UU-14: gate-routing is part of the inviolable floor, monotone, sharpenable-up only).

---

## 2. EVERY CAPABILITY IS A FIRST-CLASS PILLAR (nothing under-weighted)

The risk this synthesis exists to prevent: the four dossiers being treated as "nice-to-haves" bolted onto a capability roadmap that is really about the brain. They are not. Each is a **load-bearing pillar of equal weight**, and each has the same shape (SOTA mechanism → Borjie substrate we already hold → the delta → buildable lane → wave). They are listed here as peers, not appendices.

### Pillar A — Unified semantic-lens surfaces (skin + senses) · FIRST-CLASS
- **We already hold the rare half:** `core_entity` polymorphic org-graph row-store (hierarchy via `parentEntityId`, hybrid BM25+dense+geo+JSONB retrieval) = the KG-OLAP substrate; `portal-genui` = intent→view render; `dynamic-sections` = the auto-expand primitive.
- **The delta (GAP-LENS-1..8):** no `LensDefinition`, no roll-up/drill-down operators over `core_entity`, static (not re-derived) categorization, no auto-contract, no headless multi-consumer guarantee, no context-graph back-link, no plane-typing, no warm expansion.
- **Buildable lane:** the 5-step minimal viable lens (`LensDefinition` → KG-OLAP operator kernel with the `Σ operation-cells ≡ estate-cell` reconciliation gate → self-re-categorizer through the meta-rail → portal-genui binding → context-graph back-link + warm expansion). **Wave 4** (+ self-re-categorization in **Wave 6-7**).

### Pillar B — INV-A cryptographic data-firewall (immune system) · FIRST-CLASS
- **We already hold:** the correct SOTA aggregate-query lens (`/ask` + DP-budget) in admin-web; sound gateway auth (`app_metadata`-only tenant binding); field-encryption seam (`selectEncryptionPort`).
- **The delta:** four INV-A leaks + **zero break-glass infrastructure** in the repo (`grep break.?glass|jit.?access|tenant.?consent` = 0 impl files); no plane-typing; no BYOK/CMK; no attested enclave.
- **Buildable lane:** §3 break-glass spine (rungs 1-3) → §4 BYOK/CMK + attested enclave (rungs 4-5). **Wave A** (P0, leaks) → **Wave 7+** (crypto wall). Folds into `SPEC_SECURITY_DATA_P0.md` + DP-01..12, SEC-G1..9.

### Pillar C — Self-extending tool-synthesis nervous system (growth) · FIRST-CLASS
- **We already hold (substantial):** `self-extension.ts` (spec-level), `modality-arbiter` (7-modality keystone with `BodyChangePort`/`SkillRetrieverPort`/`FlowRetrieverPort`/`LoopRunnerPort`), `skill-library/` (Voyager library, capture-loop, `SKILL.md` builtins, `mcp-tool-search` defer-registry, subagent-spawn), `loop-runner`, `mutation-authority` (full body-change package), `js-sandbox` (isolated-vm).
- **The delta:** no artifact-CREATE loop (no `power-tools/synthesize-tool.ts`), no COMPOSE step, no correctness gate (SEVerA contracts), no skills-manifest-hash identity binding, no T1-T4 trust tiers, no "MCP Box" parameterization, no `code` action modality.
- **Buildable lane:** the single `power-tools/synthesize-tool.ts` module wiring the closed loop (CREATE/COMPOSE arbiter branch → draft+contract → sandbox self-correct → verifier-dominant prove-safe gate → trust-tier+persist → grow-able registry → monitor/demote), with money/licence/deletion contract-effect → forced four-eye. **Wave B** (keystone arbiter + synthesis) → **Wave D** (the self-improvement archive that feeds it).

### Pillar D — Generated-artifact conformance + operational-lifecycle (homeostasis) · FIRST-CLASS
- **The meta-finding the corpus was blind to:** the inviolable invariants (EN/SW purity, evidence-trust, reversibility, RLS/permission, accessibility, coherence, auditability) are specified for *hand-built and text* artifacts and **silently un-enforced on the artifacts the brain generates**. The rails exist; they do not extend to the things the brain makes.
- **Buildable lane:** the **Conformance Gate** (UU-15, subsumes 8 of 14 UUs) stacked into the synthesise→propose loop, + the four operational-lifecycle lanes (cold-start UU-1, DR-coherence UU-6, posture-composition UU-9, construction-budget UU-13). **Wave A** (the gate skeleton rides every other wave's commit stage) → distributed across all waves as each pillar's commit stage acquires its conformance term.

### Pillar E — Operational closed-loop fabric (circulation) · FIRST-CLASS
- **We already hold (organs strong, joints weak):** durable outbox, per-recipient dispatch log, SKIP-LOCKED claim, backoff+DLQ, real email/SMS/WhatsApp/push/Slack/calendar providers, cluster leader-election, ~20 leader-gated crons, hash-chained audit, 4-eye escalation table. Loop wired for two narrow domains (cert-expiry, owner reminders).
- **The delta (the joints):** delivery/read closure OPEN (receipts published, never written back), no durable LADDER primitive (hard-coded offset arrays per cron), two parallel reminder rails, policy-less ESCALATE, no per-recipient LEARN.
- **Buildable lane:** four-primitive fabric under one rails+audit layer (Postgres-backed durable execution owns ladder+fire-once · self-hosted Novu egress with escalation logic in the workflow · junior-drafted ACT · closure observed from source-of-truth row via outbox · STO+offline-RL LEARN that APPENDS). **Wave B** (durable money-path + outbox) → **Wave 7** (self-tuning ladder).

> **Weighting discipline:** in the roadmap (§5) each wave names its A/B/C/D/E pillar contributions explicitly, so no pillar is silently deferred to "later." The demo (§6) lands on all five at once — the org-chart that constructs itself (A+C), under the firewall (B), through the conformance gate (D), with a consequential event running to closure live (E).

---

## 3. THE CONSOLIDATED UNKNOWN-UNKNOWNS REGISTER (deduped, severity-ranked, each with a buildable lane)

The 14 unknown-unknowns deduplicate against the prior 132 gaps and against each other. Twelve of fourteen share **one structural blind spot** — the inviolable invariants are not carried onto generated artifacts — and collapse into **one subsuming lane (UU-15, the Conformance Gate)**. The four operational-lifecycle UUs stand alone. Severity-ranked:

| ID | Sev | One-line | Why it bites (in one phrase) | Buildable lane | Wave | Subsumed-by / cross-ref |
|---|---|---|---|---|---|---|
| **UU-15** | **BLOCKER** | **Generated-Artifact Conformance Gate** — one judge enforcing the full invariant set on *every* brain-constructed organ before it can be proposed | the seam between construction engine and defense moat is unsealed | One judge in the synthesise→propose loop running language-purity + a11y + PII-class + evidence-trust + coherence + concurrency + reversal-decl + routing-integrity; rejects/rewrites non-conformant organs | **A** (skeleton) → rides every wave | subsumes UU-2,3,4,5,7,10,11,14 |
| UU-10 | HIGH | Induction-TRUST gate (evidence-poisoning defeats "evidence-required") | self-constructing the *data model* from untrusted tenant evidence with only a presence-check | consistency-check vs SHACL seed + high-conf facts (KARMA) · provenance-trust scoring (corpus/signed > unverified upload) · indirect-injection detector over induction evidence · re-homing simulation before commit | A/3 | folds into UU-15; SEC-G1 |
| UU-14 | HIGH | Gate-routing classifier is editable + unprotected (Goodhart attack on own routing) | brain learns to *not send* money/licence to the gate it can't edit | risk classifier for HIGH-risk prefixes is part of inviolable floor — monotone, sharpenable-up only; inline routing-integrity probe re-derives risk outside optimizable path, fails closed | A/B | folds into UU-15; RSS-19, AUT-08 |
| UU-5 | HIGH | Synthesized fields born unclassified (PII/residency/ACL time-bomb) | a brain-minted field can hold a national ID with no governance metadata | classification mandatory in the schema body-change proposal (pii_class + residency_class + read/write predicate, LLM-inferred, gate-confirmed, written atomically); promoted table inherits FORCE RLS in same migration | A/3 | folds into UU-15; DP-04 |
| UU-2 | HIGH | No EN/SW purity gate on *synthesized* surfaces (ABSOLUTE toggle silently violated) | a genUI surface emits "Royalty Schedule / Ratiba ya Mrabaha" mixed | UI-judge runs language-sota detector over every string in `layout_spec`, rejects/rewrites mismatched-locale; genui re-emits catalog labels through `dynamic-language-rewriter` at render | A/4 | folds into UU-15 |
| UU-3 | HIGH | Concurrent multi-user surface editing → lost-update by construction | two managers refine the same surface; last-write clobbers a whole-JSON blob | `row_version` CAS on `portal_tabs`/`tab_proposals_inbox`/org-edit rows → 409 on mismatch; mount existing `yjs-doc`/`slot-crdt` for collaborative refinement | A/4 | folds into UU-15 |
| UU-1 | HIGH | Cold-start: a self-inducing org-model has nothing to induce from on day 0 | empty cockpit on day 0 reads as broken, not autonomous | cold-start synthesis protocol: seed ontology backbone + conversational ontology interview (first 5 chat turns → seed types + first surface-graph) + synthetic-evidence warm-start (provisional, one-click-confirmable) | **1** | standalone (operational) |
| UU-6 | HIGH | DR of a tenant-synthesized world is unproven | a restore can bring back instances with a stale catalog → self-inconsistent model | extend backup-restore drill with synthesized-world coherence assertion (every instance references live catalog type; every promoted table has matching catalog row + intact RLS; surfaces bind only to extant fields; KG bi-temporal chain unbroken) | **6** | standalone (operational) |
| UU-11 | HIGH | Rollback's data-migration tail unspecified ("reversible" doesn't hold for schema/org) | "undo" on a schema change is undefined once 412 entities re-homed | reversal semantics per body-change class: surface/skill=restore version; schema-additive=pgroll reverse; schema-destructive/re-homing=compensating saga + post-change-edit reconciliation (conflict list, not auto-clobber); gated previewable op | 3/6 | folds into UU-15; EXEC-saga |
| UU-7 | MED-HIGH | Schema-lens coherence named for surfaces, missing for persisted artifacts (reports/decks/exports/mobile cache) | a column rename the surface lens absorbs still breaks yesterday's PDF + offline cache | lens layer becomes a schema-binding *service* every persisted-artifact reader goes through (surfaces, reports, decks, exports, mobile sync); version read-schema per artifact | 4 | folds into UU-15; P2-5 |
| UU-4 | MED-HIGH | Generated surfaces exempt from the WCAG 2.2 AA bar hand-built ones meet | brain emits unlabelled icon button / 2.5:1 contrast tile, no audit catches it | a11y term in the UI-judge (axe-core rules over `layout_spec`: accessible name on every interactive node; contrast ≥ AA; chart text alt; keyboard path); genui catalog a11y-correct by construction | A/4 | folds into UU-15 |
| UU-8 | MED-HIGH | No legibility/observability for self-constructed schema+UI (can't debug what the brain built) | support is blind exactly where the product is most novel | constructed-world inspector: per organ render provenance chain (evidence_ids, confidence, inducing turn, approver) + blast-radius + empirical fitness + bi-temporal history; back by PROV-O (MEM-07) | 6 | standalone (observability); MEM-07 |
| UU-9 | MED-HIGH | Conflicting autonomy postures across teams/scopes → incoherent org behaviour | manager A sets royalty AUTO, manager B sets its approval gated → deadlock or gate-leak | posture-composition algebra: postures lattice-order (gated ⊐ suggest ⊐ auto); effective posture = most-restrictive over dependency closure in org-graph; org-design loop flags contradictions; money/licence/deletion floor stays gated unconditionally | 5/6 | standalone (operational); ORCH-flowprefs |
| UU-12 | MED-HIGH | Synthesized surfaces ⨯ offline mobile collision (pit/rural 2G reality) | the pit worker — the core user — is the one most likely offline, no offline story | degrade-gracefully contract for generative UI: cache last `layout_spec`+data snapshot, render read-only offline with "snapshot from HH:MM" marker, queue offline accept as intent re-validated via CAS on reconnect; never synthesize new surface offline | 4 | folds into UU-15 (concurrency) + standalone |
| UU-13 | MED | Construction-budget runaway (proposal sprawl, not token spend) | brain proposes 40 things nobody approves → owners reflexively dismiss | construction-budget governor parallel to token governor: per-tenant proposal rate ceiling + dedup induced proposals (EDC Define pass before surfacing, cross-tenant) + approval-queue back-pressure (stop generating when N pending, help clear) | 6/7 | standalone (operational); AUT-05 |

**The two clusters, restated:** (i) **conformance** — UU-15 subsumes UU-2/3/4/5/7/10/11/14, the one seam the corpus left open, extending the Auditor-gate from text answers to the constructed world. (ii) **operational-lifecycle** — UU-1 (cold-start), UU-6 (DR), UU-8 (legibility), UU-9 (posture-composition), UU-12 (offline), UU-13 (construction-budget) — the day-0, the restore, the org with conflicting humans, the pit on 2G, the day the queue overflows. Both clusters are **domain-agnostic shared substrate** — build-once / mirror-twice across Borjie ⇄ BN.

---

## 4. THE SAME ARCHITECTURE FOR BORJIE + BOSSNYUMBA

Every organ above lands in the **shared, domain-agnostic** layer. BN inherits by pointing the engine at the other ontology pack — no second architecture.

| Capability | Shared organ (built once in Borjie) | The ONLY BN fork |
|---|---|---|
| Lens engine (A) | `LensDefinition` + KG-OLAP operators over `core_entity` + self-re-categorizer + plane-typing | dimension binding: "royalty exposure across mines" ⇄ "rent-arrears exposure across buildings" — same definition, swapped bind |
| Data-firewall (B) | break-glass spine + BYOK/CMK + attested enclave + plane-typed lens rejection | nothing — identical; BN's `decision-trace/page.tsx:72` carries the **same** service-role leak (V2 verbatim) |
| Tool-synth nervous system (C) | the one `synthesize-tool` loop + verifier-dominant prove-safe gate + grow-able registry | the org-shaped MCP Box auto-partitions by org-graph, so mining and RE grow *different* capability frontiers from the *same* synthesis kernel |
| Conformance + lifecycle (D) | the Conformance Gate + cold-start/DR/posture/budget lanes | seed ontology it validates against |
| Closed-loop fabric (E) | four-primitive fabric under one rails+audit | RE sensors (lease expiry, arrears, DSCR) + RE cohort benchmarks vs mining (licence expiry, royalty, assay) |
| Schema synthesis (1) | EDC induction loop + bi-temporal/PROV-O + pgroll | seed pack: `realEstateOntology` (RICS/IVS/rent-roll/WALT) vs `miningOntology` (licence/deposit/assay/royalty) |
| Twin (3) | causal/ABM sim + process-mining + Dispatch Kernel | eligibility/cost fn (RE field team + viewing/maintenance) vs (mining crew + shift/assay) |

**The parity dividend (today):** Borjie's `0306` built-ins (17 RE types), its `org-graph/projector.ts` edges (lease/unit/invoice), and its KG ontology (`real-estate.ts`, no `miningOntology`) are **all still real-estate** — wrong for Borjie but *exactly the BN seed pack*. Wave 1+2 physically prove the single-engine/two-packs thesis by lifting that residue into the BN pack and installing the mining pack in Borjie. **BN is behind on the body layer (EA-10: actuators but zero system-graph/blackboard/mutation-authority)** — so the parity action is: build to a clean domain-agnostic seam in Borjie, then port the engine + ship the RE pack to BN.

---

## 5. THE DEPENDENCY-ORDERED FULL-CODE ROADMAP (flag-default-safe waves)

Each wave ships behind a default-off env flag with the UI/Modality-Invariant wiring tests: (a) no UI change without approval, (b) low-need turn proposes nothing, (c) chat refinement re-synthesizes, (d) auto-flow spawns ambiently but reversibly, (e) a routed money/licence action still hits the policy-gate. Waves are ordered so each produces the substrate the next reads. Pillar contributions (A=lens · B=firewall · C=tool-synth · D=conformance · E=fabric · 1-5=vision pillars) are named so nothing is under-weighted.

### WAVE 0 — Bind the keystone meta-rail · **DEMO BLOCKER**
Replace the `buildBodyChangePort()` deny-stub (`orchestrator-bindings.ts:1098`) with a real `composition/body-change-wiring.ts` binding `@borjie/mutation-authority.authorizeBodyChange`; swap at `brain-kernel-wiring.ts:1013`. Flag `BORJIE_BODY_CHANGE_RAIL`. **Closes K-3 / EA-04.** *Smallest change, largest leverage — after this every pillar's commit stage can persist under approval, reversibly.* (Pillars 1,2,4,5 all unblock.)

### WAVE A — knowledge-flow + scale-P0 + security/data-P0 + INV-A leaks + Conformance-Gate skeleton + memory durability · (the "stop being structurally blocked / leak / lie" wave)
The `MASTER_GAP_REGISTER` Wave-A spine, **plus** the two frontier P0s folded in:
- **Knowledge flow:** repoint dead corpus path + fail-loud (KI-01/02), unique-index for upsert (KI-05/06/13), fix ANN column + cosine op (KI-07/08), schedule ingest + regulator sensor (KI-03/16/17), `miningOntology` (KI-10).
- **Scale P0:** drop reserve()+`prepare:false` tx-pooler-safe RLS (RSS-03), HA overlay (RSS-10), cluster-lock crons (RSS-06), Redis SSE bus + rate-limiter + onboarding (RSS-05/08/09), autonomy-controller meta-rail (RSS-16).
- **Security/data P0:** corpus RLS `WITH CHECK` (DP-02), wire agent-security-guard (SEC-G1), JWT iss/aud + Redis revocation (SEC-G2/G3), data-protection wiring (DP-01/03/04/06).
- **INV-A leaks (Pillar B, rungs 1-3):** break-glass spine + strip service-role key + deny-by-default middleware + plane-typing skeleton.
- **Conformance-Gate skeleton (Pillar D, UU-15):** stand up the single UI/artifact judge with its first terms (evidence-TRUST UU-10, routing-integrity UU-14, PII-class UU-5) so every subsequent wave's commit stage plugs into it.
- **Memory durability:** Drizzle stores for memory-v2 (MEM-01), live `observe()` writer (MEM-02), real consolidator (MEM-05). *(Several rows here are already shipped — tasks #5-24 — keep them as the proof-of-pattern.)*
Flags per organ, all default-off. **Removes every "structurally blocked / leaks / lies" class.**

### WAVE 1 — Mining ontology seed + bi-temporal fact model + cold-start protocol · **DEMO BLOCKER**
Author `miningOntology` seed pack (entity/event types + SHACL); lift 17 RE built-ins into `realEstateOntology` for BN. Wire bi-temporal `(t_valid,t_invalid)` + PROV-O onto catalog/graph writes (invalidate, never delete). **Fold UU-1 cold-start:** conversational ontology interview (first chat turns → seed types + first surface-graph) + synthetic-evidence warm-start (provisional, confirmable). Flags `BORJIE_MINING_ONTOLOGY`, `BORJIE_COLD_START`. **Closes P1-4, P1-5, P3-4(ontology), UU-1.** *Physical proof of the single-engine/two-packs thesis.*

### WAVE 2 — Self-deriving body/system-graph + re-domained org-graph projector · **DEMO BLOCKER**
Schedule `deriveSystemGraph` (leader-elected cron + `listChanged`); persist the real 180+-node graph; bind `bodySchemaReader`; expose `query_body_schema`/`body_blast_radius`. Re-domain `org-graph/projector.ts` to mining edges, run as a worker writing `org_graph_edges`. Resolve `knowledge-graph` + `graph-rag-router` to ONE graph of record; fuse body-graph + org-graph into one query plane. Flag `BORJIE_SYSTEM_GRAPH_DERIVE`. **Closes P3-2, P3-3, P3-4(stacks), EA-01.** *(This is the KG-OLAP substrate the lens engine reads in Wave 4.)*

### WAVE 3 — EDC schema-induction loop + induction-trust gate + pgroll promotion + classification-at-birth · **DEMO BLOCKER**
Build EDC induction (Extract→Define→Canonicalize, AutoSchemaKG/Graphiti): evidence → schema-free triples → LLM dedup vs catalog + vector similarity → align-or-propose → KARMA auditor → versioned data-contract as a `bodyChange` proposal (rides Wave 0). **Fold UU-10 induction-trust gate** (consistency + provenance-trust + injection-scan + re-homing simulation) and **UU-5 classification-at-birth** (every induced field carries pii/residency/ACL, written atomically; promoted table inherits FORCE RLS). Add pgroll promotion lane + OntoRipple validator co-evolution. Flag `BORJIE_SCHEMA_INDUCTION`. **Closes P1-3, P1-6, P1-7, UU-5, UU-10.** *Demo step 2 (a licence type proposes itself) lights up.*

### WAVE B — outbox money-path + capability/tool-synthesis nervous system + closed-loop-fabric core
Two frontier pillars land here:
- **Money-path durability (E core):** port `DurableEventPublisher` co-commit + Drizzle `IOutboxRepository` (RSS-01), Drizzle approval-router (RSS-21), durable Inngest/PG-poller (RSS-23), saga+compensation (EXEC-saga). This is also the durable substrate the fabric ladder rides.
- **Tool-synthesis nervous system (Pillar C, INV-C):** the keystone modality arbiter (COG-07/AUT-14) + `power-tools/synthesize-tool.ts` (CREATE/COMPOSE → draft+contract → sandbox self-correct → **verifier-dominant prove-safe gate**: static G1 → semantic G2 → SEVerA contract → meta-rail risk → manifest-hash+Ed25519 → trust-tier T1 → persist → grow-able registry → monitor/demote). Money/licence/deletion contract-effect → forced four-eye. Wire Voyager capture→compile (AUT-03), kernel.think() as default on consequential surfaces (COG-01), real confidence/policy/abstention before translate (RSS-22/COG-03), LATS/ToT on hard band (COG-02), forced simulate-before-act pre-commit (RSS-17).
- **Conformance fold (D):** the synthesized tool passes the Conformance Gate (UU-15) before promotion.
Flags `BORJIE_MODALITY_ARBITER`, `BORJIE_TOOL_SYNTH`, `BORJIE_DURABLE_OUTBOX`. **The keystone everything lands on + the growth verbs + the money-path durability.**

### WAVE 4 — Surface LENS engine + Cambria lenses + generated-UI conformance · **DEMO BLOCKER**
**The unified-surfaces pillar (A) lands here.** Build `LensDefinition` (semantic-layer/OSI shape over `core_entity`, headless multi-consumer) + KG-OLAP operator kernel (`rollUp = merge ∘ value-generating abstraction`, `drillDown = dice + coverage-inherit`, with the `Σ operation-cells ≡ estate-cell` **reconciliation gate** as a renderability invariant) + plane-typed lens (control|data, INV-A rejection) + portal-genui binding (arbiter routes intent→lens→view) + surface-GRAPH node/edge model (P2-3/4) + Cambria lens layer (P2-5, read-schema vs write-schema; migration registers a lens; destructive change → proposal with visual diff). **Fold the conformance terms:** EN/SW purity (UU-2), a11y (UU-4), concurrency CAS + yjs (UU-3), lens-binding for all persisted artifacts (UU-7), offline degrade-gracefully (UU-12). Flags `BORJIE_LENS_ENGINE`, `BORJIE_SURFACE_GRAPH`. **Closes GAP-LENS-1..2/5/7, P2-3/4/5/6, UU-2/3/4/7/12.** *Demo step 3 (a `licence_console` lens proposes itself, chat-refinable, rolls up + drills down from one definition) lights up.*

### WAVE 5 — Digital twin + process-mining + Dispatch Kernel + posture-composition · **DEMO BLOCKER (twin + kernel)**
Process-mine `event_outbox`/`audit_events` into BPMN-shaped `flow` nodes (cycle-time/error/four-eye metrics). Build the simulatable twin (LLM-ABM + structural causal model + "org git" branch-on-history → predicted delta sheet + blast-radius). Build the **Dispatch Kernel** (eligibility filter → cost/utility score → solver tier Hungarian/CP-SAT/auction/MARL by latency budget → confidence+handoff → disruption listener → fairness ledger) over the org-graph skill/ownership/capacity edges; wire the 3 dark agents (DM-01). **Fold UU-9 posture-composition algebra** (most-restrictive over dependency closure; flag contradictions; money/licence/deletion floor gated). Flags `BORJIE_ORG_TWIN`, `BORJIE_DISPATCH_KERNEL`. **Closes P3-5, P3-6, P4-4, P4-5, UU-9.** *Demo steps 4 (twin predicts a gap, COO proposes an organ) + 5 (work routes free-now/fair) light up.*

### WAVE 6 — Proactive org-design loop + empirical-fitness gate + DR-coherence + constructed-world inspector + construction-budget · **DEMO BLOCKER (loop)**
Bind `self-extension` into a scheduled worker driven by the Wave-5 twin (detect recurring gap → simulate → propose through meta-rail → org-chart redraws). Stand the loop on durable execution (resumable/compensatable `bodyChange`). Chain `draft→shadow→canary→live` empirical-fitness with burn-rate/NOI/SLO auto-rollback to archived parent. Ship Dockerfiles + leader-elected k8s CronJobs for all 4 evolution workers + sleep-pass. Add predictive org-design (pre-build organs under gate). **Fold UU-6 DR-coherence** (synthesized-world coherence assertion in the backup-restore drill), **UU-8 constructed-world inspector** (per-organ provenance + blast-radius + fitness + bi-temporal history over PROV-O), **UU-11 reversal-semantics** (compensating saga + post-change-edit reconciliation), **UU-13 construction-budget governor** (rate ceiling + dedup + back-pressure). Flags `BORJIE_ORG_DESIGN_LOOP`, `BORJIE_EVOLUTION_WORKERS`. **Closes P5-1..5-5, UU-6/8/11/13.** *Demo step 4's "new sub-MD compiled, sandbox-smoke-tested, shadow→canary→live" completes.*

### WAVE 7 — Proactive/ambient amplifiers + closed-loop fabric LEARN + network-effect moats + INV-A crypto wall
Add the LOOP modality (X-1); ambient sensor plane over `event_outbox` + regulator feed (X-2); conformal interruption budget bound to COG-03 (X-3); sleep-time precompute + counterfactual nightly rollouts (X-4); **closed-loop fabric LEARN** (STO + offline-RL self-tuning ladder per recipient, append-only — fabric stage 9); self-rewriting compliance checks (X-8); self-re-categorizing lens (the unified-surfaces §3.1 leap, online re-derivation through the meta-rail); then the compounding moats — DP cross-tenant benchmark (X-6), AP2-mapped autonomous negotiation (X-7), and the **INV-A crypto wall** (Pillar B rungs 4-5: BYOK/CMK + attested enclave + transparency log). Flags per organ, all default-off. **Closes X-1..X-8, GAP-LENS-3/4/8, INV-A rungs 4-5.** *Makes the "08:00 — the estate has already done the thinking" opening real and turns the moat from defensible to compounding.*

### WAVE D — self-improvement loop + the eval harness that DEFINES "done"
The nightly "gets better while the mine sleeps" loop: replay→eval→update (AUT-06), GEPA/AFlow/ADAS/DGM archive (AUT-07/08/09/10), earned-autonomy graduation (AUT-04), Voyager autotelic curriculum (AUT-11), and the **8-axis eval harness** as a standing regression suite (the definition of done: depth across breadth · target autonomy per task-class · novel within-domain generalization · long reliable horizons · grounded multi-step competence · calibrated metacognition that ACTS · robust+abstaining · no continual-learning regression). **Critically, every self-improvement optimizer respects UU-14:** GEPA may sharpen classifier recall, never lower the gate-routing floor. Flags per organ. **Closes the AUT/COG self-improvement tail + locks the safety floor.**

---

## 6. DEMO-BLOCKER CRITICAL PATH (the wow self-wiring story)

The "org wires itself on the fly under the operator's thumb" demo requires, in strict dependency order:

```
WAVE 0  (K-3)            bind meta-rail ─────────────────► nothing commits without this
WAVE A  (DP-02,SEC-G1,   INV-A leaks closed + conformance ► the firewall holds + generated
         break-glass,     gate skeleton                      organs are governed at birth
         UU-15 skeleton)
WAVE 1  (P1-4/5, UU-1)   mining ontology + cold-start ────► the nouns exist + day-0 is alive
WAVE 2  (P3-2/3)         body+org graph derived ──────────► the model re-derives
WAVE 3  (P1-3, UU-5/10)  EDC induction + trust gate ──────► licence type proposes itself (step 2)
WAVE B  (COG-07, C)      arbiter + tool-synth + outbox ───► capability can grow + money durable
WAVE 4  (GAP-LENS-1/2,   surface LENS engine + lenses ────► licence_console lens proposes itself,
         P2-3/4/5)                                           rolls up + drills down (step 3)
WAVE 5  (P3-6, P4-4)     twin + Dispatch Kernel ──────────► COO proposes an organ + work routes (4,5)
WAVE 6  (P5-1/3)         org-design loop closes ──────────► org-chart redraws, sub-MD → canary (4)
```

**The demo-blocker rows:** `K-3` · `DP-02`/`SEC-G1` + break-glass + `UU-15` skeleton · `P1-3` · `P1-4` · `UU-1` · `P2-3`/`GAP-LENS-1` · `P3-2` · `P3-3` · `P3-6` · `P4-4` · `P5-1` · `P5-3` (+ `P1-5` bi-temporal for the time-travel close). Wave 7 makes the demo *open* better (the 08:00 pre-staged-proposals coffee + the self-tuning fabric ladder + the crypto wall) but is not required for the core self-wiring proof.

**The blockers most likely to bite the wow demo specifically (watch these):**
1. **K-3 deny-stub** — until the real `authorizeBodyChange` is bound, *every* self-construction silently falls back to `chat` and nothing the demo creates can persist. This is the single point of failure.
2. **UU-15 Conformance Gate absent** — without it, the first synthesized surface in the demo can emit mixed EN/SW, an inaccessible widget, or an unclassified PII field on stage, breaking the "governed by construction" claim live.
3. **GAP-LENS-1/2 (no `LensDefinition` / no roll-up-drill-down)** — the headline "whole estate ⇄ this one mine from the same definition" beat fails without the KG-OLAP operator kernel + reconciliation gate; portal-genui renders a view but cannot *prove* the two poles reconcile.
4. **P3-6 twin absent** — the COO-proposes-an-organ beat needs the simulate-before-reorg delta sheet; without it the proposal has no predicted-impact evidence and reads as a guess.
5. **INV-A leaks open during a live demo with a "support" persona** — if `/decision-trace` or `/warehouse` are reachable on stage, the firewall claim is falsified in real time; the break-glass spine must be in before any operator-console demo.
6. **The flagship genUI surface the demo lands on is the living, reasoned, proposal-gated, reversible org-chart itself** — the visible proof that Mr. Mwikila is a self-constructing organizational brain, not a chatbot with tools.

---

## 7. THE ONE INVARIANT (never violated by any lane)

The offense moat — self-improvement, self-writing memory, schema/surface/tool/org synthesis, AUTO — is safe **only because** of the defense moat: the meta-rail, `inviolable.ts`, policy-gate, RLS+`WITH CHECK`, hash-chained append-only audit, kill-switch fail-closed, conformal abstention, the Conformance Gate (UU-15), and the verifier-dominant prove-safe gate (INV-C). They are **one system**. Money / licence / deletion stay dual-control HITL forever. The agent can grow capability without bound but can **never** touch its own gate/audit/test machinery (`inviolable.ts:482`) **and can never optimize the classifier that routes to that gate downward** (UU-14) — self-improvement may sharpen recall, never lower the floor. INV-A's firewall climbs from policy to cryptography so the operator *cannot* read rather than *must not*. This is what makes a self-constructing organizational brain trustworthy in the field rather than a beautiful, unsafe demo.

---

## 8. Source ledger

- **The four frontier dossiers folded in:** `frontier-unified-surfaces.md` (Pillar A / lens engine, GAP-LENS-1..8), `frontier-admin-data-boundary.md` (Pillar B / INV-A firewall, V1-V5 + 5-rung ladder), `frontier-tool-synthesis.md` (Pillar C / INV-C nervous system, the synthesis loop + prove-safe gate), `frontier-unknown-unknowns.md` (Pillar D / the 14 UUs + the Conformance-Gate subsumer).
- **The org-brain corpus:** `MASTER_GAP_REGISTER.md` (132 gaps + INV-A/B/C + UI/Modality Invariant §314), `ORG_BRAIN_GAP_REGISTER_AND_ROADMAP.md` (6 pillars + 8 waves + demo critical path), `SELF_ORGANIZING_ORG_BRAIN_VISION.md` (the ring north-star), the eight `vision-*.md`.
- **The closed-loop fabric:** `OPERATIONAL_CLOSED_LOOP_FABRIC.md` + `fabric-sota.md` (9-stage SOTA) + `fabric-code-audit.md` (organs strong, joints weak).
- **Shipped proof-of-pattern (this session, tasks #5-24):** memory-v2 Drizzle stores (MEM-01/02/05), RSS-09 onboarding persistence, media-engine package, SEC-G1 agent-security-guard, DP encryption/PII, SEC-G2/G3 JWT hardening, capability brain-tools + modality proposal sink + arbiter executor binding + gateway artifact route.

---

## 9. One-line verdict

We hold the rare halves — the org-graph, the render substrate, the meta-rail package, the skill library, the durable outbox, the DP-aggregate lens — and we lack the **lens layer**, the **synthesis loop**, the **firewall spine**, and the **conformance seam** that bind them into a living organism. Bind the keystone (Wave 0), seal the firewall and the conformance seam (Wave A), then build the five first-class pillars in dependency order (Waves 1-7 + D) — and the estate stops being a chatbot with tools and becomes a self-constructing organizational brain that is, by construction, coherent, fair, legible, recoverable, and uncompromised. Same machine, two estates.
