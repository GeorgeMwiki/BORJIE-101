# Frontier Unknown-Unknowns — the gaps we don't know we have

**Lane:** `unknown-unknowns-gap-hunt` (ADVERSARIAL completeness critic)
**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Author:** adversarial gap-hunt subagent (Opus 4.8, 1M ctx) — read CLAUDE.md,
MEMORY.md, the 8 `vision-*.md`, `fabric-*.md`, `frontier-*.md`,
`SELF_ORGANIZING_ORG_BRAIN_VISION.md`, `MASTER_GAP_REGISTER.md` (132 gaps), the
`SPEC_*` + domain maps, then grepped the live codebase.
**Mandate:** find the gaps that **neither the owner nor the prior 100+ dossiers
named** — the ones that bite a *self-constructing organizational brain* not on
the capability axis (which the corpus covers exhaustively) but on the
**operational, correctness, lived-experience, and adversarial-safety axes**.
**Sibling note:** every gap below is domain-agnostic substrate — it bites Borjie
(mining) and BossNyumba (real-estate) identically; only the seed data differs.

---

## 0. The meta-finding — what the entire corpus is blind to

The research corpus is **astonishing on ambition and blind on operation.** Across
132 register gaps and ~24 beyond-today leaps (B1–B12, L1–L7, the vision dossiers),
**every single one is a capability or frontier-differentiator.** Not one asks the
unglamorous question that decides whether a self-constructing system is *usable,
correct, and safe in the field*:

> When the brain induces a schema, synthesizes a surface, redraws the org-graph,
> and grows a tool — **what happens on day 0 (nothing to induce from), under two
> users editing at once, in Swahili, on a 2G connection in a pit, with a screen
> reader, after a restore-from-backup, when the synthesized thing is wrong, and
> when an attacker controls the evidence the induction reads?**

The corpus answers *"can the brain build it?"* It never answers *"is what the
brain built coherent, fair, legible, recoverable, and uncompromised?"* That
entire quadrant is the unknown-unknown. The deepest irony: the corpus's own
governing invariants — **EN/SW toggle is ABSOLUTE (zero mixing)**, **evidence-
required**, **reversible-by-construction**, **RLS WITH CHECK** — are stated for
*hand-built* surfaces and *text* answers, and are **silently un-enforced on the
generated artifacts** the whole vision produces. The rails exist; they do not
extend to the things the brain makes. Below, 14 unknown-unknowns, each grounded
in code, each with why-it-bites / severity / buildable lane.

---

## UU-1 · Cold-start: a self-inducing org-model has nothing to induce from on day 0

**Why it bites.** Every synthesis lane (schema induction, surface-graph,
org-graph derivation, process-mining over `event_outbox`, task-routing,
proactive loop) is *evidence-driven* — it reads corpus, uploads, chat history,
event logs, and ledger reality to derive the model. **On a brand-new tenant all
of those are empty.** AutoSchemaKG induces nothing from zero docs; process-mining
discovers zero flows from zero events; the org-graph derives a one-node graph;
the surface synthesiser has no schema slice to project; the interruption-budget
and per-recipient learners have no telemetry. The corpus's entire thesis ("the
system of record builds itself") has **no described behaviour for the first hour
of the first tenant** — which is precisely the moment a buyer decides whether the
product is magic or empty. The `vision-dynamic-schema.md` §1.1 even names
"schema-free mode at ingest of a brand-new tenant with no model yet" as a *mode*,
but never as a **cold-start UX**: what does the owner *see and do* when there is
nothing to project?

**Code evidence.** `packages/database/src/seed.ts` + `mining-onboarding-runs`
exist, but they seed *demo/test* tenants (`seeds/trc-test-org-seed.ts`), not a
generative bootstrap. There is no "interview-to-ontology" path that turns the
owner's first 5 chat turns into a seeded `entity_type_definition` backbone, and
the built-in catalog is still **17 real-estate types** (vision-code-audit §1) —
so a mining tenant's day-0 model is not just empty, it is wrong-domain.

