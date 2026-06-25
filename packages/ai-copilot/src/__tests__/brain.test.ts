/**
 * Brain smoke tests.
 *
 * Uses the MockAIProvider to drive a deterministic Orchestrator run-through.
 * Asserts the wiring: persona selection, handoff parsing, tool dispatch,
 * visibility enforcement, and advisor-gate short-circuiting.
 *
 * These are not quality tests (LLM quality is scored separately via the eval
 * harness on real models). They are structural regression tests for the
 * state machine and contracts.
 */

import { describe, it, expect } from 'vitest';
import {
  createBrainForTesting,
  PERSONA_IDS,
  parseHandoffDirective,
  parseProposedAction,
  classifyInitialTurn,
  reconcileMpesa,
  summarizeTraRoyalty,
  canSee,
  promoteScope,
  normalizeAccountRef,
  normalizePhone,
} from '../index.js';

describe('intent router', () => {
  it('routes maintenance keywords to Maintenance Junior', () => {
    const intent = classifyInitialTurn('tenant reports a water leak in unit A-5');
    expect(intent.personaId).toBe(PERSONA_IDS.JUNIOR_MAINTENANCE);
    expect(intent.confidence).toBeGreaterThan(0.5);
  });

  it('routes finance/arrears keywords to Finance Junior', () => {
    const intent = classifyInitialTurn('who is in arrears over 30 days');
    expect(intent.personaId).toBe(PERSONA_IDS.JUNIOR_FINANCE);
  });

  it('defaults to Estate Manager when ambiguous', () => {
    const intent = classifyInitialTurn('give me an overview of the portfolio');
    expect(intent.personaId).toBe(PERSONA_IDS.ESTATE_MANAGER);
  });
});

describe('directive parsers', () => {
  it('parses HANDOFF_TO + OBJECTIVE', () => {
    const d = parseHandoffDirective(
      'Some response text.\nHANDOFF_TO: junior.finance\nOBJECTIVE: Draft arrears notice'
    );
    expect(d?.targetPersonaId).toBe('junior.finance');
    expect(d?.objective).toBe('Draft arrears notice');
  });

  it('parses PROPOSED_ACTION with risk', () => {
    const a = parseProposedAction(
      'blah\nPROPOSED_ACTION: draft eviction-notice-C-7 [risk:HIGH]'
    );
    expect(a?.verb).toBe('draft');
    expect(a?.riskLevel).toBe('HIGH');
  });

  it('returns null when no directive present', () => {
    expect(parseHandoffDirective('no directives here')).toBeNull();
    expect(parseProposedAction('no directives here')).toBeNull();
  });
});

describe('visibility', () => {
  it('admin sees everything', () => {
    expect(
      canSee(
        { scope: 'private', authorActorId: 'x', initiatingUserId: 'y' },
        { userId: 'z', roles: [], teamIds: [], isAdmin: true }
      )
    ).toBe(true);
  });
  it('team scope reaches team members', () => {
    expect(
      canSee(
        { scope: 'team', authorActorId: 'x', teamId: 'T1' },
        { userId: 'm', roles: [], teamIds: ['T1'] }
      )
    ).toBe(true);
  });
  it('private stays private', () => {
    expect(
      canSee(
        { scope: 'private', authorActorId: 'x', initiatingUserId: 'y' },
        { userId: 'random', roles: [], teamIds: [] }
      )
    ).toBe(false);
  });
  it('promoteScope refuses to narrow', () => {
    expect(() =>
      promoteScope(
        { scope: 'management', authorActorId: 'x' },
        'private',
        'narrowing'
      )
    ).toThrow();
  });
});

