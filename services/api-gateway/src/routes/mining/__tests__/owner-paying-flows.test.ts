/**
 * Pure-logic unit tests for the owner paying-user flow helpers:
 *   - licence-cockpit-projection.ts  (OW-5)
 *   - doc-chat-answer.ts             (OW-2)
 *   - onboarding-orchestrator.ts     (FLOW-2 step ladder + payload validation)
 *   - royalty-ledger.ts             (FLOW-3 currency scaling — pure part)
 *
 * These exercise the deterministic, IO-free cores so the money / projection /
 * answer logic is covered without a live Postgres (the route contract + ledger
 * post are integration-tested separately against a real DB).
 */

import { describe, it, expect } from 'vitest';

import {
  mapMineral,
  computeRenewalWindow,
  derivePayments,
  computeRenewalPack,
  dormancyCitation,
  buildLicenceCockpit,
  daysBetween,
  RENEWAL_WINDOW_DAYS,
  type LicenceEventInput,
} from '../licence-cockpit-projection';

import {
  tokenize,
  rankChunks,
  buildExtractiveAnswer,
} from '../doc-chat-answer';

import {
  nextStep,
  validateStepPayload,
  fileRefCount,
  isFileBearingStep,
  ONBOARDING_STEP_ORDER,
} from '../onboarding-orchestrator';

import { royaltyMajorToMinor } from '../../../services/royalty/royalty-ledger';

// ===========================================================================
// OW-5 — licence cockpit projection
// ===========================================================================