**Severity: HIGH.** First-run is the highest-stakes UX in the product and the
corpus has no story for it. A self-constructing brain that shows an empty cockpit
on day 0 reads as broken, not autonomous.

**Buildable lane.** A **cold-start synthesis protocol**: (a) seed the
`miningOntology` / `realEstateOntology` backbone (closes KI-10 but for the
*bootstrap*, not steady-state); (b) a **conversational ontology interview** — the
MD's first turns ask "what do you mine / where / how many sites?" and induce the
seed entity types + a first surface-graph from the *answers* (schema-guided mode,
not schema-free); (c) a **synthetic-evidence warm-start** — pre-stage plausible
surfaces from the seed ontology marked `provisional`, so the cockpit is alive
before real data arrives, each provisional surface visibly labelled and
one-click-confirmable. Cold-start is its own lane, not a fall-out of induction.

---

## UU-2 · No EN/SW purity gate on **synthesized** surfaces — the ABSOLUTE toggle is silently violated

**Why it bites.** CLAUDE.md's hardest UX rule: *"toggle is ABSOLUTE — when `en`
selected zero Swahili appears anywhere (chat, surfaces, greetings, errors,
toasts) and vice versa… no 'Habari! Hello there' mixing — ever."* This is
enforced for hand-authored copy and chat via `packages/translation` +
`language-sota`. But **the surfaces the brain *generates* carry model-emitted
labels, field names, section titles, empty-state strings, and tooltips — and
nothing routes that output through the language rewriter.** A genUI surface
synthesized while the owner is on `sw` can emit "Royalty Schedule / Ratiba ya
Mrabaha" mixed, or pure English labels on a Swahili surface — the exact violation
the rule forbids, on the exact artifacts the vision is built around.

**Code evidence.** Grep for `dynamic-language-rewriter` / `@borjie/translation`
across `packages/portal-genui/src`, `packages/genui/src`, and the
`modality-capability` composition: **zero hits.** The rewriter exists
(`packages/translation/src/dynamic-language-rewriter.ts`) and is applied to chat,
but the surface-synthesis path never calls it. `portal-genui/src/types.ts` has
*one* mention of "translate" — in an RLS comment, unrelated to locale.

**Severity: HIGH.** Directly violates a stated inviolable UX rule, on the
flagship generative surfaces, invisibly (no test asserts purity on generated UI).

**Buildable lane.** A **generated-UI language-purity gate** in the
synthesise→judge→propose loop (`vision-generative-surfaces.md` §3.3 step 2): the
UI-judge runs `language-sota`'s detector over *every* string in the proposed
`layout_spec` and **rejects or rewrites** any surface whose labels don't match the
active locale; the genui projector binds a `locale` and re-emits all catalog
labels through `dynamic-language-rewriter` at render. Add a wiring test:
"surface synthesized under `sw` contains zero EN tokens and vice versa."

---

## UU-3 · Concurrent multi-user editing of the same surface — lost-update by construction

**Why it bites.** The vision is "chat-refinable surfaces" and "proposal-gated org
redesign" — inherently **multi-actor**: an owner and a manager (or two managers,
or the proactive loop *and* a human) can refine/accept the same surface,
proposal, or org-edit at the same time. The persistence layer has **no
optimistic-concurrency token**, so the second writer silently clobbers the first
(last-write-wins on a whole-document JSON blob). The corpus discusses
reversibility (undo a *committed* change) extensively but **never concurrency** —
undo doesn't help when two simultaneous edits merge into a corrupt third state
that nobody authored.

**Code evidence.** `portal_tabs` (migration 0170, `drizzle-tab-repo.ts`) stores
the whole `PortalTab` as a JSON blob with `schema_version` (a *migration*
version, not a row-version) and `updated_at` — **no `If-Match`/etag/`row_version`
optimistic guard**; `SaveTab` is an unconditional upsert. Grep for
`optimistic|If-Match|rowVersion|lockVersion` across `portal-genui`,
`dynamic-sections`, `mutation-authority`, `genui` src: **nothing.** A real CRDT
substrate *does* exist (`packages/realtime-rooms/src/yjs-doc.ts`,
`blackboard-sota/src/slots/slot-crdt.ts`) — but it is **not wired to surface or
proposal editing**; it serves the blackboard slots only.