describe('M-Pesa reconciliation', () => {
  it('normalizes account refs and phones', () => {
    expect(normalizeAccountRef('Unit-A 12')).toBe('UNITA12');
    expect(normalizePhone('0712345678')).toBe('254712345678');
    expect(normalizePhone('+254712345678')).toBe('254712345678');
  });

  it('matches exact account refs', () => {
    const r = reconcileMpesa({
      rows: [
        {
          transactionId: 'TX1',
          transactionDate: '2026-03-05',
          amountKes: 45_000,
          channel: 'paybill',
          accountRef: 'A-12',
          payerPhone: '0712000001',
        },
      ],
      expected: [
        {
          id: 'E1',
          accountRef: 'A12',
          amountKes: 45_000,
          dueDate: '2026-03-05',
        },
      ],
      amountToleranceKes: 0,
      windowDays: 7,
    });
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].method).toBe('exact_acc');
    expect(r.summary.matchRate).toBe(1);
  });

  it('leaves truly unmatched rows in unmatchedInbound', () => {
    const r = reconcileMpesa({
      rows: [
        {
          transactionId: 'TX1',
          transactionDate: '2026-03-05',
          amountKes: 10,
          channel: 'paybill',
          accountRef: 'NOPE',
        },
      ],
      expected: [],
      amountToleranceKes: 0,
      windowDays: 7,
    });
    expect(r.unmatchedInbound).toHaveLength(1);
    expect(r.summary.matchRate).toBe(0);
  });
});

describe('TRA royalty summary', () => {
  it('applies royalty at 7% under threshold', () => {
    const r = summarizeTraRoyalty({
      receipts: [
        {
          ownerId: 'O1',
          assetId: 'P1',
          month: '2026-03',
          amountTzs: 100_000,
          collectedAsAgent: false,
        },
      ],
      month: '2026-03',
      rate: 0.07,
      annualThresholdTzs: 15_000_000_000,
      trailingGrossByOwner: {},
    });
    expect(r.owners[0].royaltyDueTzs).toBeCloseTo(7_000);
    expect(r.owners[0].withinStandardThreshold).toBe(true);
  });

  it('withholds 7% when collected as agent', () => {
    const r = summarizeTraRoyalty({
      receipts: [
        {
          ownerId: 'O1',
          assetId: 'P1',
          month: '2026-03',
          amountTzs: 100_000,
          collectedAsAgent: true,
        },
      ],
      month: '2026-03',
      rate: 0.07,
      annualThresholdTzs: 15_000_000_000,
      trailingGrossByOwner: {},
    });
    expect(r.owners[0].withheldByAgentTzs).toBeCloseTo(7_000);
    expect(r.owners[0].netPayableByOwnerTzs).toBe(0);
  });

  it('flags owners over the annual threshold', () => {
    const r = summarizeTraRoyalty({
      receipts: [
        {
          ownerId: 'O1',
          assetId: 'P1',
          month: '2026-03',
          amountTzs: 2_000_000_000,
          collectedAsAgent: false,
        },
      ],
      month: '2026-03',
      rate: 0.07,
      annualThresholdTzs: 15_000_000_000,
      trailingGrossByOwner: { O1: 14_000_000_000 },
    });
    expect(r.owners[0].exceedsThreshold).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('Brain wiring', () => {
  it('creates a Brain with mock providers and registers default skills', () => {
    const brain = createBrainForTesting();
    expect(brain.orchestrator).toBeTruthy();
    expect(brain.personas.list()).toHaveLength(12); // 7 juniors + EM + 2 coworkers + migration + counterparty-assistant + owner-advisor
    expect(brain.tools.has('skill.kenya.mpesa_reconcile')).toBe(true);
    expect(brain.tools.has('skill.kenya.tra_royalty_summary')).toBe(true);
  });

  it('starts a thread and returns a turn result (mock provider)', async () => {
    const brain = createBrainForTesting();
    const result = await brain.orchestrator.startThread({
      tenant: {
        tenantId: 'T',
        tenantName: 'Test',
        environment: 'development',
      },
      actor: {
        type: 'user',
        id: 'U',
        roles: ['admin'],
      },
      viewer: {
        userId: 'U',
        roles: ['admin'],
        teamIds: [],
        isAdmin: true,
      },
      initialUserText: 'water leak in unit A-5',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.thread.id).toBeTruthy();
      expect(result.data.turn.finalPersonaId).toBeTruthy();
    }
  });
});
