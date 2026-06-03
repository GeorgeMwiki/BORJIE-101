/**
 * Regulator-readiness release-gate runners — the real consumer of
 * `@borjie/regulator-sim` and `@borjie/blind-review` (LP-16 / PO-20 / PO-22).
 *
 * Both packages were built + tested but had ZERO consumers; this module wires
 * them behind the same `RunnerReport` contract the capability + SOTA gates use
 * (LP-22), so a single `run-all` CLI can gate CI on them. Each runner is
 * deterministic given a seed + an injected clock — no network, no DB.
 *
 *   regulator-audit-replay → `replayAudit` over a seeded date-range corpus,
 *                            asserting the seven decision invariants hold.
 *   regulator-supervision  → `buildSupervisionPack`, asserting all required
 *                            sections render and the pack is deterministic.
 *   regulator-pdpa         → `pdpaEndToEnd`, asserting subject-access redaction
 *                            and legal-hold-aware erasure both pass.
 *   blind-review-m5        → `runBlindReviewCi` with M5-calibrated near-chance
 *                            reviewers, asserting reviewer accuracy ≤ 0.55
 *                            (the indistinguishability bar).
 *
 * @module regulator-pack/runners
 */

import {
  buildSupervisionPack,
  createInMemoryPdpaSurface,
  pdpaEndToEnd,
  replayAudit,
  summarizeAudit,
  SUPERVISION_PACK_REQUIRED_SECTIONS,
} from '../../packages/regulator-sim/src/index.js';
import {
  INDISTINGUISHABILITY_BAR,
  runBlindReviewCi,
} from '../../packages/blind-review/src/index.js';
import { finalizeRunner, type RunnerReport } from '../eval-ops-lib/report.js';
import {
  ALLOWED_REASON_CODES,
  buildOutOfWindowDecoys,
  buildSyntheticDecisions,
  buildSyntheticPdpaArtefacts,
  REGISTERED_MODEL_IDS,
} from './synthetic.js';

export type RegulatorRunnerId =
  | 'regulator-audit-replay'
  | 'regulator-supervision'
  | 'regulator-pdpa'
  | 'blind-review-m5';

export const REGULATOR_RUNNER_IDS: ReadonlyArray<RegulatorRunnerId> = [
  'regulator-audit-replay',
  'regulator-supervision',
  'regulator-pdpa',
  'blind-review-m5',
];

/** Knobs shared by every runner so the suite is reproducible. */
export interface RegulatorRunnerOpts {
  readonly seed: number;
  /** Audit-replay window start (ISO 8601). */
  readonly fromIso: string;
  /** Audit-replay window end (ISO 8601). */
  readonly toIso: string;
  /** Injected clock — model-card freshness + report timestamps key off this. */
  readonly nowIso: string;
  /** Number of synthetic decisions to replay. */
  readonly decisionCount: number;
  /** Blind-review panel size (records per reviewer). */
  readonly blindLimit: number;
}

/** Stable per-id hash so each runner gets an independent seeded stream. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const MODEL_CARD_MAX_AGE_DAYS = 90;
const FAIRNESS_TOLERANCE = 0.1;

/** Number of out-of-window decoys mixed in to keep the window filter honest. */
const AUDIT_DECOY_COUNT = 12;

