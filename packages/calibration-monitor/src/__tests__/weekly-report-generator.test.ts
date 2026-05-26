import { describe, it, expect } from 'vitest';
import { createObservationRecorder } from '../collection/observation-recorder.js';
import { createOutcomeResolver } from '../collection/outcome-resolver.js';
import { createWeeklyReportGenerator } from '../reporting/weekly-report-generator.js';
import { createInMemoryObservationRepository } from '../storage/observation-repository.js';
import { createInMemoryReportRepository } from '../storage/report-repository.js';
import { createInMemoryAuditChain } from '../audit/audit-chain-link.js';
import { type CalibrationWriteContext } from '../types.js';

const ctxAt = (iso: string): CalibrationWriteContext => ({
  tenant_id: 't1',
  now: () => new Date(iso),
});

describe('weekly-report-generator', () => {
  it('returns null when no observations have resolved in the window', async () => {
    const observations = createInMemoryObservationRepository();
    const reports = createInMemoryReportRepository();
    const audit = createInMemoryAuditChain();
    const generate = createWeeklyReportGenerator({
      observations,
      reports,
      audit,
    });

    const report = await generate(ctxAt('2026-05-26T02:00:00Z'), {
      prediction_kind: 'mining_licence_renewal',
    });
    expect(report).toBeNull();
  });

  it('emits Brier + ECE + reliability diagram over resolved rows', async () => {
    const observations = createInMemoryObservationRepository();
    const reports = createInMemoryReportRepository();
    const audit = createInMemoryAuditChain();
    const record = createObservationRecorder({ repo: observations, audit });
    const resolve = createOutcomeResolver({ repo: observations, audit });
    const generate = createWeeklyReportGenerator({
      observations,
      reports,
      audit,
    });

    const t0 = '2026-05-22T10:00:00Z';
    const t1 = '2026-05-23T10:00:00Z';

    // 4 observations across the window — all at 0.8 confidence;
    // 3 succeed → empirical accuracy 0.75 in bin 0.8–0.9.
    const ids = ['lic-1', 'lic-2', 'lic-3', 'lic-4'];
    for (const id of ids) {
      await record(ctxAt(t0), {
        prediction_kind: 'mining_licence_renewal',
        entity_id: id,
        predicted_confidence: 0.8,
        predicted_label: 'approve',
      });
    }
    await resolve(ctxAt(t1), {
      prediction_kind: 'mining_licence_renewal',
      entity_id: 'lic-1',
      outcome_label: 'approved',
      outcome_value: 1,
    });
    await resolve(ctxAt(t1), {
      prediction_kind: 'mining_licence_renewal',
      entity_id: 'lic-2',
      outcome_label: 'approved',
      outcome_value: 1,
    });
    await resolve(ctxAt(t1), {
      prediction_kind: 'mining_licence_renewal',
      entity_id: 'lic-3',
      outcome_label: 'approved',
      outcome_value: 1,
    });
    await resolve(ctxAt(t1), {
      prediction_kind: 'mining_licence_renewal',
      entity_id: 'lic-4',
      outcome_label: 'rejected',
      outcome_value: 0,
    });

    const report = await generate(ctxAt('2026-05-26T02:00:00Z'), {
      prediction_kind: 'mining_licence_renewal',
    });
    expect(report).not.toBeNull();
    expect(report?.sample_size).toBe(4);
    // Brier = mean of [(0.8-1)^2 x3, (0.8-0)^2] = (0.04*3 + 0.64)/4 = 0.19
    expect(report?.brier_score).toBeCloseTo(0.19, 8);
    // Bin 0.8–0.9: conf=0.8, acc=0.75, gap=0.05, weight=1 → ECE=0.05
    expect(report?.ece).toBeCloseTo(0.05, 8);
    expect(report?.reliability_diagram).toHaveLength(10);
  });

  it('excludes observations resolved outside the window', async () => {
    const observations = createInMemoryObservationRepository();
    const reports = createInMemoryReportRepository();
    const audit = createInMemoryAuditChain();
    const record = createObservationRecorder({ repo: observations, audit });
    const resolve = createOutcomeResolver({ repo: observations, audit });
    const generate = createWeeklyReportGenerator({
      observations,
      reports,
      audit,
    });

    // Resolved well before the 7-day window.
    await record(ctxAt('2026-05-01T10:00:00Z'), {
      prediction_kind: 'k',
      entity_id: 'e',
      predicted_confidence: 0.6,
      predicted_label: 'approve',
    });
    await resolve(ctxAt('2026-05-02T10:00:00Z'), {
      prediction_kind: 'k',
      entity_id: 'e',
      outcome_label: 'ok',
      outcome_value: 1,
    });

    const report = await generate(ctxAt('2026-05-26T02:00:00Z'), {
      prediction_kind: 'k',
    });
    expect(report).toBeNull();
  });
});
