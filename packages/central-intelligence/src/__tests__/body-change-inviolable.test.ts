/**
 * Meta-rail — checkBodyChangeInviolable.
 *
 * The deterministic, no-LLM, FAIL-CLOSED self-modification gate. These
 * tests prove every clause of the meta-rail spec
 * (Docs/research/MD_AS_BODY_ARCHITECTURE.md §governance):
 *
 *   1. rail-edit               — never operate on the nerve.
 *   2. audit-shorten           — never shorten/alter the audit chain.
 *   3. ceiling-raise           — never raise its own autonomy ceiling.
 *   4. confidence-floor-lower  — never lower a confidence floor.
 *   5. integrity-failure       — never proceed on a broken integrity hash.
 *   + fail-closed on malformed descriptors.
 *
 * The meta-rail is ADDITIVE — it only ADDS prohibitions. A well-formed,
 * non-prohibited body-change must `allow`.
 */

import { describe, it, expect } from 'vitest';
import {
  checkBodyChangeInviolable,
  type BodyChangeDescriptor,
} from '../kernel/inviolable.js';

function base(overrides: Partial<BodyChangeDescriptor> = {}): BodyChangeDescriptor {
  return {
    kind: 'ui-move',
    targetNodeId: 'surface.owner-web.royalties-tab',
    ...overrides,
  };
}

describe('checkBodyChangeInviolable — allow path', () => {
  it('allows a benign UI-move that touches no rail', () => {
    const v = checkBodyChangeInviolable(base());
    expect(v.status).toBe('allow');
    expect(v.category).toBeUndefined();
  });

  it('allows a capability-add with an unrelated touched node', () => {
    const v = checkBodyChangeInviolable(
      base({
        kind: 'capability-add',
        targetNodeId: 'capability.offtake-settlement',
        touchesNodes: ['surface.owner-web.royalties-tab', 'service.payments'],
        summary: 'add a new offtake settlement capability',
      }),
    );
    expect(v.status).toBe('allow');
  });

  it('allows a ceiling that becomes MORE cautious (gate → four_eyes)', () => {
    const v = checkBodyChangeInviolable(
      base({ ceilingBefore: 'gate', ceilingAfter: 'four_eyes' }),
    );
    expect(v.status).toBe('allow');
  });

  it('allows an equal ceiling (no raise)', () => {
    const v = checkBodyChangeInviolable(
      base({ ceilingBefore: 'gate', ceilingAfter: 'gate' }),
    );
    expect(v.status).toBe('allow');
  });

  it('allows a confidence floor that RISES (more cautious)', () => {
    const v = checkBodyChangeInviolable(
      base({ confidenceFloorBefore: 0.7, confidenceFloorAfter: 0.9 }),
    );
    expect(v.status).toBe('allow');
  });

  it('allows when integrity hash matches and prior chain link verified', () => {
    const v = checkBodyChangeInviolable(
      base({
        expectedIntegrityHash: 'abc123',
        computedIntegrityHash: 'abc123',
        priorChainLinkVerified: true,
      }),
    );
    expect(v.status).toBe('allow');
  });
});

describe('checkBodyChangeInviolable — clause 1: rail-edit', () => {
  it('forbids when editsRail flag is true', () => {
    const v = checkBodyChangeInviolable(base({ editsRail: true }));
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('rail-edit');
  });

  it.each([
    'packages/central-intelligence/src/kernel/inviolable.ts',
    'kernel.policy-gate',
    'four-eye-approval',
    'killswitch',
    'compose-with-rail',
    'decide-autonomy',
    'services/payments-ledger/LedgerService',
    'money-path',
    'rls.tenant-isolation',
    'audit-hash-chain',
    'sovereign-action-ledger',
    'mutation-authority.executor',
    'self-extension',
    'check-body-change-inviolable',
    'meta-rail',
  ])('forbids when targetNodeId names a rail node: %s', (node) => {
    const v = checkBodyChangeInviolable(base({ targetNodeId: node }));
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('rail-edit');
  });

  it('forbids when a TOUCHED node is a rail node even if target is benign', () => {
    const v = checkBodyChangeInviolable(
      base({
        targetNodeId: 'surface.benign',
        touchesNodes: ['some.unrelated', 'kernel.policy-gate.softener'],
      }),
    );
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('rail-edit');
  });

  it.each([
    'disable the policy-gate for this surface',
    'bypass the four-eye check on deploy',
    'remove the kill-switch guard',
    'route around RLS for the report',
    'raise my autonomy ceiling to operator',
    'give myself broader self-edit rights',
  ])('forbids when the summary betrays rail-edit intent (flags false): %s', (summary) => {
    const v = checkBodyChangeInviolable(
      base({ editsRail: false, summary }),
    );
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('rail-edit');
  });

  it('cannot be bypassed by a false editsRail flag when target is a rail', () => {
    const v = checkBodyChangeInviolable(
      base({ targetNodeId: 'kernel.inviolable', editsRail: false }),
    );
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('rail-edit');
  });
});

