/**
 * audit-emit.test — verifies the chain append + secret-rotation passthrough.
 */

import { describe, it, expect } from 'vitest';
import { emitAuditEntry } from '../audit/audit-emit.js';
import {
  verifyChain,
  GENESIS_HASH,
} from '@borjie/audit-hash-chain';

describe('emitAuditEntry', () => {
  it('appends a single new entry to the chain', () => {
    const res = emitAuditEntry({
      kind: 'doc_evo.lock_decision',
      tenant_id: 't1',
      subject: { recipe_id: 'r1' },
      chain: [],
    });
    expect(res.chain.length).toBe(1);
    expect(res.entry.index).toBe(0);
    expect(res.entry.prevHash).toBe(GENESIS_HASH);
    const verified = verifyChain(res.chain);
    expect(verified.ok).toBe(true);
  });

  it('chains multiple entries with verifyChain ok', () => {
    let chain = [] as ReadonlyArray<unknown>;
    for (let i = 0; i < 3; i += 1) {
      const r = emitAuditEntry({
        kind: 'doc_evo.improve_proposal',
        tenant_id: 't1',
        subject: { proposal_id: `p${i}` },
        chain: chain as Parameters<typeof emitAuditEntry>[0]['chain'],
      });
      chain = r.chain;
    }
    expect(chain.length).toBe(3);
    const verified = verifyChain(
      chain as Parameters<typeof verifyChain>[0],
    );
    expect(verified.ok).toBe(true);
  });

  it('passes secret_id / secret_value through to the chain', () => {
    const res = emitAuditEntry({
      kind: 'doc_evo.tier2_queue_enqueue',
      tenant_id: 't1',
      subject: { artifact_id: 'a1' },
      chain: [],
      secret_id: 'k1',
      secret_value: 'super-secret-value',
    });
    expect(res.entry.secretId).toBe('k1');
    const verified = verifyChain(res.chain, { k1: 'super-secret-value' });
    expect(verified.ok).toBe(true);
  });
});
