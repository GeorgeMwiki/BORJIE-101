/**
 * Regulator simulation — audit replay.
 *
 * Given a date range, replays every mining licence / royalty / payout
 * decision and asserts:
 *   1. Chain-of-thought trace is present
 *   2. Bilingual reason notes (English + Swahili)
 *   3. Model id is registered
 *   4. Model card was reviewed within the allowed window
 *   5. All reason codes are in the allowed list
 *   6. Cross-org actions had two distinct approvers (four-eye)
 *   7. Fairness deltas are within tolerance
 *
 * Returns structured findings; never throws on a finding so the harness
 * produces a complete audit report in one pass.
 */

import type {
  AuditFinding,
  AuditReplayInput,
  AuditReplayResult,
  DecisionRecord,
} from './types.js';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function withinWindow(iso: string, fromIso: string, toIso: string): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t >= Date.parse(fromIso) && t <= Date.parse(toIso);
}

function modelCardAgeDays(record: DecisionRecord, nowIso: string): number {
  const t = Date.parse(record.modelCardCurrentAt);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.parse(nowIso) - t) / MS_PER_DAY);
}

function checkOne(
  rec: DecisionRecord,
  input: AuditReplayInput,
  nowIso: string,
): ReadonlyArray<AuditFinding> {
  const out: AuditFinding[] = [];

  if (!rec.cotTrace || rec.cotTrace.trim().length === 0) {
    out.push({
      decisionId: rec.decisionId,
      code: 'missing_cot',
      severity: 'critical',
      detail: 'no chain-of-thought trace recorded',
    });
  }

  if (!rec.reasonNotesEn?.trim() || !rec.reasonNotesSw?.trim()) {
    out.push({
      decisionId: rec.decisionId,
      code: 'missing_bilingual_notes',
      severity: 'high',
      detail: 'reason notes must be present in both English and Swahili',
    });
  }

  if (!input.registeredModelIds.includes(rec.modelId)) {
    out.push({
      decisionId: rec.decisionId,
      code: 'unknown_model',
      severity: 'critical',
      detail: `model ${rec.modelId} is not in the registry`,
    });
  }

  const ageDays = modelCardAgeDays(rec, nowIso);
  if (ageDays > input.modelCardMaxAgeDays) {
    out.push({
      decisionId: rec.decisionId,
      code: 'stale_model_card',
      severity: 'high',
      detail: `model card age ${ageDays}d exceeds ${input.modelCardMaxAgeDays}d`,
    });
  }

  for (const code of rec.reasonCodes) {
    if (!input.allowedReasonCodes.includes(code)) {
      out.push({
        decisionId: rec.decisionId,
        code: 'disallowed_reason_code',
        severity: 'high',
        detail: `reason ${code} not in the allowed list`,
      });
    }
  }

  if (rec.crossOrgAction) {
    const distinct = new Set(rec.approverIds).size;
    if (distinct < 2) {
      out.push({
        decisionId: rec.decisionId,
        code: 'missing_four_eye',
        severity: 'critical',
        detail: `cross-org action has ${distinct} distinct approver(s)`,
      });
    }
  }

  if (
    Math.abs(rec.fairnessTpDelta) > input.fairnessTolerance ||
    Math.abs(rec.fairnessFpDelta) > input.fairnessTolerance
  ) {
    out.push({
      decisionId: rec.decisionId,
      code: 'fairness_breach',
      severity: 'high',
      detail: `tp_delta=${rec.fairnessTpDelta} fp_delta=${rec.fairnessFpDelta} tol=${input.fairnessTolerance}`,
    });
  }

  return out;
}

export function replayAudit(
  input: AuditReplayInput,
  nowIso: string = new Date().toISOString(),
): AuditReplayResult {
  const inWindow = input.records.filter((r) =>
    withinWindow(r.decidedAt, input.fromIso, input.toIso),
  );

  const findings = inWindow.flatMap((r) => checkOne(r, input, nowIso));

  return {
    windowFrom: input.fromIso,
    windowTo: input.toIso,
    recordsReplayed: inWindow.length,
    findings,
    passed: findings.length === 0,
  };
}

/** One-line summary suitable for a CI log line. */
export function summarizeAudit(result: AuditReplayResult): string {
  if (result.passed) {
    return `audit: ${result.recordsReplayed} records, 0 findings (PASS)`;
  }
  const counts = result.findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.code] = (acc[f.code] ?? 0) + 1;
    return acc;
  }, {});
  return `audit: ${result.recordsReplayed} records, ${result.findings.length} findings ${JSON.stringify(counts)} (FAIL)`;
}
