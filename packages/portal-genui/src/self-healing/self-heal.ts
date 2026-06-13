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
  /** Present on escalation — the human-gated repair proposal. */
  readonly proposal?: RepairProposal;
}

export interface HealDeps {
  /** Knowledge: bank a successful auto-repair so the blocker does not recur. */
  readonly remember?: (signal: BlockerSignal, cls: RepairClass) => void;
  /** Escalate: surface a structured proposal to humans (ticket / telemetry). */
  readonly escalate?: (proposal: RepairProposal, signal: BlockerSignal) => void;
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

  if (cls === 'reroute-degrade' || cls === 'rebind-generic') {
    safely(() => deps.remember?.(signal, cls)); // Knowledge: crystallize
    return {
      status: 'auto-repaired',
      class: cls,
      proceed: true,
      action:
        cls === 'reroute-degrade'
          ? `served via honest fallback for '${signal?.kind}' at ${signal?.locus ?? 'unknown'}`
          : `re-bound '${signal?.locus ?? 'unknown'}' to the generic resolver`,
    };
  }

  const proposal: RepairProposal = {
    title: `${cls === 'escalate-novel' ? 'NOVEL ' : ''}blocker: ${String(signal?.kind ?? 'unknown')}`,
    locus: signal?.locus ?? 'unknown',
    suggestedFix: suggestFix(signal),
    autoApplicable: false,
  };
  safely(() => deps.escalate?.(proposal, signal));
  return {
    status: 'escalated',
    class: cls,
    action: 'filed human-gated repair proposal; user served degraded',
    proceed: true,
    proposal,
  };
}
