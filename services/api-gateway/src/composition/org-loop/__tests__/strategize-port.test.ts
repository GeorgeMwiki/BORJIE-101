/**
 * strategize-port.test.ts — locks the STRATEGIZE stage contract:
 *
 *   1. deterministic competence-domain resolution: the gap's stamped
 *      `competenceDomain` wins; else a keyword lookup (compliance/safety/
 *      treasury beat the workforce default); else workforce.
 *   2. urgency/priority mapping: sovereign + overdue → critical/urgent;
 *      breachSeverity bands; lifecycle fallbacks.
 *   3. evidence ids thread straight through (Auditor evidence rail).
 *   4. an injected reasoning port composes the strategy; a throwing /
 *      null-returning port falls back to the deterministic mapping
 *      (honest degrade, never a throw).
 */

import { describe, expect, it } from 'vitest';
import type { MdCommitment } from '@borjie/database/repositories';

import {
  createStrategizePort,
  resolveCompetenceDomain,
  deriveUrgency,
  urgencyToPriority,
  MINING_COMPETENCE_DOMAINS,
  type ReasoningPort,
} from '../strategize-port.js';

// ─────────────────────────────────────────────────────────────────────
// A minimal MdCommitment builder — only the fields the port reads matter;
// the rest are filled with inert defaults so the type is satisfied.
// ─────────────────────────────────────────────────────────────────────

function commitment(overrides: Partial<MdCommitment> = {}): MdCommitment {
  return {
    id: 'cmt_1',
    tenantId: 'tenant_1',
    ownerId: 'mwikila',
    threadId: null,
    class: 'next_action',
    kind: 'general',
    title: 'Do the thing',
    titleSw: 'Fanya jambo',
    rationale: 'because it matters',
    evidenceIds: ['ev_1', 'ev_2'],
    triggerKind: 'event',
    triggerSpec: {},
    triggerDueAtMs: null,
    status: 'open',
    rungLevel: 0,
    sovereign: false,
    lastNudgedAtMs: null,
    ackedAtMs: null,
    confirmedAtMs: null,
    confirmationKind: null,
    blockedReason: null,
    attemptCount: 0,
    attemptFailedCount: 0,
    gapAuditSeq: 0,
    auditChainHash: null,
    idempotencyKey: 'idem_1',
    gapKind: null,
    blockedBy: [],
    unblockTrigger: null,
    competenceDomain: null,
    createdAtMs: 0,
    updatedAtMs: 0,
    ...overrides,
  } as MdCommitment;
}

describe('resolveCompetenceDomain', () => {
  it('honours the stamped competenceDomain when it is a pack domain', () => {
    expect(resolveCompetenceDomain(commitment({ competenceDomain: 'treasury' }))).toBe(
      'treasury',
    );
  });

  it('ignores a stamped domain that is not in the pack and falls to keywords', () => {
    expect(
      resolveCompetenceDomain(
        commitment({ competenceDomain: 'not-a-domain', title: 'Licence renewal overdue' }),
      ),
    ).toBe('compliance');
  });

  it('routes a licence/royalty gap to compliance', () => {
    expect(
      resolveCompetenceDomain(commitment({ title: 'Royalty filing due to the regulator' })),
    ).toBe('compliance');
  });

  it('routes a safety incident to safety', () => {
    expect(
      resolveCompetenceDomain(commitment({ kind: 'safety.incident', title: 'Hazard reported' })),
    ).toBe('safety');
  });

  it('routes an equipment breakdown to maintenance', () => {
    expect(
      resolveCompetenceDomain(commitment({ rationale: 'the pump breakdown needs repair' })),
    ).toBe('maintenance');
  });

  it('defaults to workforce when nothing resolves', () => {
    expect(resolveCompetenceDomain(commitment({ title: 'xyzzy', rationale: 'plugh' }))).toBe(
      'workforce',
    );
  });

  it('only ever returns a pack domain', () => {
    const d = resolveCompetenceDomain(commitment({ title: 'transport haul dispatch' }));
    expect(MINING_COMPETENCE_DOMAINS).toContain(d);
  });
});