describe('licence-cockpit-projection (OW-5)', () => {
  it('maps DB mineral tokens onto the FE 3-value enum', () => {
    expect(mapMineral('Au')).toBe('gold');
    expect(mapMineral('gold')).toBe('gold');
    expect(mapMineral('Au+Cu')).toBe('gold'); // gold-bearing wins
    expect(mapMineral('tanzanite')).toBe('tanzanite');
    expect(mapMineral('Cu')).toBe('coltan');
    expect(mapMineral('coltan')).toBe('coltan');
    expect(mapMineral(null)).toBe('coltan');
  });

  it('computes the renewal window opening RENEWAL_WINDOW_DAYS before expiry', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const w = computeRenewalWindow('2026-12-31', now);
    expect(w.windowClosesAt).toBe(new Date('2026-12-31T00:00:00.000Z').toISOString());
    // opens 90 days earlier
    const opens = new Date('2026-12-31T00:00:00.000Z');
    opens.setUTCDate(opens.getUTCDate() - RENEWAL_WINDOW_DAYS);
    expect(w.windowOpensAt).toBe(opens.toISOString());
    expect(w.daysToWindow).toBe(daysBetween(now, opens));
    expect(w.daysToWindow).toBeGreaterThan(0);
  });

  it('returns honest-empty window when no expiry date', () => {
    const w = computeRenewalWindow(null, new Date());
    expect(w).toEqual({ windowOpensAt: '', windowClosesAt: '', daysToWindow: 0 });
  });

  it('clamps daysToWindow to 0 once the window is open/past', () => {
    const now = new Date('2026-12-30T00:00:00.000Z'); // inside the window
    const w = computeRenewalWindow('2026-12-31', now);
    expect(w.daysToWindow).toBe(0);
  });

  it('derives paid / overdue / due payment statuses from events', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const events: LicenceEventInput[] = [
      {
        kind: 'payment_due',
        summary: 'Annual fee',
        dueDate: '2026-03-01',
        status: 'completed',
        payload: { amount_tzs: 1_000_000 },
        closedAt: '2026-03-02T00:00:00.000Z',
        createdAt: '2026-02-01T00:00:00.000Z',
      },
      {
        kind: 'payment_due',
        summary: 'Inspection levy',
        dueDate: '2026-05-01', // past, not paid → overdue
        status: 'open',
        payload: { amount_tzs: 500_000 },
        closedAt: null,
        createdAt: '2026-04-01T00:00:00.000Z',
      },
      {
        kind: 'renewal_due',
        summary: 'Renewal fee',
        dueDate: '2026-09-01', // future, not paid → due
        status: 'open',
        payload: { amountTzs: 2_000_000 },
        closedAt: null,
        createdAt: '2026-05-15T00:00:00.000Z',
      },
      {
        // No amount → not a payment row.
        kind: 'inspection_scheduled',
        summary: 'Site inspection',
        dueDate: '2026-07-01',
        status: 'open',
        payload: {},
        closedAt: null,
        createdAt: '2026-05-20T00:00:00.000Z',
      },
    ];
    const payments = derivePayments(events, now);
    expect(payments).toHaveLength(3);
    const byDesc = Object.fromEntries(payments.map((p) => [p.description, p]));
    expect(byDesc['Annual fee']!.status).toBe('paid');
    expect(byDesc['Annual fee']!.amountTzs).toBe(1_000_000);
    expect(byDesc['Inspection levy']!.status).toBe('overdue');
    expect(byDesc['Renewal fee']!.status).toBe('due');
    expect(byDesc['Renewal fee']!.amountTzs).toBe(2_000_000);
  });

  it('scores the renewal pack from the obligations checklist', () => {
    const pack = computeRenewalPack({
      epp: true,
      eia: '2026-01-01',
      annual_fee_paid: 'receipt-123',
      // community_benefit + production_returns missing
    });
    expect(pack.renewalPackCompletePct).toBe(60); // 3 of 5
    expect(pack.renewalPackMissing).toContain('Community benefit agreement');
    expect(pack.renewalPackMissing).toContain('Production returns filed');
    expect(pack.renewalPackMissing).toHaveLength(2);
  });

  it('emits an honest dormancy citation by band', () => {
    expect(dormancyCitation(80)).toMatch(/HIGH risk/);
    expect(dormancyCitation(50)).toMatch(/moderate/);
    expect(dormancyCitation(10)).toMatch(/active/);
  });

  it('assembles the full cockpit projection', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const cockpit = buildLicenceCockpit({
      licence: {
        id: 'lic-1',
        number: 'PML-00123',
        mineral: 'Au',
        expiryDate: '2026-12-31',
        dormancyScore: 42,
        obligations: { epp: true },
      },
      siteName: 'Nyakabale Pit',
      events: [
        {
          kind: 'payment_due',
          summary: 'Annual fee',
          dueDate: '2026-03-01',
          status: 'completed',
          payload: { amount_tzs: 1_000_000 },
          closedAt: '2026-03-02T00:00:00.000Z',
          createdAt: '2026-02-01T00:00:00.000Z',
        },
      ],
      now,
    });
    expect(cockpit.id).toBe('lic-1');
    expect(cockpit.reference).toBe('PML-00123');
    expect(cockpit.mineral).toBe('gold');
    expect(cockpit.siteName).toBe('Nyakabale Pit');
    expect(cockpit.dormancyScore).toBe(42);
    expect(cockpit.payments).toHaveLength(1);
    expect(cockpit.renewalPackCompletePct).toBe(20); // 1 of 5
    expect(cockpit.daysToWindow).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================================================
// OW-2 — doc-chat extractive answer
// ===========================================================================

describe('doc-chat-answer (OW-2)', () => {
  it('tokenizes and drops stop-words / short words', () => {
    const toks = tokenize('What is the annual royalty rate for gold?');
    expect(toks).toContain('annual');
    expect(toks).toContain('royalty');
    expect(toks).toContain('rate');
    expect(toks).toContain('gold');
    expect(toks).not.toContain('the');
    expect(toks).not.toContain('is');
  });

  it('ranks chunks by question-token overlap, best first', () => {
    const ranked = rankChunks(
      [
        { id: 'c1', text: 'The annual royalty rate for gold is six percent.' },
        { id: 'c2', text: 'The site employs forty workers on two shifts.' },
        { id: 'c3', text: 'Royalty is payable monthly to the mining commission.' },
      ],
      'What is the gold royalty rate?',
    );
    expect(ranked[0]!.id).toBe('c1');
    expect(ranked.map((r) => r.id)).not.toContain('c2'); // zero overlap dropped
  });

  it('builds a cited EXTRACTIVE answer quoting the source (no fabrication)', () => {
    const out = buildExtractiveAnswer({
      chunks: [
        { id: 'c1', text: 'The annual royalty rate for gold is six percent (6%).' },
        { id: 'c2', text: 'Unrelated content about fuel logs.' },
      ],
      question: 'What is the gold royalty rate?',
      language: 'en',
    });
    expect(out.mode).toBe('extractive');
    expect(out.answer).toContain('six percent');
    expect(out.answer).toContain('Based on this document');
    expect(out.citedEvidenceIds).toContain('c1');
    expect(out.citedEvidenceIds).not.toContain('c2');
  });

  it('uses a single-language Swahili lead-in when language=sw (no mixing)', () => {
    const out = buildExtractiveAnswer({
      chunks: [{ id: 'c1', text: 'Kiwango cha mrabaha kwa dhahabu ni asilimia sita.' }],
      question: 'Kiwango cha mrabaha wa dhahabu ni kipi?',
      language: 'sw',
    });
    expect(out.answer).toContain('Kwa mujibu wa hati hii');
    expect(out.answer).not.toContain('Based on this document'); // never mixed
  });

  it('returns answer:null + no_evidence when nothing matches (honest)', () => {
    const out = buildExtractiveAnswer({
      chunks: [{ id: 'c1', text: 'Completely unrelated text.' }],
      question: 'zzzz qqqq vvvv',
      language: 'en',
    });
    expect(out.answer).toBeNull();
    expect(out.mode).toBe('no_evidence');
    expect(out.citedEvidenceIds).toHaveLength(0);
  });
});

// ===========================================================================
// FLOW-2 — onboarding step ladder + payload validation
// ===========================================================================

describe('onboarding-orchestrator (FLOW-2)', () => {
  it('advances through the step ladder and terminates at complete', () => {
    expect(nextStep('kyb')).toBe('licences');
    expect(nextStep('licences')).toBe('sites');
    expect(nextStep('sites')).toBe('drill_holes');
    expect(nextStep('drill_holes')).toBe('cockpit_seed');
    expect(nextStep('cockpit_seed')).toBe('complete');
  });

  it('validates the kyb payload and rejects a malformed one', () => {
    const ok = validateStepPayload('kyb', {
      companyName: 'Borjie Mining Ltd',
      registrationNo: 'RC-123',
      tin: '123-456-789',
      registeredAddress: 'Mwanza',
      directors: [{ fullName: 'Asha M', nidaId: 'NIDA-1', role: 'director' }],
    });
    expect((ok as { companyName: string }).companyName).toBe('Borjie Mining Ltd');
    expect(() => validateStepPayload('kyb', { companyName: '' })).toThrow();
  });

  it('validates file-bearing step payloads (licences/sites/drill_holes)', () => {
    expect(() =>
      validateStepPayload('licences', { licences: [{ name: 'PML.pdf' }] }),
    ).not.toThrow();
    expect(() => validateStepPayload('licences', { licences: [] })).toThrow();
    expect(() =>
      validateStepPayload('drill_holes', { rows: [{ name: 'batch.csv' }] }),
    ).not.toThrow();
  });

  it('counts file refs + flags file-bearing steps', () => {
    expect(fileRefCount('licences', { licences: [{ name: 'a' }, { name: 'b' }] })).toBe(2);
    expect(fileRefCount('sites', { sites: [{ name: 'a' }] })).toBe(1);
    expect(fileRefCount('drill_holes', { rows: [{ name: 'a' }] })).toBe(1);
    expect(fileRefCount('kyb', {})).toBe(0);
    expect(isFileBearingStep('licences')).toBe(true);
    expect(isFileBearingStep('kyb')).toBe(false);
    expect(isFileBearingStep('cockpit_seed')).toBe(false);
  });

  it('exposes the canonical step order', () => {
    expect([...ONBOARDING_STEP_ORDER]).toEqual([
      'kyb',
      'licences',
      'sites',
      'drill_holes',
      'cockpit_seed',
    ]);
  });
});

// ===========================================================================
// FLOW-3 — royalty currency scaling (pure)
// ===========================================================================

describe('royalty-ledger currency scaling (FLOW-3)', () => {
  it('scales TZS (0-decimal) major units 1:1 to minor units', () => {
    expect(royaltyMajorToMinor(24_720_000, 'TZS' as never)).toBe(24_720_000);
  });

  it('scales a 2-decimal currency major→minor', () => {
    expect(royaltyMajorToMinor(100, 'USD' as never)).toBe(10_000);
    expect(royaltyMajorToMinor(99.99, 'USD' as never)).toBe(9_999);
  });

  it('rejects non-positive / non-finite amounts (no zero-money post)', () => {
    expect(() => royaltyMajorToMinor(0, 'TZS' as never)).toThrow();
    expect(() => royaltyMajorToMinor(-5, 'TZS' as never)).toThrow();
    expect(() => royaltyMajorToMinor(Number.NaN, 'TZS' as never)).toThrow();
  });
});
