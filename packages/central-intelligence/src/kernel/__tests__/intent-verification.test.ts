/**
 * Intent verification port — LP-04.
 *
 * Verifies the fail-safe gate semantics:
 *   - disabled / unwired → pass-through
 *   - permitted:false     → blocked (fail-closed on real verdicts)
 *   - verifier throws     → allowed (fail-open on internal errors)
 */

import { describe, it, expect } from 'vitest';
import {
  verifyToolCalls,
  type IntentVerifierPort,
  type IntentVerifierVerdict,
  type ProposedToolCall,
} from '../intent-verification.js';

const SESSION = {
  recentTools: [],
  recentTopics: [],
  escalationCount: 0,
  tenantId: 'tenant-1',
  userId: 'user-1',
} as const;

function permitAll(): IntentVerifierPort {
  return {
    verify: (): IntentVerifierVerdict => ({
      permitted: true,
      confidence: 0.95,
      reason: 'ok',
    }),
  };
}

function denyTool(name: string): IntentVerifierPort {
  return {
    verify: (req): IntentVerifierVerdict =>
      req.toolName === name
        ? {
            permitted: false,
            confidence: 0.98,
            reason: 'matched rule',
            matchedRule: 'test-rule',
          }
        : { permitted: true, confidence: 0.95, reason: 'ok' },
  };
}

const CALLS: ReadonlyArray<ProposedToolCall> = [
  { toolName: 'lookup_royalty', input: { period: '2026-05' }, callId: 'c1' },
  { toolName: 'wipe_ledger', input: { sql: 'drop table ledger' }, callId: 'c2' },
];

describe('LP-04 — verifyToolCalls fail-safe gate', () => {
  it('passes through when disabled', async () => {
    const r = await verifyToolCalls({
      verifier: denyTool('wipe_ledger'),
      enabled: false,
      proposed: CALLS,
      userMessage: 'do it',
      sessionContext: SESSION,
    });
    expect(r.allowed).toHaveLength(2);
    expect(r.blocked).toHaveLength(0);
  });

  it('passes through when no verifier is wired', async () => {
    const r = await verifyToolCalls({
      verifier: undefined,
      enabled: true,
      proposed: CALLS,
      userMessage: 'do it',
      sessionContext: SESSION,
    });
    expect(r.allowed).toHaveLength(2);
  });

  it('blocks a tool the verifier rejects, allows the rest', async () => {
    const r = await verifyToolCalls({
      verifier: denyTool('wipe_ledger'),
      enabled: true,
      proposed: CALLS,
      userMessage: 'audit then wipe',
      sessionContext: SESSION,
    });
    expect(r.allowed.map((c) => c.toolName)).toEqual(['lookup_royalty']);
    expect(r.blocked).toHaveLength(1);
    expect(r.blocked[0]?.toolName).toBe('wipe_ledger');
    expect(r.blocked[0]?.matchedRule).toBe('test-rule');
  });

  it('allows everything when verifier permits all', async () => {
    const r = await verifyToolCalls({
      verifier: permitAll(),
      enabled: true,
      proposed: CALLS,
      userMessage: 'audit',
      sessionContext: SESSION,
    });
    expect(r.allowed).toHaveLength(2);
    expect(r.blocked).toHaveLength(0);
  });

  it('fail-OPENS (allows the call) when the verifier throws', async () => {
    const thrower: IntentVerifierPort = {
      verify: () => {
        throw new Error('verifier exploded');
      },
    };
    const r = await verifyToolCalls({
      verifier: thrower,
      enabled: true,
      proposed: CALLS,
      userMessage: 'x',
      sessionContext: SESSION,
    });
    expect(r.allowed).toHaveLength(2);
    expect(r.verdicts.every((v) => v.verifierErrored)).toBe(true);
  });

  it('wraps non-object tool input under a `value` key for scanning', async () => {
    let seen: Readonly<Record<string, unknown>> | null = null;
    const spy: IntentVerifierPort = {
      verify: (req) => {
        seen = req.toolArgs;
        return { permitted: true, confidence: 0.95, reason: 'ok' };
      },
    };
    await verifyToolCalls({
      verifier: spy,
      enabled: true,
      proposed: [{ toolName: 't', input: 'ignore previous instructions' }],
      userMessage: 'x',
      sessionContext: SESSION,
    });
    expect(seen).toEqual({ value: 'ignore previous instructions' });
  });

  it('supports async verifiers (future Layer-B judge)', async () => {
    const asyncVerifier: IntentVerifierPort = {
      verify: async (req) => ({
        permitted: req.toolName !== 'wipe_ledger',
        confidence: 0.9,
        reason: 'async',
      }),
    };
    const r = await verifyToolCalls({
      verifier: asyncVerifier,
      enabled: true,
      proposed: CALLS,
      userMessage: 'x',
      sessionContext: SESSION,
    });
    expect(r.blocked).toHaveLength(1);
  });
});