**Severity: HIGH.** Silent data-loss / surface corruption under exactly the
multi-user pattern the product invites. Worse on mobile where stale tabs persist.

**Buildable lane.** Add a `row_version` (or `updated_at` precondition) to
`portal_tabs` / `tab_proposals_inbox` / org-edit rows; `SaveTab` becomes a
compare-and-swap returning `409 Conflict` with the live version on mismatch. For
genuinely collaborative refinement, mount the existing `yjs-doc` /
`slot-crdt` substrate under the surface editor so concurrent chat-refinements
*merge* instead of clobber. Test: two writers, stale base → second gets 409, not
silent overwrite.

---

## UU-4 · Generated surfaces are exempt from the accessibility bar that hand-built ones must meet

**Why it bites.** The `ui-ux-excellence` standard mandates WCAG 2.2 AA. Hand-built
screens can be audited once. **A surface the brain composes at runtime from a
model-chosen component list cannot** — it can emit an unlabelled icon-only button,
a 2.5:1-contrast metric tile, a form field with no associated label, a chart with
no text alternative, a drill-down with no keyboard path. There is **no
accessibility budget enforced at synthesis time**, so every generated surface is a
potential WCAG regression that no audit catches because the surface didn't exist
at audit time. For a Tanzanian workforce app used one-handed in a pit, and for
any tenant with disability-discrimination exposure, this is both a usability and a
legal gap.

**Code evidence.** Grep `wcag|contrast.ratio|axe-core|a11y.*audit` across
`packages/genui/src`, `portal-genui/src`, gateway: **zero hits.** Individual genui
components carry some `aria-` attributes, but there is **no judge that validates
the *composed* surface** for label coverage, contrast, focus order, or text
alternatives before it is proposed.

**Severity: MED-HIGH.** Invisible, compounding, and legally exposed; uniquely
unfixable by the usual "audit the screens" method because the screens are
generative.

