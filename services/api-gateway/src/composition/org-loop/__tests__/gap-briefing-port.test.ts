/**
 * gap-briefing-port.test.ts — locks the OWNER-BRIEFING stage contract:
 *
 *   1. the EN brief is a MINTO pyramid: conclusion (the gap) → evidence
 *      (the matcher reasons + % fit) → action (assign to <name>) → need
 *      ("Approve?").
 *   2. the proposal rides the gated EstateProposal shape: drive-keyed
 *      dedupe id (`drive:<id>`, falling back to `gap:<commitmentId>`),
 *      evidence threaded, locale stamped.
 *   3. SINGLE-LANGUAGE: an `sw` brief contains ZERO EN scaffold tokens and
 *      an `en` brief contains ZERO SW scaffold tokens (no mixing — ever).
 */

import { describe, expect, it } from 'vitest';

import {
  createGapBriefingPort,
  briefProposalId,
  type OrgLoopRunView,
} from '../gap-briefing-port.js';

function run(overrides: Partial<OrgLoopRunView> = {}): OrgLoopRunView {
  return {
    tenantId: 'tenant_1',
    commitmentId: 'cmt_99',
    driveId: 'compliance-pressure',
    gapKind: null,
    competenceDomain: 'compliance',
    strategy: {
      title: 'Licence renewal is overdue',
      competenceDomain: 'compliance',
      priority: 'urgent',
      urgency: 'critical',
      rationale: 'It blocks new permits',
    },
    chosenEmployee: {
      employeeId: 'emp_7',
      displayName: 'Asha',
      matchConfidence: 0.82,
      matchReasons: {
        en: ['cert match', 'low load'],
        sw: ['cheti kinafanana', 'mzigo mdogo'],
      },
    },
    evidenceIds: ['ev_a', 'ev_b'],
    proposedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

describe('createGapBriefingPort — EN pyramid brief', () => {
  it('leads with conclusion, then evidence + action, then the ask', () => {
    const port = createGapBriefingPort();
    const proposal = port.brief(run(), 'en');
    expect(proposal.title).toBe('Licence renewal is overdue');
    // conclusion
    expect(proposal.rationale).toContain('Licence renewal is overdue');
    expect(proposal.rationale).toContain('compliance');
    // action + evidence
    expect(proposal.rationale).toContain('assign it to Asha');
    expect(proposal.rationale).toContain('82% fit');
    expect(proposal.rationale).toContain('cert match, low load');
    // need
    expect(proposal.rationale.trim().endsWith('Approve?')).toBe(true);
  });

  it('rides the gated EstateProposal shape with a drive-keyed dedupe id', () => {
    const port = createGapBriefingPort();
    const proposal = port.brief(run(), 'en');
    expect(proposal.id).toBe('drive:compliance-pressure');
    expect(proposal.tenantId).toBe('tenant_1');
    expect(proposal.locale).toBe('en');
    expect(proposal.urgency).toBe('critical');
    expect(proposal.evidenceEntityIds).toEqual(['ev_a', 'ev_b']);
    expect(proposal.proposedAtMs).toBe(1_700_000_000_000);
  });

  it('falls back to a gap-keyed dedupe id when there is no drive', () => {
    expect(briefProposalId(run({ driveId: null }))).toBe('gap:cmt_99');
    const port = createGapBriefingPort();
    const proposal = port.brief(run({ driveId: null }), 'en');
    expect(proposal.id).toBe('gap:cmt_99');
  });

  it('names the employee id when no display name is present', () => {
    const port = createGapBriefingPort();
    const proposal = port.brief(
      run({ chosenEmployee: { employeeId: 'emp_7', matchConfidence: 0.5 } }),
      'en',
    );
    expect(proposal.rationale).toContain('emp_7');
  });
});

describe('createGapBriefingPort — SINGLE-LANGUAGE (no EN/SW mixing)', () => {
  // EN scaffold tokens that must NEVER appear in an sw brief.
  const EN_SCAFFOLD = ['assign it to', 'fit', 'Approve?', 'priority', 'compliance'];
  // SW scaffold tokens that must NEVER appear in an en brief.
  const SW_SCAFFOLD = ['Napanga kumkabidhi', 'ulinganifu', 'Idhinisha?', 'kipaumbele', 'uzingatiaji'];

  it('an sw brief contains zero EN scaffold tokens', () => {
    const port = createGapBriefingPort();
    // Use an SW-authored strategy title so the conclusion is single-language too.
    const proposal = port.brief(
      run({
        strategy: {
          title: 'Upyaishaji wa leseni umechelewa',
          competenceDomain: 'compliance',
          priority: 'urgent',
          urgency: 'critical',
          rationale: 'Unazuia vibali vipya',
        },
      }),
      'sw',
    );
    expect(proposal.locale).toBe('sw');
    for (const token of EN_SCAFFOLD) {
      expect(proposal.rationale).not.toContain(token);
    }
    // The SW scaffold IS present.
    expect(proposal.rationale).toContain('Napanga kumkabidhi');
    expect(proposal.rationale).toContain('Idhinisha?');
    expect(proposal.rationale).toContain('uzingatiaji');
  });

  it('an en brief contains zero SW scaffold tokens', () => {
    const port = createGapBriefingPort();
    const proposal = port.brief(run(), 'en');
    for (const token of SW_SCAFFOLD) {
      expect(proposal.rationale).not.toContain(token);
    }
  });

  it('defaults to en when no locale is passed', () => {
    const port = createGapBriefingPort();
    const proposal = port.brief(run());
    expect(proposal.locale).toBe('en');
    expect(proposal.rationale).toContain('Approve?');
  });
});
