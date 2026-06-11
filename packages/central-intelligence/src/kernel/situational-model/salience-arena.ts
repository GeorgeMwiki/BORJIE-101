/**
 * Salience Arena — a single Global-Workspace broadcast that shapes the
 * WHOLE turn (persona voice + the prompt's "live concern" segment)
 * BEFORE anything else runs.
 *
 * The MD holds many competing concerns at once: standing drives (cash,
 * licence, safety, …), proactive detectors (P0/P1/P2), overdue
 * commitments, the raw ACT-R activation of the most-referenced estate
 * entity, and — once affect is wired — owner frustration / dwell. Today
 * these never COMPETE on one comparable scale; persona selection is
 * salience-blind. This module gives every source class a normaliser onto
 * one `[0,1]` bid, then runs a deterministic winner-take-most arena: the
 * single highest bid becomes the turn's `Focus`. That focus bends the
 * persona (cash → finance voice, licence/royalty → risk-compliance,
 * safety → operations) AND seeds the system-prompt's live-concern line,
 * so the answer bends around the most-salient estate fact even when the
 * user asked something tangential.
 *
 * DESIGN INVARIANTS (CLAUDE.md + coding-style):
 *   - PURE. No I/O, no clock except the caller-supplied `nowMs`; same
 *     bids → same Focus. Deterministic tie-break (bid desc, then a fixed
 *     source-class precedence, then bid `id` asc) so two replicas agree.
 *   - GOVERNED. The arena only re-weights ATTENTION (voice + prompt
 *     focus). It NEVER acts, never bypasses the autonomy / four-eye
 *     gate; the downstream PROPOSE/ACT path stays untouched.
 *   - ADDITIVE + total. Empty bids → `focus = null` (no behaviour
 *     change). Degenerate inputs (NaN, ±Infinity) clamp to a finite
 *     bid; a bid never poisons the ranking.
 *
 * The ACT-R activation term reuses `situational-model/activation.ts`
 * min-maxed across the snapshot, so the arena composes with — rather
 * than duplicates — the existing salience maths. The snapshot itself is
 * never mutated.
 */

import type { ActivatedEntity, SituationalSnapshot } from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Source classes + the comparable bid
// ─────────────────────────────────────────────────────────────────────

/**
 * The kinds of signal that compete for the single spotlight. Precedence
 * (used ONLY to break exact-bid ties deterministically) runs in declared
 * order: a `drive` beats a `detector` beats a `commitment` … on a tie.
 * `affect` sits FIRST so a genuine frustration bid that ties a concern
 * wins the spotlight (the owner's state pre-empts the estate fact when
 * they're equally loud) — see the affect-bidder win.
 */
export const SALIENCE_SOURCE_CLASSES = [
  'affect',
  'drive',
  'detector',
  'commitment',
  'activation',
] as const;

export type SalienceSourceClass = (typeof SALIENCE_SOURCE_CLASSES)[number];

/** The concern domains a focus can map onto (drives a VP voice swap). */
export type FocusDomain =
  | 'cash'
  | 'compliance'
  | 'safety'
  | 'counterparty'
  | 'equipment'
  | 'affect'
  | 'general';

/** One normalised, comparable competitor in the arena. */
export interface SalienceBid {
  /** Stable id (e.g. `drive:cash-runway`, `detector:cashflow-dip`). */
  readonly id: string;
  readonly sourceClass: SalienceSourceClass;
  /** Comparable competition strength in `[0,1]`. */
  readonly bid: number;
  /** Concern domain — used to bend the persona + the prompt focus. */
  readonly domain: FocusDomain;
  /** One-line, locale-free label for the prompt's live-concern segment. */
  readonly label: string;
}

/** The arena winner — exactly one, or null when no one bid. */
export interface Focus {
  readonly winner: SalienceBid;
  /** All bids, highest-first, for telemetry / trace. */
  readonly ranked: ReadonlyArray<SalienceBid>;
}

// ─────────────────────────────────────────────────────────────────────
// Normalisers — each source class → a `[0,1]` bid
// ─────────────────────────────────────────────────────────────────────

