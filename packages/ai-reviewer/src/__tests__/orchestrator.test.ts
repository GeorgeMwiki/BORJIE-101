import { describe, it, expect } from 'vitest';
import { createAIReviewer } from '../orchestrator.js';
import { ctx } from './fixtures.js';
import {
  fakeAudit,
  fakeAuditThrowing,
  fakeBrain,
  fakeCoachBrain,
} from './test-doubles.js';
import type { ReviewRequest } from '../types.js';

function req(kind: ReviewRequest['kind'], payload: Readonly<Record<string, unknown>>): ReviewRequest {
  return { kind, payload, context: ctx };
}

describe('createAIReviewer.review()', () => {
  it('returns reject_final + skips brain when red-lines fire', async () => {
    const brain = fakeBrain({
      verdict: 'approve',
      confidence: 1,
      reasons: [],
      suggestedFixes: [],
    });
    const audit = fakeAudit();
    const reviewer = createAIReviewer({ brain, audit });
    const decision = await reviewer.review(
      req('photo_add', {
        photos: [{ filename: 'huge.jpg', mime: 'image/jpeg', bytes: 25 * 1024 * 1024 }],
      }),
    );
    expect(decision.verdict).toBe('reject_final');
    expect(brain.calls.length).toBe(0);
    expect(audit.records.length).toBe(1);
    expect(audit.records[0]?.brainInvoked).toBe(false);
    expect(audit.records[0]?.redLineIssueCount).toBeGreaterThan(0);
  });

  it('returns reject_with_changes when pre-checks block + skips brain', async () => {
    const brain = fakeBrain({
      verdict: 'approve',
      confidence: 1,
      reasons: [],
      suggestedFixes: [],
    });
    const audit = fakeAudit();
    const reviewer = createAIReviewer({ brain, audit });
    const decision = await reviewer.review(req('parcel_edit', {})); // no parcelId
    expect(decision.verdict).toBe('reject_with_changes');
    expect(decision.reasons.some((r) => r.code === 'parcel.id.missing')).toBe(true);
    expect(brain.calls.length).toBe(0);
    expect(audit.records[0]?.brainInvoked).toBe(false);
    expect(audit.records[0]?.preCheckIssueCount).toBeGreaterThan(0);
  });

  it('calls brain when red-lines + pre-checks are clean', async () => {
    const brain = fakeBrain({
      verdict: 'approve',
      confidence: 0.95,
      reasons: [],
      suggestedFixes: [],
    });
    const audit = fakeAudit();
    const reviewer = createAIReviewer({ brain, audit });
    const decision = await reviewer.review(
      req('parcel_edit', { parcelId: 'p1', newName: 'Parcel A' }),
    );
    expect(decision.verdict).toBe('approve');
    expect(brain.calls.length).toBe(1);
    expect(audit.records[0]?.brainInvoked).toBe(true);
  });

  it('rejects unknown workflow kind as reject_final without calling brain', async () => {
    const brain = fakeBrain({
      verdict: 'approve',
      confidence: 1,
      reasons: [],
      suggestedFixes: [],
    });
    const audit = fakeAudit();
    const reviewer = createAIReviewer({ brain, audit });
    const decision = await reviewer.review({
      kind: 'invented_kind' as never,
      payload: {},
      context: ctx,
    });
    expect(decision.verdict).toBe('reject_final');
    expect(decision.reasons[0]?.code).toBe('request.kind.unknown');
    expect(brain.calls.length).toBe(0);
    expect(audit.records.length).toBe(1);
  });

  it('emits exactly one audit record per review call (red-line path)', async () => {
    const brain = fakeBrain({ verdict: 'approve', confidence: 1, reasons: [], suggestedFixes: [] });
    const audit = fakeAudit();
    const reviewer = createAIReviewer({ brain, audit });
    await reviewer.review(
      req('photo_add', {
        photos: [{ filename: 'huge.jpg', mime: 'image/jpeg', bytes: 25 * 1024 * 1024 }],
      }),
    );
    expect(audit.records.length).toBe(1);
  });

  it('emits exactly one audit record per review call (pre-check path)', async () => {
    const brain = fakeBrain({ verdict: 'approve', confidence: 1, reasons: [], suggestedFixes: [] });
    const audit = fakeAudit();
    const reviewer = createAIReviewer({ brain, audit });
    await reviewer.review(req('parcel_edit', {}));
    expect(audit.records.length).toBe(1);
  });

  it('emits exactly one audit record per review call (brain path)', async () => {
    const brain = fakeBrain({ verdict: 'approve', confidence: 0.9, reasons: [], suggestedFixes: [] });
    const audit = fakeAudit();
    const reviewer = createAIReviewer({ brain, audit });
    await reviewer.review(req('parcel_edit', { parcelId: 'p1' }));
    expect(audit.records.length).toBe(1);
  });

  it('audit record carries verdict, confidence, counts, brainInvoked', async () => {
    const brain = fakeBrain({
      verdict: 'reject_with_changes',
      confidence: 0.6,
      reasons: [
        { code: 'r1', message: 'm1', severity: 'error' },
        { code: 'r2', message: 'm2', severity: 'warning' },
      ],
      suggestedFixes: [],
    });
    const audit = fakeAudit();
    const reviewer = createAIReviewer({ brain, audit });
    await reviewer.review(req('parcel_edit', { parcelId: 'p1' }));
    const rec = audit.records[0];
    expect(rec?.verdict).toBe('reject_with_changes');
    expect(rec?.confidence).toBeCloseTo(0.6);
    expect(rec?.reasonCount).toBe(2);
    expect(rec?.brainInvoked).toBe(true);
    expect(rec?.tenantId).toBe('tenant_test');
    expect(rec?.actorUserId).toBe('user_test');
    expect(rec?.correlationId).toBe('corr_test');
  });

  it('does NOT throw when audit port fails — decision still returned', async () => {
    const brain = fakeBrain({ verdict: 'approve', confidence: 1, reasons: [], suggestedFixes: [] });
    const audit = fakeAuditThrowing();
    const reviewer = createAIReviewer({ brain, audit });
    const decision = await reviewer.review(req('parcel_edit', { parcelId: 'p1' }));
    expect(decision.verdict).toBe('approve');
  });

  it('coach() returns heuristic hints from the policy', async () => {
    const brain = fakeBrain({ verdict: 'approve', confidence: 1, reasons: [], suggestedFixes: [] });
    const audit = fakeAudit();
    const reviewer = createAIReviewer({ brain, audit });
    const hints = await reviewer.coach({
      kind: 'po_approval',
      partialPayload: {},
      context: ctx,
    });
    expect(hints.length).toBeGreaterThan(0);
  });

  it('coach() returns empty array for unknown kind', async () => {
    const brain = fakeBrain({ verdict: 'approve', confidence: 1, reasons: [], suggestedFixes: [] });
    const audit = fakeAudit();
    const reviewer = createAIReviewer({ brain, audit });
    const hints = await reviewer.coach({
      kind: 'invented_kind' as never,
      partialPayload: {},
      context: ctx,
    });
    expect(hints).toEqual([]);
  });

  it('coach() can use optional coach brain', async () => {
    const brain = fakeBrain({ verdict: 'approve', confidence: 1, reasons: [], suggestedFixes: [] });
    const coachBrain = fakeCoachBrain([
      { id: 'h1', tone: 'hint', title: 'Try this', body: 'Body' },
    ]);
    const audit = fakeAudit();
    const reviewer = createAIReviewer({ brain, audit, coachBrain });
    const hints = await reviewer.coach({
      kind: 'metadata_update',
      partialPayload: { entityId: 'e1', tagsToAdd: ['ok'] },
      context: ctx,
    });
    expect(hints[0]?.id).toBe('h1');
    expect(coachBrain.calls.length).toBe(1);
  });
});
