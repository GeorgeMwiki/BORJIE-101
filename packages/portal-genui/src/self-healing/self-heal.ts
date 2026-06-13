/**
 * Self-healing kernel — a bounded, honest MAPE-K loop for UI/wiring blockers.
 *
 * MAPE-K (Monitor → Analyze → Plan → Execute over Knowledge) is the autonomic-
 * computing reference for self-adaptive systems (IBM, 2003). This is that loop,
 * scoped to the generative-UI flow and held to four honest limits learned the
 * hard way:
 *
 *   1. AUTO-REPAIR ONLY THE BOUNDED SAFE CLASS. A blocker that can be served by
 *      an existing DECLARATIVE move — degrade to the honest fallback, re-bind to
 *      the generic resolver — is auto-repaired. Everything else escalates.
 *   2. NEVER AUTO-REWRITE CODE. A blocker that needs a code/wiring change
 *      (a missing renderer, an unwired rule, a dead export) is turned into a
 *      structured, human-gated `RepairProposal` (`autoApplicable: false`). The
 *      system does not edit its own source autonomously — that line is not
 *      crossed.
 *   3. NEVER SILENT. Every blocker yields an outcome — auto-repaired or
 *      escalated — and an unrecognised one is MADE KNOWN as `novel`, not
 *      swallowed (the residual doctrine: instrument what you cannot enumerate).
 *   4. ALWAYS PROCEED. The outcome's `proceed` is always true: the user keeps
 *      being served (via degrade / deferToBrain) WHILE the repair or escalation
 *      happens. Self-healing never blocks the flow it is healing.
 *
 * The healer is itself TOTAL: it never throws, even on a malformed signal or a
 * failing sink — a self-healer that can crash is a contradiction.
 *
 * @module @borjie/portal-genui/self-healing/self-heal
 */

// ---------------------------------------------------------------------------
// MONITOR — the recognised blocker.
// ---------------------------------------------------------------------------

/**
 * The closed set of UI/wiring blocker kinds the loop recognises. A kind outside
 * this set is still handled — classified `novel` and escalated — so the closed
 * set bounds what is AUTO-repairable, never what is detectable.
 */
export type BlockerKind =
  | 'unknown-render-kind' // a spec kind with no registered renderer
  | 'unmapped-binding' // a widget bound to an unknown resource/tool
  | 'admission-violation' // a tab rejected by the admission chokepoint
  | 'render-error' // a renderer threw at runtime
  | 'unwired-rule' // a registered rule not reached on the production path
  | 'dead-export' // an exported capability with zero callers
  | 'corrupt-spec'; // a persisted spec that no longer loads (unmigratable/invalid)

export interface BlockerSignal {
  /** What kind of blocker (may be an unrecognised string → classified novel). */
  readonly kind: BlockerKind;
  /** Where — a path, kind id, or file:line. */
  readonly locus: string;
  /** Human-readable detail for the proposal / telemetry. */
  readonly detail?: string;
  /** Tenant scope, when the blocker is tenant-specific. */
  readonly tenantId?: string;
}

// ---------------------------------------------------------------------------
// ANALYZE — the repair class (a known class, or `novel`).
// ---------------------------------------------------------------------------

export type RepairClass =
  | 'reroute-degrade' // serve via honest fallback / deferToBrain (auto, safe)
  | 'rebind-generic' // re-point a binding to the generic resolver (auto, safe)
  | 'escalate-code' // needs a code/wiring change → human-gated proposal
  | 'escalate-novel'; // unrecognised → human-gated, flagged novel

/** Blocker kinds that are SAFELY auto-repairable by a declarative move. */
const AUTO_REPAIRABLE: Partial<Record<BlockerKind, RepairClass>> = {
  'unknown-render-kind': 'reroute-degrade',
  'unmapped-binding': 'rebind-generic',
  'admission-violation': 'reroute-degrade',
};

/** Blocker kinds that need a CODE/wiring change — never auto-applied. */
const CODE_GATED: ReadonlySet<BlockerKind> = new Set<BlockerKind>([
  'render-error',
  'unwired-rule',
  'dead-export',
  'corrupt-spec',
]);

/**
 * Make the unknown known: map a signal to its repair class. An unrecognised
 * kind is `escalate-novel` (recognised-as-unknown), never dropped.
 */
export function classifyBlocker(signal: BlockerSignal): RepairClass {
  const kind = signal?.kind;
  const auto = kind ? AUTO_REPAIRABLE[kind] : undefined;
  if (auto) return auto;
  if (kind && CODE_GATED.has(kind)) return 'escalate-code';
  return 'escalate-novel';
}

