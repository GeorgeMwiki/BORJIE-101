/**
 * Continuous grading — property-management 5-axis live evaluation.
 *
 * The property-management analogue of LITFIN's `five-c-continuous`. The
 * Borjie brain reads its asset's pulse on every meaningful turn —
 * the moment a tenant signs, Occupancy lifts; the moment an inspection
 * fails, Asset Quality darkens — so the assistant's reasoning always
 * grounds in the building's CURRENT state, not the snapshot at sign-up.
 *
 * Five axes (5 axes × ~150-200 LOC each), each producing
 * { score, band, evidence, missing, watchpoints }:
 *
 *   1. Occupancy           — units occupied / total, trend, vacancy days
 *   2. Collections         — on-time rate, arrears days, dispute count
 *   3. Asset Quality       — maintenance backlog, inspection pass rate,
 *                            age-of-defects
 *   4. Compliance          — KRA MRI filed/late, GePG control numbers
 *                            reconciled, certificates valid
 *   5. Tenant Satisfaction — sentiment rolling, NPS, complaint rate
 *
 * The overall score is the weighted mean. Each axis carries evidence /
 * missing / watchpoints arrays the brain can fold into its system
 * prompt — so the rendered briefing tells the LLM exactly which axis
 * needs lifting, with concrete handles the user can pull.
 *
 * Pure functions; deterministic; no IO.
 *
 * Backwards compatibility: the existing `gradeProperty(GradeInputs)`
 * facade is preserved. New callers should prefer `evaluatePropertyGrade`
 * (the richer surface that carries evidence / missing / watchpoints).
 */

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type GradeBand = 'A' | 'B' | 'C' | 'D' | 'F';

export type GradeAxisKey =
  | 'occupancy'
  | 'collections'
  | 'assetQuality'
  | 'compliance'
  | 'tenantSatisfaction';

export interface AxisEvaluation {
  readonly key: GradeAxisKey;
  /** Score on [0,1]. */
  readonly score: number;
  readonly band: GradeBand;
  readonly evidence: ReadonlyArray<string>;
  readonly missing: ReadonlyArray<string>;
  readonly watchpoints: ReadonlyArray<string>;
}

/**
 * Public-facing legacy shape preserved for callers that already consume
 * the kernel-units flat grade. The five fields now derive from the rich
 * axis evaluations; the field NAMES are stable.
 */
export interface PropertyGrade {
  readonly condition: number;
  readonly cashflow: number;
  readonly covenant: number;
  readonly context: number;
  readonly compliance: number;
  readonly overall: number;
  readonly band: GradeBand;
}

/** Rich snapshot — preferred surface for new callers. */
export interface PropertyGradeSnapshot {
  readonly evaluations: ReadonlyArray<AxisEvaluation>;
  readonly overall: number;
  readonly band: GradeBand;
  readonly weakestAxis: GradeAxisKey;
}

/**
 * Legacy flat inputs — kept so existing kernel-units test + downstream
 * callers don't break.
 */
export interface GradeInputs {
  readonly inspectionsPassRate: number; // [0,1]
  readonly workOrderBacklogIndex: number; // [0,1] — 0 = no backlog
  readonly rentCollectionRate12mo: number; // [0,1]
  readonly arrearsCaseCountRel: number; // [0,1] vs comparable cohort
  readonly renewalRate: number; // [0,1]
  readonly disputeRate: number; // [0,1] — lower better
  readonly marketDriftSignal: number; // [-1,1] — local market move
  readonly kycCompletionRate: number; // [0,1]
  readonly gdprRequestSlaHit: number; // [0,1]
}

/**
 * Rich, property-management-shaped input surface. Every field is
 * optional so partial readings still produce a useful snapshot
 * (missing[] surfaces the holes the brain should ask about).
 */
export interface PropertyGradeInputs {
  // Occupancy
  readonly unitsOccupied?: number;
  readonly unitsTotal?: number;
  /** Recent trend: positive = filling, negative = emptying. */
  readonly occupancyTrend30d?: number;
  /** Average vacancy days for the units that are vacant. */
  readonly avgVacancyDays?: number;