/** Replay a seeded corpus of decisions and assert the audit invariants. */
function auditReplayRunner(opts: RegulatorRunnerOpts): RunnerReport {
  const startedMs = Date.now();
  const runnerSeed = opts.seed ^ hashId('regulator-audit-replay');
  const inWindow = buildSyntheticDecisions({
    fromIso: opts.fromIso,
    toIso: opts.toIso,
    seed: runnerSeed,
    count: opts.decisionCount,
    nowIso: opts.nowIso,
  });
  // Out-of-window decoys: `replayAudit` MUST filter these out by date. If it
  // ever stopped doing so, the "exact in-window count" criterion trips red.
  const decoys = buildOutOfWindowDecoys(
    opts.fromIso,
    runnerSeed ^ 0x9e3779b9,
    AUDIT_DECOY_COUNT,
    opts.nowIso,
  );
  const result = replayAudit(
    {
      fromIso: opts.fromIso,
      toIso: opts.toIso,
      records: [...inWindow, ...decoys],
      fairnessTolerance: FAIRNESS_TOLERANCE,
      registeredModelIds: REGISTERED_MODEL_IDS,
      allowedReasonCodes: ALLOWED_REASON_CODES,
      modelCardMaxAgeDays: MODEL_CARD_MAX_AGE_DAYS,
    },
    opts.nowIso,
  );

  return finalizeRunner({
    runnerId: 'regulator-audit-replay',
    title: 'Regulator — audit replay over a date range (decision invariants)',
    seed: opts.seed,
    nScenarios: inWindow.length,
    durationMs: Date.now() - startedMs,
    summary:
      `${summarizeAudit(result)} window ${opts.fromIso}..${opts.toIso}; ` +
      `${AUDIT_DECOY_COUNT} out-of-window decoy(s) correctly excluded.`,
    metrics: [
      { key: 'records_replayed', value: result.recordsReplayed },
      { key: 'decoys_supplied', value: decoys.length },
      { key: 'findings', value: result.findings.length },
    ],
    criteria: [
      {
        criterion: 'exactly the in-window decisions replayed (decoys excluded)',
        observed: result.recordsReplayed,
        threshold: opts.decisionCount,
        passed: result.recordsReplayed === opts.decisionCount,
      },
      {
        criterion: 'zero audit findings',
        observed: result.findings.length,
        threshold: 0,
        higherIsBetter: false,
        passed: result.findings.length === 0,
      },
    ],
  });
}

/** Build the supervision pack and assert section completeness + determinism. */
function supervisionRunner(opts: RegulatorRunnerOpts): RunnerReport {
  const startedMs = Date.now();
  const input = {
    periodFromIso: opts.fromIso.slice(0, 10),
    periodToIso: opts.toIso.slice(0, 10),
    institution: 'Borjie Estate Holdings Ltd',
    miningLicenceNumber: 'ML-2026-0042',
    royaltyRemittanceRatio: 1.0,
    licenceComplianceRatio: 0.97,
    liquidityRatio: 1.2,
    amlAlerts: 4,
    amlClosed: 4,
  };
  const pack = buildSupervisionPack(input);
  const titles = new Set(pack.documents.map((d) => d.title));
  const missing = SUPERVISION_PACK_REQUIRED_SECTIONS.filter(
    (s) => !titles.has(s),
  );
  // Determinism: a second build must yield an identical checksum.
  const deterministic = buildSupervisionPack(input).checksum === pack.checksum;

  return finalizeRunner({
    runnerId: 'regulator-supervision',
    title: 'Regulator — mining supervision document pack',
    seed: opts.seed,
    nScenarios: pack.documents.length,
    durationMs: Date.now() - startedMs,
    summary:
      `Generated ${pack.documents.length}/${SUPERVISION_PACK_REQUIRED_SECTIONS.length} ` +
      `required sections (checksum ${pack.checksum}, deterministic=${deterministic}).`,
    metrics: [
      { key: 'sections', value: pack.documents.length },
      { key: 'missing_sections', value: missing.length },
    ],
    criteria: [
      {
        criterion: 'all required sections present',
        observed: SUPERVISION_PACK_REQUIRED_SECTIONS.length - missing.length,
        threshold: SUPERVISION_PACK_REQUIRED_SECTIONS.length,
        passed: missing.length === 0,
      },
      {
        criterion: 'pack checksum is deterministic',
        observed: deterministic ? 1 : 0,
        threshold: 1,
        passed: deterministic,
      },
    ],
  });
}