// ---------------------------------------------------------------------------
// PLAN / EXECUTE — the outcome.
// ---------------------------------------------------------------------------

export interface RepairProposal {
  readonly title: string;
  readonly locus: string;
  readonly suggestedFix: string;
  /**
   * WHY this blocker happened + its blast radius, for the INTERNAL-ADMIN
   * triaging it (never shown to the owner). One honest sentence.
   */
  readonly insight: string;
  /** Ordered, human-actionable steps to resolve it. */
  readonly actionPlan: ReadonlyArray<string>;
  /** Code repairs are NEVER auto-applied — this is structurally always false. */
  readonly autoApplicable: false;
}

export interface RepairOutcome {
  readonly status: 'auto-repaired' | 'escalated';
  readonly class: RepairClass;
  /** What the loop actually did. */
  readonly action: string;
  /** The flow ALWAYS proceeds — the user keeps being served. */
  readonly proceed: true;
  /**
   * The structured record for this blocker. On `escalated` it is the
   * human-gated repair proposal that needs approve/deny; on `auto-repaired` it
   * is the same shape carried as an OBSERVATION (the customer was already
   * served — recurrence is the crystallization signal). Always present so the
   * admin console has full visibility either way.
   */
  readonly proposal: RepairProposal;
}

export interface HealDeps {
  /** Knowledge: bank a successful auto-repair so the blocker does not recur. */
  readonly remember?: (signal: BlockerSignal, cls: RepairClass) => void;
  /** Escalate: surface a structured proposal to humans (ticket / telemetry). */
  readonly escalate?: (proposal: RepairProposal, signal: BlockerSignal) => void;
  /**
   * Report EVERY outcome (auto-repaired OR escalated) to a platform sink — the
   * INTERNAL-ADMIN self-healing console + telemetry, never the owner. Unlike
   * `escalate` (the human-gated subset), this fires on every heal so the admin
   * has full visibility: needs-approval proposals AND auto-healed observations
   * (the crystallization-candidate signal).
   */
  readonly report?: (outcome: RepairOutcome, signal: BlockerSignal) => void;
}

/** A leak-safe, kind-specific fix hint for the human-gated proposal. */
function suggestFix(signal: BlockerSignal): string {
  switch (signal?.kind) {
    case 'render-error':
      return `wrap the renderer for '${signal.locus}' in a per-section error boundary and add the missing case`;
    case 'unwired-rule':
      return `thread the rule into the composition root so it is reached on the production persist path (not only the registry)`;
    case 'dead-export':
      return `wire the exported capability at '${signal.locus}' into a real caller, or remove it`;
    case 'corrupt-spec':
      return `inspect the persisted spec at '${signal.locus}' — it no longer migrates/validates; back-fill or write a migration, the row is skipped meanwhile`;
    default:
      return `unrecognised blocker at '${signal?.locus ?? 'unknown'}' — investigate and add a recognised kind + repair strategy`;
  }
}

/**
 * WHY it happened + blast radius, written for the internal-admin triaging it
 * (never the owner). Honest, no model CoT leaked — only the structural fact.
 */
function deriveInsight(signal: BlockerSignal): string {
  switch (signal?.kind) {
    case 'unknown-render-kind':
      return `The brain emitted a render kind with no first-class renderer; the open-grammar renderer degraded it to an honest fallback card, so the customer was served. Recurrence is the signal to crystallize a real renderer for this kind.`;
    case 'unmapped-binding':
      return `A widget bound to a resource/tool with no table/port mapping; it degraded to honest empty rows. If the resource is known, a developer added the enum but not the binding — a latent wiring gap, not a customer-facing outage.`;
    case 'admission-violation':
      return `A tab failed the admission chokepoint (a closed-law violation) and was rerouted to the safe fallback rather than rendered. The customer was served; the spec SOURCE (generator/prompt) needs correction.`;
    case 'render-error':
      return `A renderer threw at runtime — a code defect in that section. The section degraded, but the renderer must be fixed and guarded by a per-section error boundary.`;
    case 'unwired-rule':
      return `A registered rule is not reached on the production persist path — it exists in the registry but the composition root never threads it. The law is dark until wired.`;
    case 'dead-export':
      return `An exported capability has zero callers — born-dark. Wire it into a real caller or remove it; until then it is latent risk, not a working feature.`;
    case 'corrupt-spec':
      return `A persisted spec no longer migrates/validates; the read skipped the row so the rest of the view still served. The stored data is corrupt and must be back-filled or migrated — never auto-rewritten.`;
    default:
      return `An unrecognised blocker was made known rather than swallowed (residual doctrine). The customer was served degraded; a recognised kind + repair strategy must be added.`;
  }
}

