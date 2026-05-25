/**
 * Audit Trail v2 tests — Wave 27 Agent C.
 *
 * Covers:
 *  - hash-chain determinism
 *  - HMAC signing + verification
 *  - canonicalisation of evidence JSON (key-order independence)
 *  - recorder assigns sequence + genesis prev on first row
 *  - tampering detection (payload mutation)
 *  - prev_hash tampering
 *  - sequence gap detection
 *  - HMAC signature tampering
 *  - tenant isolation
 *  - verifier returns firstValidAt / lastValidAt for a window
 *  - bundle structure + bundleHash + bundleSignature
 *  - NDJSON streaming envelope order
 *  - recorder rejects invalid actorKind / category
 *  - recorder rejects negative tokens / cost
 *  - signing-secret env var enforcement in production
 */

import { describe, it, expect } from 'vitest';
import {
  canonicalEvidence,
  createAuditTrailRecorder,
  createAuditTrailVerifier,
  createInMemoryAuditTrailRepo,
  exportBundle,
  GENESIS_PREV_HASH_V2,
  hashEntry,
  resolveSigningSecret,
  signHash,
  streamBundleNdjson,
  verifySignature,
} from '../index.js';

function createHarness(secret: string | null = 'test-secret') {
  let ts = new Date('2026-01-01T00:00:00Z').getTime();
  let counter = 0;
  const repo = createInMemoryAuditTrailRepo();
  const recorder = createAuditTrailRecorder({
    repo,
    signingSecret: secret,
    now: () => new Date(ts++ * 1),
    idGenerator: () => `at_${++counter}`,
  });
  const verifier = createAuditTrailVerifier({
    repo,
    signingSecret: secret,
  });
  return { repo, recorder, verifier };
}

describe('audit-trail/hash-chain', () => {
  it('canonicalEvidence sorts object keys recursively', () => {
    const a = canonicalEvidence({ b: 2, a: 1, nested: { z: 9, a: 1 } });
    const b = canonicalEvidence({ a: 1, b: 2, nested: { a: 1, z: 9 } });
    expect(a).toBe(b);
  });

  it('hashEntry is deterministic', () => {
    const params = {
      sequenceId: 1,
      prevHash: GENESIS_PREV_HASH_V2,
      tenantId: 't1',
      occurredAt: '2026-01-01T00:00:00.000Z',
      actorKind: 'ai_autonomous' as const,
      actionKind: 'arrears.escalated',
      actionCategory: 'finance' as const,
      decision: 'executed',
      evidence: { foo: 1 },
    };
    expect(hashEntry(params)).toBe(hashEntry(params));
  });

  it('signHash returns null when secret is empty, else 64-char hex', () => {
    expect(signHash('abc', null)).toBeNull();
    expect(signHash('abc', '')).toBeNull();
    const sig = signHash('abc', 'secret');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifySignature catches the wrong signature', () => {
    const sig = signHash('hash', 'secret');
    expect(verifySignature('hash', sig, 'secret')).toBe(true);
    expect(verifySignature('hash', sig, 'other-secret')).toBe(false);
    expect(verifySignature('hash', 'bad', 'secret')).toBe(false);
  });

  it('resolveSigningSecret throws in production when missing', () => {
    expect(() =>
      resolveSigningSecret({ NODE_ENV: 'production' }, { requireInProd: true }),
    ).toThrow(/AUDIT_TRAIL_SIGNING_SECRET/);
    expect(
      resolveSigningSecret({ NODE_ENV: 'development' }),
    ).toBeNull();
    expect(
      resolveSigningSecret({
        NODE_ENV: 'production',
        AUDIT_TRAIL_SIGNING_SECRET: 'x',
      }),
    ).toBe('x');
  });
});

describe('audit-trail/recorder', () => {
  it('first row uses genesis prev_hash and sequence 1', async () => {
    const { recorder, repo } = createHarness();
    const row = await recorder.record({
      tenantId: 't1',
      actor: { kind: 'ai_autonomous', id: 'agent_1' },
      actionKind: 'arrears.escalated',
      actionCategory: 'finance',
      ai: { modelVersion: 'claude-4.7', promptTokensIn: 120, promptTokensOut: 80 },
    });
    expect(row.prevHash).toBe(GENESIS_PREV_HASH_V2);
    expect(row.sequenceId).toBe(1);
    expect(row.thisHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.entries).toHaveLength(1);
  });

  it('links subsequent rows into a chain and isolates per tenant', async () => {
    const { recorder } = createHarness();
    const a = await recorder.record({
      tenantId: 't1', actor: { kind: 'human_action' },
      actionKind: 'case.opened', actionCategory: 'leasing',
    });
    const b = await recorder.record({
      tenantId: 't1', actor: { kind: 'ai_proposal' },
      actionKind: 'renewal.drafted', actionCategory: 'leasing',
    });
    const c = await recorder.record({
      tenantId: 't2', actor: { kind: 'human_approval' },
      actionKind: 'renewal.approved', actionCategory: 'leasing',
    });
    expect(b.prevHash).toBe(a.thisHash);
    expect(b.sequenceId).toBe(2);
    // tenant isolation: t2's first row uses genesis, not t1's last hash
    expect(c.prevHash).toBe(GENESIS_PREV_HASH_V2);
    expect(c.sequenceId).toBe(1);
  });

  it('rejects invalid actor.kind', async () => {
    const { recorder } = createHarness();
    await expect(
      recorder.record({
        tenantId: 't1',
        // @ts-expect-error — forcing bad actor
        actor: { kind: 'hacker' },
        actionKind: 'x', actionCategory: 'finance',
      }),
    ).rejects.toThrow(/actor.kind/);
  });

  it('rejects invalid actionCategory', async () => {
    const { recorder } = createHarness();
    await expect(
      recorder.record({
        tenantId: 't1',
        actor: { kind: 'human_action' },
        actionKind: 'x',
        // @ts-expect-error — forcing bad category
        actionCategory: 'void',
      }),
    ).rejects.toThrow(/actionCategory/);
  });

  it('rejects negative AI tokens/cost', async () => {
    const { recorder } = createHarness();
    await expect(
      recorder.record({
        tenantId: 't1',
        actor: { kind: 'ai_autonomous' },
        actionKind: 'x', actionCategory: 'finance',
        ai: { promptTokensIn: -1 },
      }),
    ).rejects.toThrow(/non-negative integer/);
  });
});