/** Clamp any number into `[0,1]`; non-finite → 0 (never poisons ranking). */
export function clampBid(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Detector severity band → bid. P0 (most severe) is loudest. Unknown /
 * absent band → a low floor so a detector never silently dominates.
 */
export function bidForDetectorSeverity(band: 'P0' | 'P1' | 'P2' | string): number {
  switch (band) {
    case 'P0':
      return 1.0;
    case 'P1':
      return 0.66;
    case 'P2':
      return 0.33;
    default:
      return 0.2;
  }
}

/**
 * Overdue commitment → bid. `urgency ∈ [0,1]` scaled by how far past due
 * it is (1 day overdue ≈ urgency; capped). A still-pending (not overdue)
 * commitment bids 0.
 */
export function bidForOverdueCommitment(args: {
  readonly urgency: number;
  readonly daysOverdue: number;
}): number {
  if (args.daysOverdue <= 0) return 0;
  // Saturate at ~1 week overdue so a very stale item can't swamp a live
  // P0 detector forever; the urgency term keeps high-urgency items loud.
  const overdueFactor = Math.min(1, args.daysOverdue / 7);
  return clampBid(clampBid(args.urgency) * (0.5 + 0.5 * overdueFactor));
}

/**
 * Map a situational-model entity KIND to a focus domain. The arena uses
 * this for the ACT-R activation bidder + to label drive bids.
 */
export function domainForEntityKind(kind: string): FocusDomain {
  switch (kind) {
    case 'cash':
      return 'cash';
    case 'licence':
    case 'arrears':
      return 'compliance';
    case 'counterparty':
      return 'counterparty';
    case 'equipment':
      return 'equipment';
    case 'site':
      return 'safety';
    default:
      return 'general';
  }
}

/**
 * Map a standing-drive id to a focus domain.
 */
export function domainForDriveId(driveId: string): FocusDomain {
  switch (driveId) {
    case 'cash-runway':
      return 'cash';
    case 'licence-currency':
    case 'royalty-currency':
      return 'compliance';
    case 'safety':
      return 'safety';
    case 'offtake-coverage':
      return 'counterparty';
    case 'equipment-health':
      return 'equipment';
    default:
      return 'general';
  }
}

/**
 * Build ACT-R activation bids by min-maxing the snapshot's per-entity
 * activation onto `[0,1]`. The most-activated entity bids highest; a
 * single-entity snapshot bids the floor (no spread to normalise). Reuses
 * the activation already computed by `activateAll(...)` — the snapshot is
 * read-only and never mutated.
 */
export function activationBids(
  snapshot: SituationalSnapshot | null | undefined,
  options: { readonly floor?: number; readonly ceiling?: number } = {},
): ReadonlyArray<SalienceBid> {
  if (!snapshot || snapshot.entities.length === 0) return [];
  const floor = options.floor ?? 0.0;
  const ceiling = options.ceiling ?? 0.5; // activation never out-bids a P0 alone
  const acts = snapshot.entities.map((e) => e.activation);
  const min = Math.min(...acts);
  const max = Math.max(...acts);
  const span = max - min;
  return snapshot.entities.map((e: ActivatedEntity) => {
    const scaled =
      span > 0 ? (e.activation - min) / span : 0.5; // single value → mid
    const bid = clampBid(floor + scaled * (ceiling - floor));
    return Object.freeze({
      id: `activation:${e.entity.kind}:${e.entity.entityId}`,
      sourceClass: 'activation' as const,
      bid,
      domain: domainForEntityKind(e.entity.kind),
      label: e.entity.label || `${e.entity.kind} ${e.entity.entityId}`,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// The arena — winner-take-most, deterministic
// ─────────────────────────────────────────────────────────────────────

const CLASS_PRECEDENCE: ReadonlyMap<SalienceSourceClass, number> = new Map(
  SALIENCE_SOURCE_CLASSES.map(
    (c, i): readonly [SalienceSourceClass, number] => [c, i],
  ),
);

/**
 * Run the arena over a heterogeneous bid set. Returns the single highest
 * bid as the turn's Focus, or null when no one bid. Deterministic
 * tie-break: bid desc → source-class precedence asc → bid id asc.
 *
 * Pure: same bids → same Focus. The returned `ranked` array is frozen.
 */
export function arena(
  bids: ReadonlyArray<SalienceBid>,
): Focus | null {
  // Defensive: clamp every bid so a degenerate input can't poison the
  // ranking, and drop empty-id entries. Immutable — we build NEW frozen
  // bids rather than mutate the caller's.
  const cleaned: SalienceBid[] = [];
  for (const b of bids) {
    if (!b || typeof b.id !== 'string' || b.id.length === 0) continue;
    cleaned.push(
      Object.freeze({ ...b, bid: clampBid(b.bid) }),
    );
  }
  if (cleaned.length === 0) return null;

  const ranked = [...cleaned].sort(compareBids);
  return Object.freeze({
    winner: ranked[0]!,
    ranked: Object.freeze(ranked),
  });
}

function compareBids(a: SalienceBid, b: SalienceBid): number {
  if (b.bid !== a.bid) return b.bid - a.bid;
  const pa = CLASS_PRECEDENCE.get(a.sourceClass) ?? Number.MAX_SAFE_INTEGER;
  const pb = CLASS_PRECEDENCE.get(b.sourceClass) ?? Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa - pb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ─────────────────────────────────────────────────────────────────────
// Focus → persona + prompt steering
// ─────────────────────────────────────────────────────────────────────

/**
 * The VP "voice" a focus domain bends the persona toward. These are
 * advisory labels the kernel threads into persona selection + the system
 * prompt; they NEVER change the persona's id / taboos / accountability
 * scope (those stay surface-default for audit + drift detection).
 */
export type VpVoice =
  | 'vp.finance'
  | 'vp.risk-compliance'
  | 'vp.operations'
  | 'vp.commercial'
  | 'vp.assets'
  | null;

export function vpVoiceForDomain(domain: FocusDomain): VpVoice {
  switch (domain) {
    case 'cash':
      return 'vp.finance';
    case 'compliance':
      return 'vp.risk-compliance';
    case 'safety':
      return 'vp.operations';
    case 'counterparty':
      return 'vp.commercial';
    case 'equipment':
      return 'vp.assets';
    case 'affect':
    case 'general':
    default:
      return null;
  }
}

/**
 * Render the single live-concern segment the kernel mixes into the
 * system prompt when a focus won the arena. Locale-free, terse, and
 * framed as an attention hint — NOT an instruction to act. Empty string
 * when no focus (so the prompt slot collapses cleanly).
 *
 * For an affect focus we deliberately soften toward acknowledgement and
 * suppress the "lead with this concern" framing — the owner's state, not
 * an estate fact, owns the spotlight this turn.
 */
export function renderFocusDirective(focus: Focus | null): string {
  if (!focus) return '';
  const w = focus.winner;
  if (w.domain === 'affect') {
    return [
      `Live concern: the owner may be ${w.label}.`,
      `Acknowledge it first, keep this turn concrete and brief, and hold any`,
      `unrelated proactive nudges for later. Do not pile on.`,
    ].join(' ');
  }
  return [
    `Live concern: ${w.label}.`,
    `Even if the question is about something else, surface this where it`,
    `naturally fits — lead with the user's actual ask, then flag this as the`,
    `one estate fact you'd lock down today.`,
  ].join(' ');
}