/** Ordered, human-actionable steps for the internal-admin console. */
function deriveActionPlan(signal: BlockerSignal): ReadonlyArray<string> {
  const where = signal?.locus ?? 'unknown';
  switch (signal?.kind) {
    case 'unknown-render-kind':
      return [
        `Inspect the degraded kind at '${where}' and how often it recurs.`,
        `If recurring/valuable, add a first-class renderer + zod schema (open-contract widen, closed-law gate).`,
        `Register it in the projector catalog + a generativity test; ship.`,
      ];
    case 'unmapped-binding':
      return [
        `Confirm '${where}' is a real resource (not a typo) intended to render data.`,
        `Add its table mapping in widget-data-resolver RESOURCE_TABLE — or add it to INTENTIONALLY_UNMAPPED_RESOURCES if it is empty-by-design.`,
        `Add a resolver test asserting non-empty rows; ship.`,
      ];
    case 'admission-violation':
      return [
        `Read the admission rule that rejected '${where}'.`,
        `Fix the spec SOURCE (the brain prompt / generator) so it stops emitting the violating shape.`,
        `Keep the chokepoint as-is — it correctly protected the customer.`,
      ];
    case 'render-error':
      return [
        `Reproduce the throw at '${where}'.`,
        `Add the missing case + wrap the renderer in a per-section error boundary.`,
        `Add a regression test for the throwing payload; ship.`,
      ];
    case 'unwired-rule':
      return [
        `Thread the rule at '${where}' into the composition root on the production persist path.`,
        `Add a reachability test proving it fires on the live path (not just the registry).`,
      ];
    case 'dead-export':
      return [
        `Decide: wire the export at '${where}' into a real caller, or delete it.`,
        `If wiring, add a test exercising the caller path; if deleting, run knip to confirm no hidden users.`,
      ];
    case 'corrupt-spec':
      return [
        `Inspect the persisted spec at '${where}' — it no longer migrates/validates.`,
        `Back-fill the row or write a forward migration; never edit a shipped migration.`,
        `The read already skips it, so there is no customer-facing outage to rush.`,
      ];
    default:
      return [
        `Investigate the unrecognised blocker at '${where}'.`,
        `Add a recognised BlockerKind + repair strategy so the next occurrence is classified.`,
      ];
  }
}

/** Build the structured proposal/observation record for a classified blocker. */
function buildProposal(signal: BlockerSignal, cls: RepairClass): RepairProposal {
  return {
    title: `${cls === 'escalate-novel' ? 'NOVEL ' : ''}blocker: ${String(signal?.kind ?? 'unknown')}`,
    locus: signal?.locus ?? 'unknown',
    suggestedFix: suggestFix(signal),
    insight: deriveInsight(signal),
    actionPlan: deriveActionPlan(signal),
    autoApplicable: false,
  };
}

/** Run a sink without letting it break the loop (the healer stays total). */
function safely(fn?: () => void): void {
  if (!fn) return;
  try {
    fn();
  } catch {
    /* a failing knowledge/escalation sink must never break self-healing */
  }
}

/**
 * Run the MAPE-K loop for one blocker. NEVER throws; ALWAYS returns an outcome
 * whose `proceed` is true so the caller keeps serving the user. Auto-repairs the
 * bounded safe class (and crystallizes it); escalates the code/novel class as a
 * non-auto-applicable, human-gated proposal.
 */
export function attemptHeal(
  signal: BlockerSignal,
  deps: HealDeps = {},
): RepairOutcome {
  const cls = classifyBlocker(signal);
  const proposal = buildProposal(signal, cls);

  if (cls === 'reroute-degrade' || cls === 'rebind-generic') {
    safely(() => deps.remember?.(signal, cls)); // Knowledge: crystallize
    const outcome: RepairOutcome = {
      status: 'auto-repaired',
      class: cls,
      proceed: true,
      action:
        cls === 'reroute-degrade'
          ? `served via honest fallback for '${signal?.kind}' at ${signal?.locus ?? 'unknown'}`
          : `re-bound '${signal?.locus ?? 'unknown'}' to the generic resolver`,
      proposal,
    };
    // Report the auto-healed OBSERVATION (full admin visibility; no approval).
    safely(() => deps.report?.(outcome, signal));
    return outcome;
  }

  // Escalation: human-gated. Notify both the escalate subset (back-compat) and
  // the unified report sink.
  safely(() => deps.escalate?.(proposal, signal));
  const outcome: RepairOutcome = {
    status: 'escalated',
    class: cls,
    action: 'filed human-gated repair proposal; user served degraded',
    proceed: true,
    proposal,
  };
  safely(() => deps.report?.(outcome, signal));
  return outcome;
}