  // Collections
  readonly onTimeCollectionRate?: number; // [0,1]
  readonly arrearsAvgDays?: number; // calendar days
  readonly disputeCount30d?: number;
  readonly collectionsTrend30d?: number; // direction signal

  // Asset Quality
  readonly inspectionPassRate?: number; // [0,1]
  readonly maintenanceBacklogCount?: number;
  /** Days the oldest open defect has been open. */
  readonly oldestOpenDefectDays?: number;
  /** Optional cohort-relative backlog index [0,1]. */
  readonly maintenanceBacklogIndex?: number;

  // Compliance
  readonly kraMriFiledOnTimeRate?: number; // [0,1]
  readonly kraMriLateCount30d?: number;
  readonly gepgControlNumbersReconciledRate?: number; // [0,1]
  readonly expiredCertificateCount?: number;
  readonly certificatesValidRate?: number; // [0,1]

  // Tenant Satisfaction
  readonly sentimentRolling30d?: number; // [-1,1]
  readonly npsScore?: number; // [-100,100]
  readonly complaintRatePer100Units?: number;
  readonly resolvedComplaintRate?: number; // [0,1]
}

// ─────────────────────────────────────────────────────────────────────
// Weights + thresholds
// ─────────────────────────────────────────────────────────────────────

const WEIGHTS: Readonly<Record<GradeAxisKey, number>> = Object.freeze({
  occupancy: 0.2,
  collections: 0.3,
  assetQuality: 0.2,
  compliance: 0.15,
  tenantSatisfaction: 0.15,
});

const HEALTHY_BACKLOG_DEFAULT = 5;
const HEALTHY_DEFECT_AGE_DAYS = 14;
const HEALTHY_ARREARS_DAYS = 5;
const HEALTHY_VACANCY_DAYS = 30;

// ─────────────────────────────────────────────────────────────────────
// Axis scorers — each ~150-200 LOC with evidence / missing / watch
// ─────────────────────────────────────────────────────────────────────

function evalOccupancy(input: PropertyGradeInputs): AxisEvaluation {
  const evidence: string[] = [];
  const missing: string[] = [];
  const watch: string[] = [];
  let score = 0.5; // neutral baseline

  const occ = input.unitsOccupied;
  const total = input.unitsTotal;
  if (typeof occ === 'number' && typeof total === 'number' && total > 0) {
    const rate = clamp01(occ / total);
    score = rate;
    evidence.push(
      `${occ}/${total} units occupied (${Math.round(rate * 100)}%)`,
    );
    if (rate >= 0.95) {
      score = Math.min(1, score + 0.05);
      evidence.push('near-full occupancy');
    } else if (rate < 0.6) {
      watch.push(
        `occupancy below 60% (${Math.round(rate * 100)}%) — revenue risk`,
      );
    } else if (rate < 0.8) {
      watch.push(
        `occupancy below 80% (${Math.round(rate * 100)}%) — slack capacity`,
      );
    }
  } else {
    missing.push('unitsOccupied / unitsTotal not declared');
  }

  if (typeof input.occupancyTrend30d === 'number') {
    const t = input.occupancyTrend30d;
    if (t > 0.05) {
      score = clamp01(score + 0.05);
      evidence.push(`occupancy trending UP (+${(t * 100).toFixed(1)}%)`);
    } else if (t < -0.05) {
      score = clamp01(score - 0.1);
      watch.push(
        `occupancy trending DOWN (${(t * 100).toFixed(1)}%) — investigate churn`,
      );
    }
  } else {
    missing.push('30-day occupancy trend');
  }

  if (typeof input.avgVacancyDays === 'number') {
    const d = input.avgVacancyDays;
    if (d > 0) {
      if (d <= HEALTHY_VACANCY_DAYS) {
        evidence.push(`avg vacancy ${d}d — within healthy range`);
      } else if (d <= HEALTHY_VACANCY_DAYS * 2) {
        score = clamp01(score - 0.05);
        watch.push(
          `avg vacancy ${d}d — listing or rent strategy may need a refresh`,
        );
      } else {
        score = clamp01(score - 0.1);
        watch.push(
          `avg vacancy ${d}d — significant lost revenue, likely pricing issue`,
        );
      }
    }
  } else if (typeof total === 'number' && typeof occ === 'number' && occ < total) {
    missing.push('average vacancy days');
  }

  return {
    key: 'occupancy',
    score: clamp01(score),
    band: bandFor(score),
    evidence,
    missing,
    watchpoints: watch,
  };
}