**Buildable lane.** An **a11y term in the UI-judge** (the same judge as UU-2):
run `axe-core`-style rules over the proposed `layout_spec` (every interactive
node has an accessible name; computed contrast ≥ AA; charts ship a text
alternative; a keyboard path reaches every node) and **reject** non-conformant
surfaces. Make the genui catalog *a11y-correct by construction* so the model
*cannot* select an inaccessible primitive. This is "grounding + judge" (the
corpus's own hallucination fix) applied to accessibility.

---

## UU-5 · Permissions on **synthesized** entities/fields have no enforcement model

**Why it bites.** When the brain induces a new `entity_type_definition` or a new
`custom_fields` key (or pgroll-promotes it to a typed table), **who can read/write
it, and is that field PII / residency-classed?** The corpus celebrates
"role-lens compiled from RLS so a surface can't leak a column a role can't read"
(`vision-generative-surfaces.md` §4.4) — but that assumes the column's
*classification already exists*. A brain-minted field has **no row in
data-classification, no PII tag, no residency tag, no field-level ACL** — so it is
born **unclassified**: encryption/masking is a no-op on it (DP-04 already notes
the classification table is wrong-domain), and a synthesized surface's role-lens
can't gate a field whose sensitivity is unknown. The system can *create* a field
holding a national ID or assay grade and have **no governance metadata** attached
at birth.

**Code evidence.** `tenant_schema_extensions` (0306) stores field *type/storage
hint* but no PII/residency/ACL class; grep `field.level|column.acl|fieldPermission`
in `packages/database/src` finds only the generic encryption-port, not a
synthesized-field classifier. There is **no DDL-at-runtime / pgroll promotion code
at all** (grep `pgroll|dynamicDDL|alterTableAdd` → nothing), so a *promoted* type
would land as a raw table with **default RLS posture undefined**.

**Severity: HIGH.** A self-constructing data model that births ungoverned
PII-capable fields is a data-protection time-bomb — the offense (induction) has no
matching defense (classification) at the moment of creation.

**Buildable lane.** Make **classification a mandatory part of the schema
body-change proposal**: every induced field/type proposal must carry a
`pii_class`, `residency_class`, and `read/write role predicate`, *inferred by the
induction LLM and confirmed at the gate*, written atomically with the catalog
row. A promoted table inherits FORCE RLS + the `tenant_id` GUC policy *in the same
migration* (a pgroll template that is RLS-correct by construction). No field
exists without a classification — enforced by a check, not a convention.

---

## UU-6 · Disaster recovery of a **tenant-synthesized world** is unproven

**Why it bites.** The weekly backup-restore drill proves the *base* schema
restores. But a mature tenant's reality lives in **brain-authored data**:
`entity_type_definition` rows, `tenant_schema_extensions` rows, promoted tables,
persisted `portal_tabs`, the org-graph edges, the bi-temporal KG facts, the skill
registry, the surface-graph. **Nothing asserts that a restore reconstitutes a
*coherent* synthesized world** — that the promoted tables still match their
catalog rows, that persisted surfaces still bind to extant fields, that the KG's
bi-temporal validity is intact, that no synthesized organ is half-restored. A
point-in-time restore that brings back `core_entity` instances but a stale
catalog (or vice versa) yields a tenant whose *own data model is internally
inconsistent* — a failure class that does not exist in a fixed-schema product.

**Code evidence.** `.github/workflows/backup-restore-drill.yml` exists;
`migration-apply-fresh.yml` references `core_entity`. But grep shows **no restore
assertion over `entity_type_definition` / `tenant_schema_extensions` / promoted
tables / `portal_tabs` coherence** — the drill validates migrations apply, not
that a synthesized world round-trips coherently.

**Severity: HIGH.** The more autonomous the tenant's model, the more of its value
is in DR-untested synthesized state. Silent until the one restore that matters.

**Buildable lane.** Extend the drill with a **synthesized-world coherence
assertion**: after restore, run a consistency checker — every `core_entity`
references a live catalog type; every promoted table has a matching catalog row
and intact RLS; every persisted surface binds only to extant fields (via the
lens layer, UU-7); the KG bi-temporal chain has no orphaned invalidations. Treat
synthesized-state coherence as a first-class restore SLO.

---

## UU-7 · Schema-lens coherence is named for surfaces but missing for **persisted artifacts** (reports, decks, exports, mobile caches)

**Why it bites.** `vision-generative-surfaces.md` §3.2 brilliantly proposes
Cambria lenses so a live *surface* survives a column rename. But the same schema
drift silently breaks **every other persisted artifact that bound to the old
shape**: a generated PDF report's data-source query, a saved deck slide, a
scheduled email-template, a buyer's exported CSV mapping, and — critically — a
**mobile app's offline-cached surface** that was synced before the migration. The
lens layer is scoped to surfaces; nothing extends it to the long tail of
artifacts that also hold a frozen read-schema. The corpus solves coherence for
the one artifact it studied and leaves the others to break.

**Code evidence.** `report-engine/src/data-source.ts` and the genui document path
bind to field names directly; there is no lens indirection. No lens layer exists
anywhere yet (vision-code-audit §2 confirms "no Cambria-style lens layer"), so
this is doubly unbuilt — and even the *proposed* lens is surface-only.

**Severity: MED-HIGH.** A column rename that the surface lens absorbs still
breaks yesterday's report and every offline mobile cache — a confusing partial
failure that erodes trust in "reversible, coherent."

**Buildable lane.** Make the lens layer a **schema-binding service** that *every*
persisted-artifact reader goes through (surfaces, reports, decks, exports, mobile
sync), not just surfaces. Version the read-schema per artifact; on migration,
artifacts read live data *through the lens chain*; un-lensable destructive changes
trigger one proposal per affected artifact class, not just per surface.

---

## UU-8 · No legibility/observability layer for self-constructed schema + UI (you cannot debug what the brain built)

**Why it bites.** When a synthesized surface shows a wrong number, or an induced
type mis-routes 200 entities, or an org-redesign tanks throughput, **a human
operator (Borjie support, or the owner) has no way to inspect *why the brain built
it that way*.** The corpus has rich *audit* (hash-chained decisions) and rich
*eval* (the 8-axis harness) — but audit answers "what was decided," eval answers
"is the brain good on a benchmark," and **neither answers "why does *this tenant's*
synthesized organ look like this, and what evidence produced it?"** There is no
"provenance inspector" for the generated world — the very thing INV-A's
break-glass support flow would need, and the very thing that makes a generative
system trustable to the team operating it. (vision-generative-surfaces §4.7
mentions per-surface evidence panels for the *owner*; nobody specs the
*operator/debug* view, or provenance for induced *schema* and *org* changes.)

**Code evidence.** Provenance modules exist (`knowledge-graph/provenance/prov-o.ts`)
but are unwired (MEM-07), and there is no tooling that renders "this entity_type
was induced from evidence X,Y at confidence 0.8 on date D, has 412 instances,
feeds surfaces A,B." The eval harness (`evals/`) tests the brain globally, not a
*specific tenant's constructed state*.

**Severity: MED-HIGH.** A self-constructing system you cannot introspect per-tenant
is undebuggable in production — the support team is blind exactly where the product
is most novel.

**Buildable lane.** A **constructed-world inspector**: for any synthesized organ
(type, field, surface, edge, skill), render its provenance chain (evidence_ids,
confidence, inducing turn, approver), its blast-radius (what reads it), its
empirical fitness (adoption/error since creation), and its bi-temporal history.
Wire PROV-O (MEM-07) as the backing store. This is the eval/observability layer
*for self-constructed state*, distinct from the global brain eval.

---

## UU-9 · Conflicting autonomy postures across teams/scopes produce incoherent org behaviour

**Why it bites.** Autonomy is configured per-flow / per-tenant (the
`flow_autonomy_prefs` lane, ORCH-flowprefs). But a real estate has **many human
scopes** — owner, several managers, sites, subsidiaries — and **two managers can
set opposite postures on flows that interact.** Manager A sets royalty-filing to
AUTO; Manager B sets the *approval* that royalty-filing depends on to `gated`. Or
a site sets equipment-maintenance AUTO while the owner has the parent treasury
flow gated. The corpus models autonomy as a per-flow scalar and **never addresses
posture *composition* across an org hierarchy** — there is no rule for what
happens when interacting flows have contradictory postures, no "most-restrictive
wins" resolution, no detection that an AUTO flow is secretly blocked by a gated
dependency (deadlock) or that a gated flow is bypassed by an AUTO sibling
(leak around the gate).

**Code evidence.** `org-scope` gives per-user authority/delegation, and autonomy
is "keyed on tenant_id only; no flow_id row" today (ORCH-flowprefs). There is
**no posture-composition resolver** across the org hierarchy anywhere.

**Severity: MED-HIGH.** Silent autonomy contradictions either deadlock work or,
worse, route a consequential action around a gate the owner believed was closed —
a governance correctness failure, not a capability gap.

**Buildable lane.** A **posture-composition algebra**: postures lattice-order
(`gated` ⊐ `suggest` ⊐ `auto`), the *effective* posture of a flow is the
**most-restrictive over itself and its dependency closure** in the org-graph, and
the org-design loop **flags contradictions** (an AUTO flow whose dependency is
gated → surfaced as "this will stall"; a gated flow with an AUTO bypass sibling →
surfaced as a gate-leak). Money/licence/deletion floor stays `gated` regardless,
unconditionally.

---

## UU-10 · The brain can hallucinate org structure / schema, and the only defense is "evidence-required" — which evidence-poisoning defeats

**Why it bites.** The corpus's anti-hallucination answer is uniform: *evidence-
required, Auditor rejects empty chains.* But induction reads **tenant-controlled
evidence** — uploaded docs, chat, OCR'd PDFs. An attacker (or a confused user, or
a mis-OCR'd scan) can supply evidence that induces a **plausible-but-wrong org
structure or schema**: a fake "subsidiary," a phantom licence class, a mis-typed
field that re-homes real entities. "Evidence-required" only checks that *an*
evidence_id exists — **not that the evidence is trustworthy, consistent with the
rest of the model, or not adversarially planted.** SEC-G1's indirect-injection
detector guards *tool results*; nothing guards the **induction corpus** that
becomes the data model itself. Hallucinated *org structure* is more dangerous than
a hallucinated text answer because it persists, re-homes data, and silently
mis-routes future work.

**Code evidence.** `proposal-sink.ts` enforces *non-empty* evidence (L81-92) — a
presence check, not a trust check. The induction loop doesn't exist yet, so its
evidence-trust gate is unbuilt by definition. `agent-security-guard`
(indirect-injection detector) is wired into the *tool* path (task #17), not the
*ingestion/induction* path.

**Severity: HIGH.** Self-constructing the *data model* from untrusted evidence,
with only a presence-check gate, is the highest-leverage poisoning surface in the
product — and it is entirely unguarded for schema/org induction.

**Buildable lane.** An **induction-trust gate** distinct from presence-check:
(a) consistency check — a proposed type/edge must not contradict the SHACL-
governed seed backbone or existing high-confidence facts (KARMA-style auditor,
named in vision-dynamic-schema §1.1 but not as a *security* control); (b)
provenance-trust scoring — evidence from the platform corpus or signed sources
outranks unverified uploads; rare/single-source extractions are quarantined
(AutoSchemaKG frequency-filtering, reframed as a poisoning defense); (c) run the
indirect-injection detector over induction evidence, not just tool results; (d)
**simulate the re-homing** before commit (how many real entities would this new
type capture?) and surface it in the proposal. Schema induction is a security
boundary, not just a recall optimization.

---

## UU-11 · Rollback of a body-change is named "reversible" but the **data-migration tail** is not specified

**Why it bites.** "Reversible by construction" is the corpus's most-repeated
promise. For a *surface* retire, reversal is trivial (restore the prior
`layout_spec`). But for a **schema body-change that already wrote instance data**,
reversal is a *data migration*, not a config flip: if the brain promoted a JSONB
key to a typed column and 10,000 rows backfilled, "undo" must reverse the backfill
without losing edits made *after* promotion; if an induced type re-homed 412
entities, "undo" must re-home them back *and reconcile any work done on them under
the new type.* pgroll gives reversible *DDL*; it does **not** give reversible
*business semantics* once humans have acted on the new shape. The corpus treats
reversibility as uniform across surface/schema/org/skill — but the **schema and
org tails have a data-reconciliation problem the surface tail doesn't**, and
nobody specs it.

**Code evidence.** `mutation-authority/execution` + the EA-12/AUT-15 shadow→canary
→rollback substrate are surface/code-oriented; there is no data-backfill-reversal
or post-promotion-edit-reconciliation logic (and no pgroll integration yet at
all). "Undo" on a schema change is undefined once instances moved.

**Severity: HIGH.** A promised invariant (reversibility) that quietly does not
hold for the schema/org changes that matter most — discovered only at the first
attempted undo, in production, with real data.

**Buildable lane.** Define **reversal semantics per body-change class**:
surface/skill = restore prior version (trivial). Schema-additive = drop column +
catalog row (pgroll reverse). Schema-destructive / re-homing = a **compensating
data migration** that reverses the backfill *and* a reconciliation step for
post-change edits (conflict list surfaced to the owner, not auto-clobbered) —
expressed as a saga (EXEC-saga) so it is durable and itself compensatable. "Undo"
that touches instance data is a gated, previewable operation with its own blast-
radius, not a one-click flip.

---

## UU-12 · Synthesized surfaces and offline mobile are on a collision course (the pit/rural reality)

**Why it bites.** The product runs in **rural mining sites and field real-estate**
on intermittent 2G. The mobile apps have offline banners and optimistic-mutation
helpers — but **generative surfaces fundamentally assume connectivity** (the
server synthesizes the surface, streams the component list, and the proposal lives
server-side). What does a *synthesized* surface do offline? Can a worker even *see*
a brain-composed roster board with no signal? If they accept a proposal offline,
how does it reconcile (UU-3 concurrency) on reconnect against a surface the brain
may have re-synthesized server-side meanwhile? The corpus's offline thinking
(`mobile-onload-intelligence.md`) predates the generative-surface model and never
addresses **offline behaviour of dynamically-composed UI** — only of fixed
screens with cached data.

**Code evidence.** `apps/*/src/ui-litfin/LitFinOfflineBanner.tsx` +
`lib/optimistic-mutation.ts` exist for *fixed* flows; grep shows no
offline-cache or sync-reconcile path for `portal-genui` surfaces or proposals on
mobile. Generated surfaces are server-round-trip only.

**Severity: MED-HIGH.** The core user (pit worker, field agent) is exactly the
one most likely offline, and the flagship surface model has no offline story.

**Buildable lane.** A **degrade-gracefully contract for generative UI**: cache the
last-synthesized `layout_spec` + its data snapshot locally (the A2UI flat-list
format is cache-friendly by design); render read-only offline with a clear
"snapshot from HH:MM, offline" orientation marker (the stable-promise invariant,
§3.4); queue any offline proposal-accept as an *intent* that re-validates against
the live surface version on reconnect (compare-and-swap, UU-3), never blindly
applies. Never synthesize a *new* surface offline — only replay a cached one.

---

## UU-13 · Cost / runaway-loop governance exists for token spend but not for the **construction explosion**

**Why it bites.** Budget governors cap *LLM token* spend (EXEC-budget,
`llm-budget-governor`). But a self-constructing brain has a **different runaway
class the corpus never names: construction sprawl.** The induction loop can
propose hundreds of near-duplicate entity types across tenants; the surface-graph
synthesiser can spawn surfaces faster than anyone confirms them; the proactive
org-design loop can emit a redesign proposal every cycle; self-extension can draft
sub-MDs recursively. Each is individually gated, but **there is no global budget on
the *rate and total* of construction** — no cap on proposals-per-day, no
back-pressure when the approval queue grows unboundedly, no dedup across
simultaneously-induced types, no "the brain proposed 40 things nobody approved,
stop proposing." A proposal backlog that grows faster than humans clear it is its
own failure mode (the MoltBook "inert periphery" warning, applied to *proposals*
instead of agents).

**Code evidence.** `llm-budget-postgres-wiring.ts` caps tokens; grep
`maxMutationsPerDay` appears in the register (AUT-05, *unwired*) but there is no
*proposal-rate* or *construction-sprawl* governor anywhere, and no dedup across
in-flight induction proposals.

**Severity: MED.** Not catastrophic per-event (each is gated) but corrosive: an
unbounded, undeduplicated proposal stream destroys the "approve/undo, not a
backlog" promise and trains owners to reflexively dismiss — defeating the whole
proposal model.

**Buildable lane.** A **construction-budget governor** parallel to the token
governor: a per-tenant rate ceiling on proposals (with the conformal
interruption-budget, B5, as the *value* filter and this as the *volume* cap);
**dedup induced proposals** (an EDC `Define` pass before surfacing, so 40 tenants'
`mercury_retort_log` collapse to one cross-tenant proposal, B-vision §4.4); and
**approval-queue back-pressure** — when N proposals are pending, the brain stops
generating new ones and instead helps the owner clear the queue.

---

## UU-14 · The brain can never edit its own gate — but the **classifier that routes to the gate** is editable and unprotected

**Why it bites.** The load-bearing invariant is "the agent can grow capability but
can never touch its own gate/audit/test machinery (`inviolable.ts`)." True for the
*gate*. But the gate only fires if a request is *classified as consequential*, and
that classification is increasingly **brain-influenced**: the modality arbiter
decides ANSWER/SKILL/.../body-change; lens-router classifies persona; the
risk-tier scorer decides if four-eye applies; the induction loop decides if a
field is PII (UU-5). If the self-improvement loop (GEPA/AFlow, AUT-08) is allowed
to optimize the *prompts and routing of these classifiers*, the brain can — within
the rules — **make itself classify a money/licence/deletion action as low-risk and
route it around the gate it is forbidden to edit.** It never touches `inviolable.ts`;
it just learns to *not send things there.* The meta-rail protects the gate's code;
nothing protects the **classifier→gate routing decision** from being optimized
toward under-gating. This is the alignment-faking / reward-hacking surface the
corpus's safety probes (defection/SAE, nightly-only RSS-20) don't watch on the
*routing* layer.

**Code evidence.** `inviolable.ts` and `policy-gate.ts` are the protected gate.
But the modality arbiter, risk scorer, and lens router are ordinary brain
components, and AUT-08 explicitly proposes GEPA optimization "over juniors'
prompts" with "config swaps via body-change syscall" — **including the classifiers
that decide what reaches the gate.** No invariant pins the floor of the
*classification* (only the gate's reaction).

**Severity: HIGH.** The subtlest safety gap in the system: a self-improving brain
can satisfy "never edit the gate" while learning to starve it — a Goodhart attack
on its own routing, invisible to code-level meta-rail checks.

**Buildable lane.** Make **gate-routing monotone and unoptimizable downward**: the
risk classifier for HIGH-risk prefixes (money/licence/deletion) is part of the
inviolable floor — its mapping can be made *more* conservative by learning but
**never less**, enforced by a literal-rule shortcut (the existing "HIGH-risk
prefixes hit literal policy rules, no reason-resolver generalisation" rule
extended to the *classifier* itself). Add an **inline routing-integrity probe**:
on every AUTO/consequential action, an independent check (outside the optimizable
path) re-derives risk from the raw request and **fails closed** if the brain's
classification under-rates it vs the literal rule. Self-improvement may sharpen
recall, never lower the floor.

---

## 15. The pattern across all 14 — and the one lane that subsumes them

Twelve of the fourteen are the **same structural blind spot**: *the corpus's
inviolable invariants (EN/SW purity, evidence-trust, reversibility, RLS/permission,
accessibility, coherence, auditability) are specified for hand-built and text
artifacts and are NOT carried onto the artifacts the brain generates.* The vision
built a magnificent *construction engine* and a magnificent *defense moat* — but
**left the seam between them unsealed**: generated surfaces, induced schema, drawn
org-graphs, and synthesized tools enter the world **outside** the rails that govern
everything else.

The single highest-leverage lane is therefore not another capability — it is a
**Generated-Artifact Conformance Gate**: one judge in the synthesise→propose loop
that, for *every* brain-constructed organ (surface, type, field, edge, skill,
report), enforces the full invariant set before it can be proposed —
language-purity (UU-2), accessibility (UU-4), permission/PII classification
(UU-5), evidence-*trust* not just presence (UU-10), coherence/lens-binding (UU-7),
concurrency-safety (UU-3), reversal-semantics declaration (UU-11), and routing-
integrity (UU-14). This extends Borjie's existing Auditor-gate + evidence-required
discipline from *text answers* to *the constructed world itself* — closing the one
seam the entire corpus left open, and the one that decides whether a self-
constructing organizational brain is trustworthy in the field or a beautiful,
unsafe demo.

**The two that aren't conformance** (UU-1 cold-start, UU-6 DR, UU-9 posture
composition, UU-13 construction-budget) are the **operational-lifecycle** blind
spots — the corpus described a system that *runs at steady state with infinite
attention and connectivity*, and never the day-0, the restore, the org with
conflicting humans, or the day the proposal queue overflows. Both clusters are
domain-agnostic and therefore **shared Borjie ⇄ BossNyumba substrate** — the
unknown-unknowns are, like everything else, build-once / mirror-twice.