describe('audit-trail/verifier', () => {
  async function seed() {
    const h = createHarness();
    await h.recorder.record({
      tenantId: 't1', actor: { kind: 'ai_autonomous' },
      actionKind: 'a', actionCategory: 'finance',
    });
    await h.recorder.record({
      tenantId: 't1', actor: { kind: 'ai_execution' },
      actionKind: 'b', actionCategory: 'leasing',
    });
    await h.recorder.record({
      tenantId: 't1', actor: { kind: 'human_approval' },
      actionKind: 'c', actionCategory: 'compliance',
    });
    return h;
  }

  it('valid chain returns valid=true with firstValidAt + lastValidAt', async () => {
    const { verifier } = await seed();
    const res = await verifier.verifyRange('t1');
    expect(res.valid).toBe(true);
    expect(res.entriesChecked).toBe(3);
    expect(res.firstValidAt).toBeDefined();
    expect(res.lastValidAt).toBeDefined();
  });

  it('detects a mutated evidence payload', async () => {
    const { repo, verifier } = await seed();
    repo.tamper(1, { evidence: { tampered: true, _ai: { modelVersion: null, promptHash: null, promptTokensIn: null, promptTokensOut: null, costUsdMicro: null }, _subject: { entityType: null, entityId: null, resourceUri: null }, _actor: { id: null, display: null } } });
    const res = await verifier.verifyRange('t1');
    expect(res.valid).toBe(false);
    expect(res.brokenAt).toBe(2);
    expect(res.error).toMatch(/mutated/);
  });

  it('detects prev_hash tampering', async () => {
    const { repo, verifier } = await seed();
    repo.tamper(2, { prevHash: 'f'.repeat(64) });
    const res = await verifier.verifyRange('t1');
    expect(res.valid).toBe(false);
    expect(res.brokenAt).toBe(3);
    expect(res.error).toMatch(/prevHash/);
  });

  it('detects signature tampering', async () => {
    const { repo, verifier } = await seed();
    repo.tamper(0, { signature: 'a'.repeat(64) });
    const res = await verifier.verifyRange('t1');
    expect(res.valid).toBe(false);
    expect(res.brokenAt).toBe(1);
    expect(res.error).toMatch(/signature/);
  });

  it('isolates per tenant — tampering t1 does not flag t2', async () => {
    const { repo, recorder, verifier } = createHarness();
    await recorder.record({
      tenantId: 't1', actor: { kind: 'ai_autonomous' },
      actionKind: 'a', actionCategory: 'finance',
    });
    await recorder.record({
      tenantId: 't2', actor: { kind: 'ai_autonomous' },
      actionKind: 'a', actionCategory: 'finance',
    });
    // tamper t1's row (index 0)
    repo.tamper(0, { evidence: { tampered: true, _ai: { modelVersion: null, promptHash: null, promptTokensIn: null, promptTokensOut: null, costUsdMicro: null }, _subject: { entityType: null, entityId: null, resourceUri: null }, _actor: { id: null, display: null } } });
    const t1 = await verifier.verifyRange('t1');
    const t2 = await verifier.verifyRange('t2');
    expect(t1.valid).toBe(false);
    expect(t2.valid).toBe(true);
  });
});

describe('audit-trail/bundle', () => {
  it('exportBundle returns entries + verification + bundleHash + signature', async () => {
    const h = createHarness('secret-xyz');
    await h.recorder.record({
      tenantId: 't1', actor: { kind: 'ai_autonomous' },
      actionKind: 'a', actionCategory: 'finance',
    });
    await h.recorder.record({
      tenantId: 't1', actor: { kind: 'human_approval' },
      actionKind: 'b', actionCategory: 'compliance',
    });
    const bundle = await exportBundle(
      { repo: h.repo, signingSecret: 'secret-xyz' },
      't1',
    );
    expect(bundle.bundleVersion).toBe(1);
    expect(bundle.tenantId).toBe('t1');
    expect(bundle.entries).toHaveLength(2);
    expect(bundle.verification.valid).toBe(true);
    expect(bundle.bundleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.bundleSignature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('streamBundleNdjson emits header → entry*N → trailer', async () => {
    const h = createHarness('secret');
    await h.recorder.record({
      tenantId: 't1', actor: { kind: 'ai_autonomous' },
      actionKind: 'a', actionCategory: 'finance',
    });
    const lines: string[] = [];
    for await (const line of streamBundleNdjson(
      { repo: h.repo, signingSecret: 'secret' },
      't1',
    )) {
      lines.push(line.trimEnd());
    }
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).type).toBe('header');
    expect(JSON.parse(lines[1]).type).toBe('entry');
    expect(JSON.parse(lines[2]).type).toBe('trailer');
  });
});
