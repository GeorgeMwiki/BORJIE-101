/**
 * Audited body-change — every self-change decision (allow OR deny)
 * lands a hash-chained, append-only audit entry. An unauditable change
 * fails closed (the meta-rail's no-audit-shortening accountability
 * clause).
 */

import { describe, it, expect } from 'vitest';
import { verifyChain, type ChainEntry } from '@borjie/audit-hash-chain';
import { runAuditedBodyChange } from '../body-change/audited-body-change.js';
import type {
  BodyChangeRequest,
  BodyChangeSyscallPorts,
} from '../body-change/body-change-syscall.js';

function allowPorts(): BodyChangeSyscallPorts {
  return {
    metaRail: { check: () => ({ status: 'allow' }) },
    controller: {
      decide: () => ({ decision: 'auto', reasons: ['ctrl'], gatedBy: null }),
    },
    composeWithRail: {
      compose: () => ({
        decision: 'auto',
        reasons: ['compose'],
        metaRailForbade: false,
        railDominated: false,
      }),
    },
  };
}

function forbidPorts(): BodyChangeSyscallPorts {
  return {
    metaRail: { check: () => ({ status: 'forbid', reason: 'rail-edit' }) },
    controller: {
      decide: () => ({ decision: 'auto', reasons: ['ctrl'], gatedBy: null }),
    },
    composeWithRail: {
      compose: () => ({
        decision: 'four_eyes',
        reasons: ['compose'],
        metaRailForbade: true,
        railDominated: false,
      }),
    },
  };
}

function request(): BodyChangeRequest {
  return {
    tenantId: 't1',
    targetNodeId: 'surface.x',
    descriptor: { kind: 'ui-move', targetNodeId: 'surface.x' },
    railOutcome: 'allow',
    controllerInput: {},
  };
}

const fixedNow = () => '2026-06-08T00:00:00.000Z';

describe('runAuditedBodyChange', () => {
  it('appends a hash-chained entry on an ALLOW decision', () => {
    const out = runAuditedBodyChange({
      request: request(),
      ports: allowPorts(),
      chain: [],
      proposer: 'mr_mwikila',
      nowIso: fixedNow,
    });
    expect(out.verdict.authorized).toBe(true);
    expect(out.chain).toHaveLength(1);
    expect(out.chain[0]?.payload.kind).toBe('body_change_decision');
    expect(out.chain[0]?.payload.authorized).toBe(true);
    expect(verifyChain(out.chain).ok).toBe(true);
  });

  it('appends a hash-chained entry on a DENY decision too', () => {
    const out = runAuditedBodyChange({
      request: request(),
      ports: forbidPorts(),
      chain: [],
      proposer: 'mr_mwikila',
      nowIso: fixedNow,
    });
    expect(out.verdict.authorized).toBe(false);
    expect(out.chain).toHaveLength(1);
    expect(out.chain[0]?.payload.authorized).toBe(false);
    expect(out.chain[0]?.payload.meta_rail_forbade).toBe(true);
    expect(verifyChain(out.chain).ok).toBe(true);
  });

  it('extends an existing chain (append-only)', () => {
    const first = runAuditedBodyChange({
      request: request(),
      ports: allowPorts(),
      chain: [],
      proposer: 'mr_mwikila',
      nowIso: fixedNow,
    });
    const second = runAuditedBodyChange({
      request: request(),
      ports: forbidPorts(),
      chain: first.chain,
      proposer: 'mr_mwikila',
      nowIso: fixedNow,
    });
    expect(second.chain).toHaveLength(2);
    expect(second.chain[1]?.prevHash).toBe(first.chain[0]?.rowHash);
    expect(verifyChain(second.chain).ok).toBe(true);
  });

  it('FAILS CLOSED when the audit emission throws (unauditable → deny)', () => {
    // A chain whose last entry has a non-string rowHash forces appendEntry
    // to misbehave; simpler: stub a chain getter that throws via a frozen
    // proxy. Here we force the throw by passing a chain whose last element
    // access throws.
    const throwingChain = new Proxy([] as ChainEntry[], {
      get(target, prop, receiver) {
        if (prop === 'length') return 1; // claim length 1 …
        if (prop === '0') {
          throw new Error('chain access boom'); // … but throw on access.
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const out = runAuditedBodyChange({
      request: request(),
      ports: allowPorts(),
      chain: throwingChain,
      proposer: 'mr_mwikila',
      nowIso: fixedNow,
    });
    expect(out.verdict.failedClosed).toBe(true);
    expect(out.verdict.authorized).toBe(false);
    expect(out.verdict.decision).toBe('four_eyes');
    expect(out.verdict.reasons.join('\n')).toContain('audit emission threw');
  });
});
