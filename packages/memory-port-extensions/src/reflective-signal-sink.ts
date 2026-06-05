/**
 * Reflective-store signal sink (LP-05).
 *
 * Wires the orphaned `@borjie/memory-v2` reflective store as a fan-out SINK
 * of `@borjie/learning-signal-emitter`. When the emitter routes a signal to
 * the `reflexion-lessons` slot, this adapter turns the signal into a
 * Reflexion-style note and upserts it into the reflective store.
 *
 * The adapter is structurally typed against MINIMAL port shapes it declares
 * itself, so this package needs no new workspace dependency: the kernel
 * composition root passes the real `LearningSignal` from the emitter and the
 * real `ReflectiveStore` from memory-v2, both of which satisfy these shapes.
 *
 * Reflexion reference: Shinn et al. 2023, arXiv 2303.11366 — turn a
 * (trajectory, outcome) into a natural-language self-reflection that
 * conditions the next attempt.
 *
 * PURE note construction (`buildReflectiveNoteFromSignal`) + a thin
 * best-effort I/O wrapper (`createReflectiveSignalSink`). The sink never
 * throws — a store failure is swallowed + reported via the boolean return so
 * the emitter's fan-out loop keeps going.
 */

// ─────────────────────────────────────────────────────────────────────
// Minimal structural ports (satisfied by the real emitter + memory-v2)
// ─────────────────────────────────────────────────────────────────────

/** Subset of `LearningSignal` (from @borjie/learning-signal-emitter). */
export interface SignalLike {
  readonly signalHash: string;
  readonly actionRef: string;
  readonly actionKind: string;
  readonly reward: number;
  readonly components: {
    readonly sla: number;
    readonly override: number;
    readonly complaint: number;
    readonly regulator: number;
    readonly cost: number;
    readonly satisfaction: number;
  };
  readonly tenantScope: 'user' | 'org' | 'platform';
  readonly subjectUserId?: string | null;
  readonly subjectOrgId?: string | null;
  readonly capturedAt: string;
}

/** Subset of `ReflectiveNote` (from @borjie/memory-v2). */
export interface ReflectiveNoteLike {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string | null;
  readonly insight: string;
  readonly adjustments: ReadonlyArray<string>;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly selfScore: number;
  readonly createdAt: string;
}

/** Subset of memory-v2's `ReflectiveStore` port (just the write path). */
export interface ReflectiveStoreLike {
  upsertNote(note: ReflectiveNoteLike): Promise<ReflectiveNoteLike>;
}

