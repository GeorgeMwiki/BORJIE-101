/**
 * Tests for the universal provenance helper.
 *
 * Asserts that:
 *   - All four builders (form, chat, agent_apply, api) produce
 *     well-formed Provenance objects.
 *   - `resolveProvenance` ignores body-supplied provenance unless
 *     `trustedSource: true` is passed (prevents spoofing
 *     `via: 'chat'` from a public form POST).
 *   - The legacy + unknown constants pass the schema.
 */

import { describe, it, expect } from 'vitest';
import {
  buildFormProvenance,
  buildChatProvenance,
  buildAgentApplyProvenance,
  buildApiProvenance,
  resolveProvenance,
  provenanceSchema,
  LEGACY_PROVENANCE,
  UNKNOWN_PROVENANCE,
} from '../provenance';

function makeContext(auth?: { userId: string }): {
  get: (k: string) => unknown;
} {
  return { get: (k: string) => (k === 'auth' && auth ? auth : undefined) };
}

describe('provenance helpers', () => {
  it('builds a form provenance with the authenticated actor', () => {
    const c = makeContext({ userId: 'usr_owner_42' });
    const p = buildFormProvenance(c, { now: () => '2026-05-28T12:00:00Z' });
    expect(p.via).toBe('form');
    expect(p.actorId).toBe('usr_owner_42');
    expect(p.requestedAt).toBe('2026-05-28T12:00:00Z');
    expect(provenanceSchema.safeParse(p).success).toBe(true);
  });

  it('builds a form provenance with null actor when auth missing', () => {
    const c = makeContext();
    const p = buildFormProvenance(c);
    expect(p.via).toBe('form');
    expect(p.actorId).toBeNull();
    expect(provenanceSchema.safeParse(p).success).toBe(true);
  });

  it('builds a chat provenance with session + turn IDs', () => {
    const p = buildChatProvenance(
      {
        actorId: 'usr_owner_42',
        sessionId: 'sess_abc',
        turnId: 'turn_99',
      },
      { now: () => '2026-05-28T12:00:00Z' },
    );
    expect(p.via).toBe('chat');
    expect(p.sessionId).toBe('sess_abc');
    expect(p.turnId).toBe('turn_99');
    expect(provenanceSchema.safeParse(p).success).toBe(true);
  });

  it('builds an agent-apply provenance', () => {
    const p = buildAgentApplyProvenance({ actorId: 'svc_fx_cron' });
    expect(p.via).toBe('agent_apply');
    expect(p.actorId).toBe('svc_fx_cron');
    expect(provenanceSchema.safeParse(p).success).toBe(true);
  });

  it('builds an api provenance', () => {
    const p = buildApiProvenance({ actorId: 'm2m_partner_42' });
    expect(p.via).toBe('api');
    expect(provenanceSchema.safeParse(p).success).toBe(true);
  });

  it('resolveProvenance refuses body-supplied provenance unless trusted', () => {
    const c = makeContext({ userId: 'usr_owner_42' });
    const body = {
      provenance: {
        via: 'chat',
        actorId: 'usr_attacker',
        sessionId: 'sess_spoof',
        requestedAt: '2020-01-01T00:00:00Z',
      },
    };
    const untrusted = resolveProvenance(c, body, { trustedSource: false });
    expect(untrusted.via).toBe('form');
    expect(untrusted.actorId).toBe('usr_owner_42');

    const trusted = resolveProvenance(c, body, { trustedSource: true });
    expect(trusted.via).toBe('chat');
    expect(trusted.actorId).toBe('usr_attacker');
  });

  it('resolveProvenance falls back to form when body has no provenance', () => {
    const c = makeContext({ userId: 'usr_owner_42' });
    const p = resolveProvenance(c, { foo: 'bar' }, { trustedSource: true });
    expect(p.via).toBe('form');
  });

  it('LEGACY_PROVENANCE and UNKNOWN_PROVENANCE pass the schema', () => {
    expect(provenanceSchema.safeParse(LEGACY_PROVENANCE).success).toBe(true);
    expect(provenanceSchema.safeParse(UNKNOWN_PROVENANCE).success).toBe(true);
  });
});
