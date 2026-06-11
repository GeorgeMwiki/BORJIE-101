/**
 * Fast-path tiered router — latency win 2.
 *
 * Verifies the cheap deterministic intent gate routes trivial/simple turns
 * to the fast lane and ALWAYS keeps high-stakes / attachment / complex turns
 * on the full pipeline, and that the master flag defaults OFF.
 */

import { describe, it, expect } from 'vitest';
import {
  decideFastPath,
  resolveFastPathEnabled,
} from '../fast-path-router.js';
import type { ThoughtRequest } from '../kernel-types.js';

function req(over: Partial<ThoughtRequest> & { userMessage: string }): ThoughtRequest {
  return {
    threadId: 't',
    scope: {
      kind: 'tenant',
      tenantId: 'tenant-1',
      actorUserId: 'u',
      roles: ['owner'],
      personaId: 'mr-mwikila',
    },
    tier: 'tenant',
    stakes: 'low',
    surface: 'owner-portal',
    ...over,
  } as ThoughtRequest;
}

describe('decideFastPath — fast lane', () => {
  it.each([
    ['hi', 'greeting'],
    ['habari', 'greeting'],
    ['thanks', 'acknowledgment'],
    ['kwaheri', 'farewell'],
    ['what can you do', 'platform_intro'],
    ['status', 'status'],
    ['are you there?', 'status'],
  ])('routes trivial "%s" to fast (%s)', (message, intent) => {
    const d = decideFastPath(req({ userMessage: message }));
    expect(d.route).toBe('fast');
    expect(d.intent).toBe(intent);
  });

  it('routes a short simple question to fast', () => {
    const d = decideFastPath(req({ userMessage: 'what is the royalty rate?' }));
    expect(d.route).toBe('fast');
    expect(d.intent).toBe('question');
  });
});

describe('decideFastPath — full lane (safety-preserving)', () => {
  it('high stakes always takes the full path', () => {
    expect(decideFastPath(req({ userMessage: 'hi', stakes: 'high' })).route).toBe('full');
    expect(decideFastPath(req({ userMessage: 'hi', stakes: 'critical' })).route).toBe('full');
  });

  it('attachments force the full path', () => {
    const d = decideFastPath(
      req({
        userMessage: 'hi',
        attachments: [{ kind: 'image', mediaType: 'image/png', dataBase64: 'x' }] as never,
      }),
    );
    expect(d.route).toBe('full');
  });

  it('explicit deep-reasoning forces the full path', () => {
    expect(decideFastPath(req({ userMessage: 'hi', requireSynthesis: true })).route).toBe('full');
    expect(decideFastPath(req({ userMessage: 'hi', requireJudge: true })).route).toBe('full');
  });

  it('command intent stays full (mutation-bearing — must run gates)', () => {
    const d = decideFastPath(req({ userMessage: 'pay the royalty invoice now' }));
    expect(d.route).toBe('full');
    expect(d.intent).toBe('command');
  });

  it('complex multi-clause questions stay full', () => {
    const d = decideFastPath(
      req({
        userMessage:
          'compare the gold offtake premium versus copper and explain why one is better',
      }),
    );
    expect(d.route).toBe('full');
  });

  it('long questions stay full', () => {
    const long = 'why '.repeat(60);
    expect(decideFastPath(req({ userMessage: long })).route).toBe('full');
  });

  it('empty message stays full', () => {
    expect(decideFastPath(req({ userMessage: '   ' })).route).toBe('full');
  });
});

describe('resolveFastPathEnabled — default OFF', () => {
  it('defaults to OFF (current behaviour)', () => {
    expect(resolveFastPathEnabled({})).toBe(false);
    expect(resolveFastPathEnabled({ BORJIE_FASTPATH: '' })).toBe(false);
    expect(resolveFastPathEnabled({ BORJIE_FASTPATH: 'no' })).toBe(false);
  });

  it.each(['1', 'true', 'on', 'yes', 'TRUE', ' On '])('enables on "%s"', (v) => {
    expect(resolveFastPathEnabled({ BORJIE_FASTPATH: v })).toBe(true);
  });
});