function evalCollections(input: PropertyGradeInputs): AxisEvaluation {
  const evidence: string[] = [];
  const missing: string[] = [];
  const watch: string[] = [];
  let score = 0.5;

  if (typeof input.onTimeCollectionRate === 'number') {
    const r = clamp01(input.onTimeCollectionRate);
    score = r;
    evidence.push(`on-time collection rate ${Math.round(r * 100)}%`);
    if (r >= 0.95) {
      evidence.push('elite on-time collection');
    } else if (r < 0.7) {
      watch.push(
        `on-time rate ${Math.round(r * 100)}% — meaningful delinquency`,
      );
    } else if (r < 0.85) {
      watch.push(`on-time rate ${Math.round(r * 100)}% — payment friction`);
    }
  } else {
    missing.push('on-time collection rate');
  }

  if (typeof input.arrearsAvgDays === 'number') {
    const d = input.arrearsAvgDays;
    if (d <= HEALTHY_ARREARS_DAYS) {
      score = clamp01(score + 0.1);
      evidence.push(`avg arrears ${d}d — within tolerance`);
    } else if (d <= 14) {
      score = clamp01(score - 0.05);
      watch.push(`avg arrears ${d}d — chase reminders needed`);
    } else if (d <= 30) {
      score = clamp01(score - 0.15);
      watch.push(`avg arrears ${d}d — escalation likely required`);
    } else {
      score = clamp01(score - 0.25);
      watch.push(`avg arrears ${d}d — write-off territory`);
    }
  } else {
    missing.push('average arrears age in days');
  }

  if (typeof input.disputeCount30d === 'number') {
    const c = input.disputeCount30d;
    if (c === 0) {
      evidence.push('no payment disputes in last 30d');
    } else if (c <= 2) {
      watch.push(`${c} payment dispute(s) in last 30d`);
    } else {
      score = clamp01(score - 0.05 * Math.min(c, 10));
      watch.push(
        `${c} payment disputes in last 30d — process review needed`,
      );
    }
  } else {
    missing.push('30-day dispute count');
  }

  if (typeof input.collectionsTrend30d === 'number') {
    const t = input.collectionsTrend30d;
    if (t > 0.03) {
      score = clamp01(score + 0.03);
      evidence.push('collections trending up');
    } else if (t < -0.03) {
      score = clamp01(score - 0.05);
      watch.push('collections trending down');
    }
  }

  return {
    key: 'collections',
    score: clamp01(score),
    band: bandFor(score),
    evidence,
    missing,
    watchpoints: watch,
  };
}