export interface ReflectiveSinkDeps {
  readonly store: ReflectiveStoreLike;
  readonly idFactory: () => string;
  readonly now?: () => string;
  /**
   * Tenant id to stamp on the note when the signal is platform-scoped (the
   * signal carries no org id then). Defaults to 'platform'.
   */
  readonly platformTenantId?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Pure note construction
// ─────────────────────────────────────────────────────────────────────

/** Component → human label, for the insight + adjustments text. */
const COMPONENT_LABELS: Record<keyof SignalLike['components'], string> = {
  sla: 'SLA timeliness',
  override: 'manager override',
  complaint: 'owner complaint',
  regulator: 'regulator finding',
  cost: 'cost vs budget',
  satisfaction: 'explicit satisfaction',
};

/**
 * Map a reward in [-1, 1] to a self-score in [0, 1]. A reward of 0 maps to
 * 0.5 (neutral); +1 → 1; -1 → 0.
 */
function rewardToSelfScore(reward: number): number {
  const clamped = Math.max(-1, Math.min(1, Number.isFinite(reward) ? reward : 0));
  return (clamped + 1) / 2;
}

/** The most-negative components are the ones worth reflecting on. */
function negativeDrivers(
  components: SignalLike['components'],
): ReadonlyArray<{ readonly label: string; readonly value: number }> {
  return (Object.keys(components) as Array<keyof SignalLike['components']>)
    .map((k) => ({ label: COMPONENT_LABELS[k], value: components[k] }))
    .filter((c) => c.value < 0)
    .sort((a, b) => a.value - b.value);
}

/**
 * Build a Reflexion-style note from a learning signal. PURE — the period is
 * a zero-width window at the signal's capture time (one signal = one moment
 * of reflection). The note records what drove the reward + concrete
 * adjustments derived from the negative drivers.
 */
export function buildReflectiveNoteFromSignal(
  signal: SignalLike,
  deps: ReflectiveSinkDeps,
): ReflectiveNoteLike {
  const nowIso = (deps.now ?? (() => new Date().toISOString()))();
  const drivers = negativeDrivers(signal.components);
  const verdict =
    signal.reward >= 0.5
      ? 'a strong positive outcome'
      : signal.reward < 0
        ? 'a negative outcome'
        : 'a mixed / neutral outcome';

  const insight =
    drivers.length === 0
      ? `Action '${signal.actionKind}' (${signal.actionRef}) produced ${verdict} (reward ${signal.reward.toFixed(2)}); no component dragged the score down.`
      : `Action '${signal.actionKind}' (${signal.actionRef}) produced ${verdict} (reward ${signal.reward.toFixed(2)}). Drag came from: ${drivers
          .map((d) => `${d.label} (${d.value.toFixed(2)})`)
          .join(', ')}.`;

  const adjustments = drivers.map((d) =>
    adjustmentFor(d.label, signal.actionKind),
  );
  if (adjustments.length === 0) {
    adjustments.push(
      `Reinforce the current approach for '${signal.actionKind}' — it scored well.`,
    );
  }

  return {
    id: deps.idFactory(),
    tenantId: signal.subjectOrgId ?? deps.platformTenantId ?? 'platform',
    userId: signal.subjectUserId ?? null,
    insight,
    adjustments,
    periodStart: signal.capturedAt,
    periodEnd: signal.capturedAt,
    selfScore: rewardToSelfScore(signal.reward),
    createdAt: nowIso,
  };
}

function adjustmentFor(label: string, actionKind: string): string {
  switch (label) {
    case 'SLA timeliness':
      return `Tighten turnaround on '${actionKind}' — the SLA window slipped.`;
    case 'manager override':
      return `Surface the decision rationale earlier on '${actionKind}' so a manager need not override.`;
    case 'owner complaint':
      return `Add an owner-facing explanation step to '${actionKind}' to pre-empt complaints.`;
    case 'regulator finding':
      return `Re-check the regulatory constraints bound to '${actionKind}' before acting.`;
    case 'cost vs budget':
      return `Cost ran over budget on '${actionKind}' — prefer the cheaper path next time.`;
    case 'explicit satisfaction':
      return `Satisfaction was low on '${actionKind}' — solicit and act on feedback.`;
    default:
      return `Review '${actionKind}' — ${label} dragged the outcome down.`;
  }
}

// ─────────────────────────────────────────────────────────────────────
// I/O sink (best-effort)
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a `reflexionRecord` sink for the signal-emitter. Returns a function
 * matching the emitter's `(signal) => Promise<boolean>` adapter contract:
 * `true` when the note was written, `false` on a store failure. Never throws.
 *
 * Wire it at the kernel composition root:
 *
 *   const reflexionRecord = createReflectiveSignalSink({
 *     store: memoryV2.stores.reflective,
 *     idFactory: () => crypto.randomUUID(),
 *   });
 *   await emitSignal({ action, outcome, sinks: { reflexionRecord } });
 */
export function createReflectiveSignalSink(
  deps: ReflectiveSinkDeps,
): (signal: SignalLike) => Promise<boolean> {
  return async (signal: SignalLike): Promise<boolean> => {
    try {
      const note = buildReflectiveNoteFromSignal(signal, deps);
      await deps.store.upsertNote(note);
      return true;
    } catch {
      // Best-effort: the emitter absorbs a `false` into its notes without
      // crashing the calling action.
      return false;
    }
  };
}