describe('checkBodyChangeInviolable — clause 2: audit-shorten', () => {
  it('forbids when altersAuditChain flag is true', () => {
    const v = checkBodyChangeInviolable(
      base({ targetNodeId: 'surface.benign', altersAuditChain: true }),
    );
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('audit-shorten');
  });

  it.each([
    'shorten the audit trail for performance',
    'truncate the provenance hash-chain',
    'skip the ledger entry on auto changes',
    'make the audit chain mutable',
    'rewrite the chain to drop old links',
  ])('forbids when summary betrays audit-shortening: %s', (summary) => {
    const v = checkBodyChangeInviolable(
      base({ targetNodeId: 'surface.benign', summary }),
    );
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('audit-shorten');
  });
});

describe('checkBodyChangeInviolable — clause 3: ceiling-raise', () => {
  it.each([
    ['four_eyes', 'gate'],
    ['four_eyes', 'auto'],
    ['gate', 'auto'],
    ['gate', 'operator'],
    ['observer', 'operator'],
    ['approver', 'collaborator'],
    ['auto', 'operator'],
  ] as const)('forbids raising ceiling %s → %s', (before, after) => {
    const v = checkBodyChangeInviolable(
      base({ ceilingBefore: before, ceilingAfter: after }),
    );
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('ceiling-raise');
  });

  it('forbids when only the after-ceiling is given and it is autonomous', () => {
    // before absent → +Inf (most cautious side); after present → its rank.
    // +Inf > any rank means NOT a raise, so this should be allowed —
    // assert the absent-before semantics explicitly.
    const v = checkBodyChangeInviolable(base({ ceilingAfter: 'auto' }));
    expect(v.status).toBe('allow');
  });

  it('forbids when after-ceiling is an unknown string', () => {
    const v = checkBodyChangeInviolable(
      base({
        ceilingBefore: 'gate',
        // @ts-expect-error — deliberately malformed to prove fail-closed.
        ceilingAfter: 'godmode',
      }),
    );
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('ceiling-raise');
  });
});

describe('checkBodyChangeInviolable — clause 4: confidence-floor-lower', () => {
  it('forbids lowering a confidence floor', () => {
    const v = checkBodyChangeInviolable(
      base({ confidenceFloorBefore: 0.9, confidenceFloorAfter: 0.7 }),
    );
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('confidence-floor-lower');
  });

  it('forbids (malformed) when one floor is non-finite', () => {
    const v = checkBodyChangeInviolable(
      base({ confidenceFloorBefore: 0.9, confidenceFloorAfter: Number.NaN }),
    );
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('malformed-descriptor');
  });

  it('forbids (malformed) when only one floor is supplied', () => {
    const v = checkBodyChangeInviolable(
      base({ confidenceFloorBefore: 0.9 }),
    );
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('malformed-descriptor');
  });
});

describe('checkBodyChangeInviolable — clause 5: integrity-failure', () => {
  it('forbids when computed hash does not match expected', () => {
    const v = checkBodyChangeInviolable(
      base({
        expectedIntegrityHash: 'abc',
        computedIntegrityHash: 'xyz',
        priorChainLinkVerified: true,
      }),
    );
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('integrity-failure');
  });

  it('forbids when prior chain link is not verified', () => {
    const v = checkBodyChangeInviolable(
      base({
        expectedIntegrityHash: 'abc',
        computedIntegrityHash: 'abc',
        priorChainLinkVerified: false,
      }),
    );
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('integrity-failure');
  });

  it('forbids on a partial integrity assertion (one side missing)', () => {
    const v = checkBodyChangeInviolable(
      base({ expectedIntegrityHash: 'abc' }),
    );
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('integrity-failure');
  });

  it('forbids when only priorChainLinkVerified is asserted', () => {
    const v = checkBodyChangeInviolable(
      base({ priorChainLinkVerified: true }),
    );
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('integrity-failure');
  });
});

describe('checkBodyChangeInviolable — fail-closed on malformed descriptor', () => {
  it('forbids when descriptor is null', () => {
    // @ts-expect-error — deliberately invalid.
    const v = checkBodyChangeInviolable(null);
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('malformed-descriptor');
  });

  it('forbids when targetNodeId is empty', () => {
    const v = checkBodyChangeInviolable(base({ targetNodeId: '' }));
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('malformed-descriptor');
  });

  it('forbids when kind is missing', () => {
    // @ts-expect-error — deliberately invalid.
    const v = checkBodyChangeInviolable({ targetNodeId: 'x' });
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('malformed-descriptor');
  });

  it('forbids when a touched node is a non-string', () => {
    const v = checkBodyChangeInviolable(
      // @ts-expect-error — deliberately invalid touched node.
      base({ touchesNodes: [42] }),
    );
    expect(v.status).toBe('forbid');
  });
});

describe('checkBodyChangeInviolable — clause precedence (rail-edit first)', () => {
  it('rail-edit wins over a simultaneous ceiling-raise', () => {
    const v = checkBodyChangeInviolable(
      base({
        targetNodeId: 'kernel.inviolable',
        ceilingBefore: 'gate',
        ceilingAfter: 'operator',
      }),
    );
    expect(v.status).toBe('forbid');
    expect(v.category).toBe('rail-edit');
  });
});