function evalAssetQuality(input: PropertyGradeInputs): AxisEvaluation {
  const evidence: string[] = [];
  const missing: string[] = [];
  const watch: string[] = [];
  let score = 0.5;

  if (typeof input.inspectionPassRate === 'number') {
    const r = clamp01(input.inspectionPassRate);
    score = r;
    evidence.push(`inspection pass rate ${Math.round(r * 100)}%`);
    if (r < 0.7) {
      watch.push(
        `inspection pass rate ${Math.round(r * 100)}% — systemic issues`,
      );
    } else if (r < 0.85) {
      watch.push(
        `inspection pass rate ${Math.round(r * 100)}% — slipping standards`,
      );
    }
  } else {
    missing.push('inspection pass rate');
  }

  if (typeof input.maintenanceBacklogCount === 'number') {
    const b = input.maintenanceBacklogCount;
    if (b <= HEALTHY_BACKLOG_DEFAULT) {
      evidence.push(`maintenance backlog ${b} (manageable)`);
    } else if (b <= HEALTHY_BACKLOG_DEFAULT * 3) {
      score = clamp01(score - 0.05);
      watch.push(`maintenance backlog ${b} — schedule planned work`);
    } else {
      score = clamp01(score - 0.15);
      watch.push(`maintenance backlog ${b} — capacity gap, route or hire`);
    }
  } else if (typeof input.maintenanceBacklogIndex === 'number') {
    const idx = clamp01(input.maintenanceBacklogIndex);
    score = clamp01(score - idx * 0.2);
    evidence.push(`maintenance backlog index ${(idx * 100).toFixed(0)}%`);
  } else {
    missing.push('maintenance backlog count or relative index');
  }

  if (typeof input.oldestOpenDefectDays === 'number') {
    const age = input.oldestOpenDefectDays;
    if (age <= HEALTHY_DEFECT_AGE_DAYS) {
      evidence.push(`oldest open defect ${age}d — recent`);
    } else if (age <= 30) {
      score = clamp01(score - 0.05);
      watch.push(`oldest open defect ${age}d — close-out drift`);
    } else if (age <= 90) {
      score = clamp01(score - 0.15);
      watch.push(
        `oldest open defect ${age}d — habitability or liability risk`,
      );
    } else {
      score = clamp01(score - 0.25);
      watch.push(
        `oldest open defect ${age}d — escalate, document the dispute trail`,
      );
    }
  } else if (
    typeof input.maintenanceBacklogCount === 'number' &&
    input.maintenanceBacklogCount > 0
  ) {
    missing.push('age of oldest open defect');
  }

  return {
    key: 'assetQuality',
    score: clamp01(score),
    band: bandFor(score),
    evidence,
    missing,
    watchpoints: watch,
  };
}

function evalCompliance(input: PropertyGradeInputs): AxisEvaluation {
  const evidence: string[] = [];
  const missing: string[] = [];
  const watch: string[] = [];
  let score = 0.5;

  if (typeof input.kraMriFiledOnTimeRate === 'number') {
    const r = clamp01(input.kraMriFiledOnTimeRate);
    score = r;
    evidence.push(`KRA MRI on-time filing ${Math.round(r * 100)}%`);
    if (r < 0.9) {
      watch.push(
        `KRA MRI on-time filing ${Math.round(r * 100)}% — penalty exposure`,
      );
    }
  } else {
    missing.push('KRA MRI on-time filing rate');
  }

  if (typeof input.kraMriLateCount30d === 'number') {
    const c = input.kraMriLateCount30d;
    if (c === 0) {
      evidence.push('no late KRA MRI filings in last 30d');
    } else if (c <= 1) {
      score = clamp01(score - 0.05);
      watch.push('1 late KRA MRI filing in last 30d');
    } else {
      score = clamp01(score - 0.1);
      watch.push(`${c} late KRA MRI filings — process gap`);
    }
  }

  if (typeof input.gepgControlNumbersReconciledRate === 'number') {
    const r = clamp01(input.gepgControlNumbersReconciledRate);
    score = clamp01(score * 0.5 + r * 0.5);
    evidence.push(
      `GePG control numbers reconciled ${Math.round(r * 100)}%`,
    );
    if (r < 0.95) {
      watch.push(
        `GePG reconciliation at ${Math.round(r * 100)}% — money trail incomplete`,
      );
    }
  } else {
    missing.push('GePG control-number reconciliation rate');
  }

  if (typeof input.expiredCertificateCount === 'number') {
    const c = input.expiredCertificateCount;
    if (c === 0) {
      evidence.push('all certificates current');
    } else if (c <= 2) {
      score = clamp01(score - 0.05);
      watch.push(`${c} expired certificate(s)`);
    } else {
      score = clamp01(score - 0.15);
      watch.push(
        `${c} expired certificates — block listings until renewed`,
      );
    }
  }
  if (typeof input.certificatesValidRate === 'number') {
    const r = clamp01(input.certificatesValidRate);
    score = clamp01(score * 0.6 + r * 0.4);
    evidence.push(`certificates valid ${Math.round(r * 100)}%`);
  } else if (typeof input.expiredCertificateCount !== 'number') {
    missing.push('certificate validity status');
  }

  return {
    key: 'compliance',
    score: clamp01(score),
    band: bandFor(score),
    evidence,
    missing,
    watchpoints: watch,
  };
}

