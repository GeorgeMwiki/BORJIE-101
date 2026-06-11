/**
 * The six standing estate DRIVES + their pure satisfaction evaluators.
 *
 * Each evaluator reads the activated situational snapshot, inspects the
 * relevant entity kind's domain attributes (e.g. a `cash` entity's
 * `runwayDays`, a `licence` entity's `renewalInDays`), and returns a
 * {@link DriveAssessment}. When a standing concern is breached the assessment
 * is `satisfied:false` and carries the breaching entities as evidence.
 *
 * Domain attribute contract (written by the loop's PERCEIVE step / sensors):
 *   cash      → { runwayDays: number }
 *   licence   → { renewalInDays: number }            (days until renewal due)
 *   safety    → site/equipment entity { openIncidents: number }
 *   offtake   → counterparty/site { offtakeCoverageRatio: number }  (0..1+)
 *   arrears   → { overdueDays: number }               (royalty/receivable age)
 *   equipment → { healthScore: number }               (0..1, 1 = healthy)
 *
 * Missing attributes mean "no signal" → the drive is SATISFIED for that
 * entity (we never raise a concern from absent data — that would spam the
 * owner). Pure + total: no throws, deterministic.
 */

import type {
  ActivatedEntity,
  SituationalSnapshot,
  SituationEntityKind,
} from '../situational-model/types.js';
import type {
  Drive,
  DriveAssessment,
  DriveId,
  DriveThresholds,
  DriveUrgency,
} from './types.js';

/**
 * Two epistemic drive ids that extend the closed mining drive pack WITHOUT a
 * `types.ts` edit. `DriveId` is `(typeof DRIVE_IDS)[number]`; these ids are
 * open-by-data-design — the only switch over `driveId` (`titleFor`) carries a
 * `default` branch, and every downstream consumer (the proposal sink, the
 * `tab_event_log` jsonb snapshot, the owner cockpit inbox) treats the id as an
 * opaque string. Casting the literal here keeps the new drives type-correct
 * while leaving the canonical `DRIVE_IDS` tuple untouched.
 */
const ESTATE_VISIBILITY_DRIVE_ID = 'estate-visibility' as DriveId;
const FORECAST_SURPRISE_DRIVE_ID = 'forecast-surprise' as DriveId;

/** Built-in default thresholds (tenant config overrides each). */
export const DEFAULT_DRIVE_THRESHOLDS: Required<DriveThresholds> = Object.freeze({
  cashRunwayDaysFloor: 30,
  licenceRenewalDaysFloor: 30,
  safetyOpenIncidentsCeiling: 0,
  offtakeCoverageRatioFloor: 0.8,
  royaltyOverdueDaysCeiling: 0,
  equipmentHealthScoreFloor: 0.5,
});