describe('deriveUrgency / urgencyToPriority', () => {
  it('sovereign → critical → urgent', () => {
    const u = deriveUrgency(commitment({ sovereign: true }));
    expect(u).toBe('critical');
    expect(urgencyToPriority(u)).toBe('urgent');
  });

  it('overdue → critical', () => {
    expect(deriveUrgency(commitment({ status: 'overdue' }))).toBe('critical');
  });

  it('bands breachSeverity', () => {
    expect(deriveUrgency(commitment(), { breachSeverity: 0.8 })).toBe('critical');
    expect(deriveUrgency(commitment(), { breachSeverity: 0.6 })).toBe('high');
    expect(deriveUrgency(commitment(), { breachSeverity: 0.3 })).toBe('medium');
    expect(deriveUrgency(commitment(), { breachSeverity: 0.1 })).toBe('low');
  });

  it('an explicit drive-context urgency overrides', () => {
    expect(deriveUrgency(commitment({ sovereign: true }), { urgency: 'low' })).toBe('low');
  });

  it('blocked/reopened lean high without a severity signal', () => {
    expect(deriveUrgency(commitment({ status: 'blocked' }))).toBe('high');
    expect(deriveUrgency(commitment({ status: 'reopened' }))).toBe('high');
  });

  it('defaults to medium', () => {
    expect(deriveUrgency(commitment())).toBe('medium');
  });
});

describe('createStrategizePort — deterministic', () => {
  it('produces a mining-coherent task shape and threads evidence through', async () => {
    const port = createStrategizePort();
    const trace = await port.strategize(
      'tenant_1',
      commitment({
        title: 'Renew mining licence ML-204',
        rationale: 'It is overdue and blocks new permits',
        sovereign: true,
      }),
    );
    expect(trace.source).toBe('deterministic');
    expect(trace.taskShape.competenceDomain).toBe('compliance');
    expect(trace.taskShape.priority).toBe('urgent');
    expect(trace.urgency).toBe('critical');
    expect(trace.taskShape.title).toBe('Renew mining licence ML-204');
    expect(trace.taskShape.description).toContain('competence: compliance');
    expect(trace.evidenceIds).toEqual(['ev_1', 'ev_2']);
  });

  it('clamps an over-long title to assignTask bounds', async () => {
    const port = createStrategizePort();
    const trace = await port.strategize('t', commitment({ title: 'x'.repeat(600) }));
    expect(trace.taskShape.title.length).toBeLessThanOrEqual(500);
    expect(trace.taskShape.title.endsWith('...')).toBe(true);
  });
});

describe('createStrategizePort — reasoning port', () => {
  it('defers to an injected reasoning port', async () => {
    const reasoning: ReasoningPort = {
      async propose() {
        return {
          title: 'Brain-composed corrective',
          description: 'a deeper plan',
          priority: 'high',
          competenceDomain: 'production',
          rationale: 'brain reasoning',
          urgency: 'high',
        };
      },
    };
    const port = createStrategizePort({ reasoning });
    const trace = await port.strategize('t', commitment());
    expect(trace.source).toBe('reasoning');
    expect(trace.taskShape.title).toBe('Brain-composed corrective');
    expect(trace.taskShape.competenceDomain).toBe('production');
    expect(trace.urgency).toBe('high');
    // Evidence still threads from the commitment, not the brain.
    expect(trace.evidenceIds).toEqual(['ev_1', 'ev_2']);
  });

  it('falls back to deterministic when the reasoning port returns null', async () => {
    const reasoning: ReasoningPort = { async propose() { return null; } };
    const port = createStrategizePort({ reasoning });
    const trace = await port.strategize('t', commitment({ title: 'Safety hazard' }));
    expect(trace.source).toBe('deterministic');
    expect(trace.taskShape.competenceDomain).toBe('safety');
  });

  it('falls back to deterministic when the reasoning port throws (honest degrade)', async () => {
    const reasoning: ReasoningPort = {
      async propose() {
        throw new Error('brain timeout');
      },
    };
    const port = createStrategizePort({ reasoning });
    const trace = await port.strategize('t', commitment({ title: 'Pump repair' }));
    expect(trace.source).toBe('deterministic');
    expect(trace.taskShape.competenceDomain).toBe('maintenance');
  });
});