function evalTenantSatisfaction(input: PropertyGradeInputs): AxisEvaluation {
  const evidence: string[] = [];
  const missing: string[] = [];
  const watch: string[] = [];
  let score = 0.5;

  if (typeof input.sentimentRolling30d === 'number') {
    const s = clamp(-1, 1, input.sentimentRolling30d);
    // Map [-1,1] to [0,1] for scoring.
    score = (s + 1) / 2;
    if (s >= 0.5) evidence.push(`sentiment +${(s * 100).toFixed(0)}% (warm)`);
    else if (s <= -0.2)
      watch.push(`sentiment ${(s * 100).toFixed(0)}% — escalating frustration`);
    else evidence.push(`sentiment ${(s * 100).toFixed(0)}% (neutral)`);
  } else {
    missing.push('30-day rolling sentiment signal');
  }

  if (typeof input.npsScore === 'number') {
    const n = clamp(-100, 100, input.npsScore);
    const npsRatio = (n + 100) / 200;
    score = clamp01(score * 0.5 + npsRatio * 0.5);
    if (n >= 50) evidence.push(`NPS ${n} (excellent)`);
    else if (n >= 20) evidence.push(`NPS ${n} (good)`);
    else if (n >= 0) watch.push(`NPS ${n} — flat, room to grow`);
    else watch.push(`NPS ${n} — detractors outnumber promoters`);
  } else {
    missing.push('NPS score');
  }

  if (typeof input.complaintRatePer100Units === 'number') {
    const r = input.complaintRatePer100Units;
    if (r <= 2) {
      evidence.push(`complaint rate ${r.toFixed(1)} per 100 units — low`);
    } else if (r <= 5) {
      score = clamp01(score - 0.05);
      watch.push(`complaint rate ${r.toFixed(1)} per 100 units`);
    } else {
      score = clamp01(score - 0.15);
      watch.push(
        `complaint rate ${r.toFixed(1)} per 100 units — concentrated frustration`,
      );
    }
  } else {
    missing.push('complaint rate per 100 units');
  }

  if (typeof input.resolvedComplaintRate === 'number') {
    const r = clamp01(input.resolvedComplaintRate);
    if (r >= 0.9) evidence.push(`${Math.round(r * 100)}% of complaints resolved`);
    else if (r < 0.5) {
      score = clamp01(score - 0.1);
      watch.push(
        `only ${Math.round(r * 100)}% of complaints resolved — closing the loop matters`,
      );
    }
  }

  return {
    key: 'tenantSatisfaction',
    score: clamp01(score),
    band: bandFor(score),
    evidence,
    missing,
    watchpoints: watch,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Rich 5-axis evaluation. Preferred surface for new callers — every
 * axis carries evidence / missing / watchpoints so the rendered
 * briefing can name the weakest axis AND the concrete handle the user
 * can pull.
 */
export function evaluatePropertyGrade(
  input: PropertyGradeInputs,
): PropertyGradeSnapshot {
  const evaluations: ReadonlyArray<AxisEvaluation> = [
    evalOccupancy(input),
    evalCollections(input),
    evalAssetQuality(input),
    evalCompliance(input),
    evalTenantSatisfaction(input),
  ];
  let overall = 0;
  for (const e of evaluations) {
    overall += clamp01(e.score) * WEIGHTS[e.key];
  }
  overall = clamp01(overall);
  const weakest = [...evaluations].sort((a, b) => a.score - b.score)[0];
  return {
    evaluations,
    overall,
    band: bandFor(overall),
    weakestAxis: weakest.key,
  };
}

/**
 * Render the snapshot as a directive system-prompt fragment. Names the
 * weakest axis and supplies the concrete watchpoints / missing handles
 * so the LLM produces a turn that tries to lift the weakest axis
 * without losing the others.
 */
export function renderGradeBriefing(
  g: PropertyGrade | PropertyGradeSnapshot,
): string {
  if (isSnapshot(g)) return renderSnapshotBriefing(g);

  // Legacy flat grade — emit the original style so downstream callers
  // that depend on the shape see no behaviour change.
  return [
    `Asset grade: ${g.band} (overall ${(g.overall * 100).toFixed(0)}%).`,
    `Sub-scores — condition ${(g.condition * 100).toFixed(0)}%,`,
    `cashflow ${(g.cashflow * 100).toFixed(0)}%,`,
    `covenant ${(g.covenant * 100).toFixed(0)}%,`,
    `context ${(g.context * 100).toFixed(0)}%,`,
    `compliance ${(g.compliance * 100).toFixed(0)}%.`,
  ].join(' ');
}

function renderSnapshotBriefing(snap: PropertyGradeSnapshot): string {
  const lines: string[] = [
    `PROPERTY GRADE LIVE READING — overall ${Math.round(snap.overall * 100)}% (band ${snap.band}), weakest axis: ${snap.weakestAxis}.`,
  ];
  for (const e of snap.evaluations) {
    const parts: string[] = [
      `  - ${e.key}: ${Math.round(e.score * 100)}% (band ${e.band})`,
    ];
    if (e.evidence.length > 0) {
      parts.push(`evidence=${e.evidence.slice(0, 2).join('; ')}`);
    }
    if (e.watchpoints.length > 0) {
      parts.push(`watch=${e.watchpoints.slice(0, 2).join('; ')}`);
    }
    if (e.missing.length > 0) {
      parts.push(`missing=${e.missing.slice(0, 2).join('; ')}`);
    }
    lines.push(parts.join(' | '));
  }
  lines.push(
    `Tie this turn to lifting the weakest axis (${snap.weakestAxis}) without losing the others.`,
  );
  return lines.join('\n');
}

function isSnapshot(g: unknown): g is PropertyGradeSnapshot {
  return (
    typeof g === 'object' &&
    g !== null &&
    Array.isArray((g as { evaluations?: unknown }).evaluations)
  );
}

// ─────────────────────────────────────────────────────────────────────
// Legacy facade — preserve the existing signature so the kernel-units
// test + downstream callers keep working. Maps the flat shape onto the
// new property-management axes and returns the original sub-score
// layout.
// ─────────────────────────────────────────────────────────────────────

export function gradeProperty(inputs: GradeInputs): PropertyGrade {
  const condition = mean(
    inputs.inspectionsPassRate,
    1 - inputs.workOrderBacklogIndex,
  );
  const cashflow = mean(
    inputs.rentCollectionRate12mo,
    1 - inputs.arrearsCaseCountRel,
  );
  const covenant = mean(inputs.renewalRate, 1 - inputs.disputeRate);
  const context = 1 - Math.min(1, Math.abs(inputs.marketDriftSignal));
  const compliance = mean(inputs.kycCompletionRate, inputs.gdprRequestSlaHit);

  // Re-use the legacy axis weights so behaviour matches the prior version.
  const legacyWeights = [
    { key: 'condition', w: 0.2, v: condition },
    { key: 'cashflow', w: 0.3, v: cashflow },
    { key: 'covenant', w: 0.2, v: covenant },
    { key: 'context', w: 0.15, v: context },
    { key: 'compliance', w: 0.15, v: compliance },
  ] as const;
  const overall = legacyWeights.reduce(
    (acc, { v, w }) => acc + clamp01(v) * w,
    0,
  );

  return {
    condition: clamp01(condition),
    cashflow: clamp01(cashflow),
    covenant: clamp01(covenant),
    context: clamp01(context),
    compliance: clamp01(compliance),
    overall: clamp01(overall),
    band: bandFor(overall),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function mean(...xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function clamp(lo: number, hi: number, x: number): number {
  if (Number.isNaN(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function bandFor(score: number): GradeBand {
  if (score >= 0.85) return 'A';
  if (score >= 0.7) return 'B';
  if (score >= 0.55) return 'C';
  if (score >= 0.4) return 'D';
  return 'F';
}