function num(entity: ActivatedEntity, key: string): number | null {
  const v = entity.entity.attributes[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function ofKind(
  snapshot: SituationalSnapshot,
  kind: ActivatedEntity['entity']['kind'],
): ReadonlyArray<ActivatedEntity> {
  return snapshot.entities.filter((e) => e.entity.kind === kind);
}

/** Map a [0,1] breach severity to a coarse urgency band. */
function urgencyFor(severity: number): DriveUrgency {
  if (severity >= 0.75) return 'critical';
  if (severity >= 0.5) return 'high';
  if (severity >= 0.25) return 'medium';
  return 'low';
}

function satisfied(driveId: DriveAssessment['driveId']): DriveAssessment {
  return {
    driveId,
    satisfied: true,
    breachSeverity: 0,
    urgency: 'low',
    summary: 'within tolerance',
    evidence: [],
  };
}

// ── cash-runway ──────────────────────────────────────────────────────────
// Concern: cash never breaks. Breached when any cash entity's runwayDays is
// below the floor. Severity scales with how deep below the floor we are.
export const CASH_RUNWAY_DRIVE: Drive = {
  id: 'cash-runway',
  description: 'Cash runway must stay above the configured floor.',
  evaluate(snapshot, thresholds): DriveAssessment {
    const floor = thresholds.cashRunwayDaysFloor ?? DEFAULT_DRIVE_THRESHOLDS.cashRunwayDaysFloor;
    const breaching: ActivatedEntity[] = [];
    let worst = 0;
    for (const e of ofKind(snapshot, 'cash')) {
      const runway = num(e, 'runwayDays');
      if (runway === null || runway >= floor) continue;
      breaching.push(e);
      const severity = floor <= 0 ? 1 : Math.min(1, (floor - runway) / floor);
      worst = Math.max(worst, severity);
    }
    if (breaching.length === 0) return satisfied('cash-runway');
    return {
      driveId: 'cash-runway',
      satisfied: false,
      breachSeverity: worst,
      urgency: urgencyFor(worst),
      summary: `cash runway below ${floor}-day floor`,
      evidence: breaching,
    };
  },
};

// ── licence-currency ─────────────────────────────────────────────────────
// Concern: the licence never lapses. Breached when a licence's renewalInDays
// is below the lead-time floor (act before the breach, Endsley L3).
export const LICENCE_CURRENCY_DRIVE: Drive = {
  id: 'licence-currency',
  description: 'Every licence must be renewed before its lead-time floor.',
  evaluate(snapshot, thresholds): DriveAssessment {
    const floor = thresholds.licenceRenewalDaysFloor ?? DEFAULT_DRIVE_THRESHOLDS.licenceRenewalDaysFloor;
    const breaching: ActivatedEntity[] = [];
    let worst = 0;
    for (const e of ofKind(snapshot, 'licence')) {
      const days = num(e, 'renewalInDays');
      if (days === null || days > floor) continue;
      breaching.push(e);
      // Below floor → severity grows as the renewal date approaches/passes.
      const severity = floor <= 0 ? 1 : Math.min(1, (floor - days) / floor);
      worst = Math.max(worst, severity);
    }
    if (breaching.length === 0) return satisfied('licence-currency');
    return {
      driveId: 'licence-currency',
      satisfied: false,
      breachSeverity: worst,
      urgency: urgencyFor(worst),
      summary: `licence renewal within ${floor}-day lead time`,
      evidence: breaching,
    };
  },
};

// ── safety ───────────────────────────────────────────────────────────────
// Concern: the workforce is safe. Breached when open safety incidents on any
// site/equipment exceed the ceiling (default 0 → any open incident breaches).
export const SAFETY_DRIVE: Drive = {
  id: 'safety',
  description: 'Open safety incidents must not exceed the ceiling.',
  evaluate(snapshot, thresholds): DriveAssessment {
    const ceiling = thresholds.safetyOpenIncidentsCeiling ?? DEFAULT_DRIVE_THRESHOLDS.safetyOpenIncidentsCeiling;
    const breaching: ActivatedEntity[] = [];
    let worst = 0;
    for (const e of [...ofKind(snapshot, 'site'), ...ofKind(snapshot, 'equipment')]) {
      const open = num(e, 'openIncidents');
      if (open === null || open <= ceiling) continue;
      breaching.push(e);
      // Severity saturates: 1 incident over → 0.5, 3+ over → 1.
      const over = open - ceiling;
      worst = Math.max(worst, Math.min(1, 0.5 + (over - 1) * 0.25));
    }
    if (breaching.length === 0) return satisfied('safety');
    return {
      driveId: 'safety',
      satisfied: false,
      breachSeverity: worst,
      urgency: urgencyFor(worst),
      summary: `open safety incidents above ${ceiling}`,
      evidence: breaching,
    };
  },
};

// ── offtake-coverage ─────────────────────────────────────────────────────
// Concern: production is sold. Breached when a counterparty/site's offtake
// coverage ratio falls below the floor (uncovered tonnes pile up).
export const OFFTAKE_COVERAGE_DRIVE: Drive = {
  id: 'offtake-coverage',
  description: 'Off-take coverage ratio must stay above the floor.',
  evaluate(snapshot, thresholds): DriveAssessment {
    const floor = thresholds.offtakeCoverageRatioFloor ?? DEFAULT_DRIVE_THRESHOLDS.offtakeCoverageRatioFloor;
    const breaching: ActivatedEntity[] = [];
    let worst = 0;
    for (const e of [...ofKind(snapshot, 'counterparty'), ...ofKind(snapshot, 'site')]) {
      const ratio = num(e, 'offtakeCoverageRatio');
      if (ratio === null || ratio >= floor) continue;
      breaching.push(e);
      const severity = floor <= 0 ? 1 : Math.min(1, (floor - ratio) / floor);
      worst = Math.max(worst, severity);
    }
    if (breaching.length === 0) return satisfied('offtake-coverage');
    return {
      driveId: 'offtake-coverage',
      satisfied: false,
      breachSeverity: worst,
      urgency: urgencyFor(worst),
      summary: `off-take coverage below ${floor}`,
      evidence: breaching,
    };
  },
};

// ── royalty-currency ─────────────────────────────────────────────────────
// Concern: royalty/receivables stay current. Breached when an arrears
// position's overdueDays exceeds the ceiling.
export const ROYALTY_CURRENCY_DRIVE: Drive = {
  id: 'royalty-currency',
  description: 'Royalty / receivables must not exceed the overdue ceiling.',
  evaluate(snapshot, thresholds): DriveAssessment {
    const ceiling = thresholds.royaltyOverdueDaysCeiling ?? DEFAULT_DRIVE_THRESHOLDS.royaltyOverdueDaysCeiling;
    const breaching: ActivatedEntity[] = [];
    let worst = 0;
    for (const e of ofKind(snapshot, 'arrears')) {
      const overdue = num(e, 'overdueDays');
      if (overdue === null || overdue <= ceiling) continue;
      breaching.push(e);
      // 30d over ceiling → ~0.5; 90d+ → 1.
      const over = overdue - ceiling;
      worst = Math.max(worst, Math.min(1, over / 90));
    }
    if (breaching.length === 0) return satisfied('royalty-currency');
    return {
      driveId: 'royalty-currency',
      satisfied: false,
      breachSeverity: worst,
      urgency: urgencyFor(worst),
      summary: `overdue royalty/receivables above ${ceiling}-day ceiling`,
      evidence: breaching,
    };
  },
};

// ── equipment-health ─────────────────────────────────────────────────────
// Concern: equipment doesn't silently rot. Breached when an asset's health
// score falls below the floor.
export const EQUIPMENT_HEALTH_DRIVE: Drive = {
  id: 'equipment-health',
  description: 'Equipment health score must stay above the floor.',
  evaluate(snapshot, thresholds): DriveAssessment {
    const floor = thresholds.equipmentHealthScoreFloor ?? DEFAULT_DRIVE_THRESHOLDS.equipmentHealthScoreFloor;
    const breaching: ActivatedEntity[] = [];
    let worst = 0;
    for (const e of ofKind(snapshot, 'equipment')) {
      const health = num(e, 'healthScore');
      if (health === null || health >= floor) continue;
      breaching.push(e);
      const severity = floor <= 0 ? 1 : Math.min(1, (floor - health) / floor);
      worst = Math.max(worst, severity);
    }
    if (breaching.length === 0) return satisfied('equipment-health');
    return {
      driveId: 'equipment-health',
      satisfied: false,
      breachSeverity: worst,
      urgency: urgencyFor(worst),
      summary: `equipment health below ${floor}`,
      evidence: breaching,
    };
  },
};

// ── estate-visibility (the EPISTEMIC drive — curiosity about blind spots) ────
// Curiosity & Intrinsic Motivation. Every OTHER drive raises a concern from
// BREACHED data; this one raises a concern from MISSING data. It does NOT read
// entity attributes — it reads the SET of entity KINDS the perception fold has
// populated this tick and scores the high-decision-impact concern-kinds that
// have ZERO observed entities (a literal blind spot — the perception source's
// `return []` "no signal" branches feed THIS drive instead of being swallowed).
//
// This inverts the anti-curiosity "missing → SATISFIED" rule of the six domain
// drives: those stay mute on absent data (so they never spam), and the single
// visibility drive owns the "I can't see X" concern — coalesced by its one
// drive-key so the MD asks ONCE, not every tick.
//
// breachSeverity = the decision-impact weight of the WORST missing kind (cash /
// licence dominate an artisanal operation; equipment is the gentlest blind
// spot). A fully-observed estate (every weighted kind present) is satisfied.
//
// CRITICAL: we weight ONLY the "presence-expected" kinds — the ones where an
// EMPTY observation is a genuine BLIND SPOT, not a healthy state. cash /
// licence / counterparty (off-take) / equipment are things a real operation
// HAS, so seeing zero of them means "I can't see it", not "all good". We
// DELIBERATELY exclude `arrears` and `site`-incidents from the coverage check:
// zero overdue royalties / zero open incidents is the HEALTHY norm there, so a
// visibility nudge about them would nag a well-run estate (the domain drives
// already own those — and stay mute on absence by design).
const VISIBILITY_KIND_WEIGHTS: Partial<Record<SituationEntityKind, number>> =
  Object.freeze({
    cash: 1.0, // runway is the #1 killer of an artisanal operation
    licence: 1.0, // a lapsed licence halts the whole estate
    counterparty: 0.7, // off-take coverage — uncovered tonnes pile up
    equipment: 0.4, // fleet health degrades slowly
  });

function observedKinds(snapshot: SituationalSnapshot): ReadonlySet<string> {
  const kinds = new Set<string>();
  for (const e of snapshot.entities) kinds.add(e.entity.kind);
  return kinds;
}

export const ESTATE_VISIBILITY_DRIVE: Drive = {
  id: ESTATE_VISIBILITY_DRIVE_ID,
  description:
    'High-decision-impact estate concerns must be OBSERVABLE — a kind with zero observed entities is a blind spot.',
  evaluate(snapshot): DriveAssessment {
    const present = observedKinds(snapshot);
    const missing: Array<{ kind: SituationEntityKind; weight: number }> = [];
    let worst = 0;
    for (const [kind, weight] of Object.entries(VISIBILITY_KIND_WEIGHTS)) {
      if (weight === undefined) continue;
      if (present.has(kind)) continue;
      missing.push({ kind: kind as SituationEntityKind, weight });
      worst = Math.max(worst, weight);
    }
    // Nothing missing → fully observable estate → satisfied. An EMPTY snapshot
    // (every kind missing) is the strongest curiosity signal, not a no-op.
    if (missing.length === 0) return satisfied(ESTATE_VISIBILITY_DRIVE_ID);
    // Surface the blind spots in decision-impact order so the proposal names
    // the things that most kill an operation first.
    const ordered = [...missing].sort((a, b) => b.weight - a.weight);
    const names = ordered.map((m) => m.kind).join(', ');
    // Curiosity fires on ABSENCE — there is no BREACHING entity to cite. To
    // honour the downstream Auditor evidence rail (≥1 evidence id) we cite the
    // single most-salient entity the MD CAN see (the broadcast) as provenance
    // for "the part of the estate I have a view of". A net-new tenant with an
    // entirely empty snapshot has nothing to cite — evidence stays empty there
    // (the proposal still surfaces; it is a request FOR data, not a claim).
    const evidence = snapshot.broadcast ? [snapshot.broadcast] : [];
    return {
      driveId: ESTATE_VISIBILITY_DRIVE_ID,
      satisfied: false,
      breachSeverity: worst,
      urgency: urgencyFor(worst),
      summary: `no visibility into: ${names}`,
      evidence,
    };
  },
};

// ── forecast-surprise (PREDICTIVE CODING — attend to what defied the forecast) ─
// Active inference: the MD should look first at what most VIOLATED its own
// prediction, not at what is merely closest to a static threshold. The estate-
// mind perception source decorates an entity with a `surpriseDrift` attribute
// (the reconciliation drift_score, [0,1]) keyed to the SAME entityId the six
// domain perceivers use; the situational fold merges it onto that entity. This
// drive fires UNSATISFIED for any entity carrying surpriseDrift above the
// DIVERGENT band so the most-surprising entity becomes the loop's lead concern.
//
// Pure: reads the attributes bag only (no IO). Missing attribute → no signal,
// honouring the "absent data never raises a concern" rule of the pack.
const DIVERGENT_SURPRISE_BAND = 0.4; // mirrors the reconciliation worker's band

export const FORECAST_SURPRISE_DRIVE: Drive = {
  id: FORECAST_SURPRISE_DRIVE_ID,
  description:
    'An outcome that diverged sharply from its forecast (high drift) demands attention before raw-threshold concerns.',
  evaluate(snapshot): DriveAssessment {
    const breaching: ActivatedEntity[] = [];
    let worst = 0;
    for (const e of snapshot.entities) {
      const drift = num(e, 'surpriseDrift');
      if (drift === null || drift <= DIVERGENT_SURPRISE_BAND) continue;
      breaching.push(e);
      // drift in (band, 1] → severity scales across the remaining headroom.
      const span = 1 - DIVERGENT_SURPRISE_BAND;
      const severity = span <= 0 ? 1 : Math.min(1, (drift - DIVERGENT_SURPRISE_BAND) / span);
      worst = Math.max(worst, severity);
    }
    if (breaching.length === 0) return satisfied(FORECAST_SURPRISE_DRIVE_ID);
    return {
      driveId: FORECAST_SURPRISE_DRIVE_ID,
      satisfied: false,
      breachSeverity: worst,
      urgency: urgencyFor(worst),
      summary: `an outcome diverged sharply from its forecast (drift above ${DIVERGENT_SURPRISE_BAND})`,
      evidence: breaching,
    };
  },
};

/** The full default drive set, in evaluation order. */
export const DEFAULT_DRIVES: ReadonlyArray<Drive> = Object.freeze([
  CASH_RUNWAY_DRIVE,
  LICENCE_CURRENCY_DRIVE,
  SAFETY_DRIVE,
  OFFTAKE_COVERAGE_DRIVE,
  ROYALTY_CURRENCY_DRIVE,
  EQUIPMENT_HEALTH_DRIVE,
  // ── epistemic drives (curiosity + surprise) — fire on MISSING / SURPRISING
  //    data, not breached thresholds. Appended last so the six domain concerns
  //    keep their evaluation order; the engine re-sorts goals by severity.
  ESTATE_VISIBILITY_DRIVE,
  FORECAST_SURPRISE_DRIVE,
]);