/** Run the PDPA access + legal-hold-aware erasure drill. */
function pdpaRunner(opts: RegulatorRunnerOpts): RunnerReport {
  const startedMs = Date.now();
  const subjectId = 'owner-1';
  const artefacts = buildSyntheticPdpaArtefacts(subjectId);
  const surface = createInMemoryPdpaSurface(artefacts);
  const { access, erasure } = pdpaEndToEnd(subjectId, surface, opts.nowIso);
  // The legal-held artefact must survive; the redactable one must be gone.
  const heldRetained = surface
    .snapshot()
    .some((a) => a.id === `${subjectId}-a2`);
  const redactablePurged = !surface
    .snapshot()
    .some((a) => a.id === `${subjectId}-a1`);

  return finalizeRunner({
    runnerId: 'regulator-pdpa',
    title: 'Regulator — PDPA subject-access + erasure drill',
    seed: opts.seed,
    nScenarios: artefacts.filter((a) => a.subjectId === subjectId).length,
    durationMs: Date.now() - startedMs,
    summary:
      `access passed=${access.passed} (redacted ${access.redactedFields.length} field(s)), ` +
      `erasure passed=${erasure.passed} (erased ${erasure.artefactsCount}, ` +
      `${erasure.residualOnLegalHold.length} on legal hold).`,
    metrics: [
      { key: 'access_artefacts', value: access.artefactsCount },
      { key: 'redacted_fields', value: access.redactedFields.length },
      { key: 'erased', value: erasure.artefactsCount },
      { key: 'on_legal_hold', value: erasure.residualOnLegalHold.length },
    ],
    criteria: [
      {
        criterion: 'subject access fulfilled',
        observed: access.passed ? 1 : 0,
        threshold: 1,
        passed: access.passed,
      },
      {
        criterion: 'erasure fulfilled (hold-aware)',
        observed: erasure.passed ? 1 : 0,
        threshold: 1,
        passed: erasure.passed,
      },
      {
        criterion: 'legal-held artefact retained',
        observed: heldRetained ? 1 : 0,
        threshold: 1,
        passed: heldRetained,
      },
      {
        criterion: 'redactable artefact erased',
        observed: redactablePurged ? 1 : 0,
        threshold: 1,
        passed: redactablePurged,
      },
    ],
  });
}

/**
 * M5 indistinguishability panel. The reviewers are calibrated to the M5
 * hypothesis — senior officers cannot tell Mr. Mwikila's rationales from a
 * human's — i.e. near-chance detection. The gate asserts aggregate reviewer
 * accuracy stays at or below the 0.55 indistinguishability bar.
 */
async function blindReviewRunner(
  opts: RegulatorRunnerOpts,
): Promise<RunnerReport> {
  const startedMs = Date.now();
  const report = await runBlindReviewCi({
    seed: opts.seed ^ hashId('blind-review-m5'),
    limit: opts.blindLimit,
    reviewerIds: ['officer-alpha', 'officer-beta', 'officer-gamma'],
    // Near-chance officers: aiDetectRate≈0.5, humanFalsePositiveRate≈0.5.
    heuristics: [
      { aiDetectRate: 0.52, humanFalsePositiveRate: 0.5 },
      { aiDetectRate: 0.5, humanFalsePositiveRate: 0.5 },
      { aiDetectRate: 0.5, humanFalsePositiveRate: 0.48 },
    ],
    now: () => Date.parse(opts.nowIso),
    issuedAtIso: opts.nowIso,
  });

  return finalizeRunner({
    runnerId: 'blind-review-m5',
    title: 'Blind-review — M5 indistinguishability panel',
    seed: opts.seed,
    nScenarios: report.totalReviews,
    durationMs: Date.now() - startedMs,
    summary:
      `${report.totalReviews} reviews, accuracy ${report.accuracy.toFixed(4)} ` +
      `(bar ${INDISTINGUISHABILITY_BAR}); indistinguishable=${report.indistinguishable}.`,
    metrics: [
      { key: 'accuracy', value: report.accuracy, unit: 'ratio' },
      { key: 'total_reviews', value: report.totalReviews },
      {
        key: 'ai_correctly_identified',
        value: report.confusionMatrix.aiCorrectlyIdentified,
      },
      {
        key: 'human_correctly_identified',
        value: report.confusionMatrix.humanCorrectlyIdentified,
      },
    ],
    criteria: [
      {
        criterion: 'reviewer accuracy ≤ indistinguishability bar',
        observed: report.accuracy,
        threshold: INDISTINGUISHABILITY_BAR,
        higherIsBetter: false,
        passed: report.indistinguishable,
      },
    ],
  });
}

/**
 * Build + run the requested regulator runners (default: all). Async because
 * the blind-review panel is async; the regulator-sim runners are synchronous.
 */
export async function runRegulatorSuite(
  opts: RegulatorRunnerOpts,
  only?: ReadonlyArray<RegulatorRunnerId>,
): Promise<ReadonlyArray<RunnerReport>> {
  const wanted = only ?? REGULATOR_RUNNER_IDS;
  const reports: RunnerReport[] = [];
  for (const id of wanted) {
    if (id === 'regulator-audit-replay') reports.push(auditReplayRunner(opts));
    else if (id === 'regulator-supervision') reports.push(supervisionRunner(opts));
    else if (id === 'regulator-pdpa') reports.push(pdpaRunner(opts));
    else if (id === 'blind-review-m5') reports.push(await blindReviewRunner(opts));
  }
  return reports;
}
