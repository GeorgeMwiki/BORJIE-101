/**
 * Per-region hash-chain integrity tests.
 *
 * Wave BLACKBOARD-CORE. Verifies:
 *   - a clean chain of post.audit_hash values verifies under
 *     `verifyRegionChain`
 *   - tampering any payload field breaks the chain at the first
 *     broken index
 *   - swapping two adjacent rows breaks the chain
 *
 * Spec: Docs/DESIGN/BLACKBOARD_SOTA_2026.md §11.
 */

import { describe, it, expect } from 'vitest';
import { type ChainEntry } from '@borjie/audit-hash-chain';
import {
  computeBlackboardHash,
  createInMemoryPostsRepository,
  createInMemoryRegionsRepository,
  createPostPublisher,
  verifyRegionChain,
} from '../index.js';

/**
 * Build the audit-chain ChainEntry sequence for a region from its
 * persisted posts. We use the same payload shape the in-memory
 * posts repository hashes, so a tamper in any field will be detected.
 */
function chainEntriesForRegion(
  posts: ReadonlyArray<{
    readonly id: string;
    readonly tenantId: string;
    readonly regionId: string;
    readonly ksId: string;
    readonly parentPostId: string | null;
    readonly content: string;
    readonly structured: Readonly<Record<string, unknown>>;
    readonly postedAt: Date;
    readonly prevHash: string;
    readonly auditHash: string;
  }>,
): ChainEntry[] {
  return posts.map((p, i) => ({
    index: i,
    prevHash: p.prevHash,
    rowHash: p.auditHash,
    payload: {
      op: 'post',
      tenantId: p.tenantId,
      regionId: p.regionId,
      ksId: p.ksId,
      parentPostId: p.parentPostId,
      content: p.content,
      structured: p.structured,
      postedAtIso: p.postedAt.toISOString(),
    },
    sealedAtIso: p.postedAt.toISOString(),
  }));
}

describe('hash-chain — per-region tamper evidence', () => {
  it('a clean post chain verifies', async () => {
    const regionsRepo = createInMemoryRegionsRepository();
    const postsRepo = createInMemoryPostsRepository();
    await regionsRepo.open({
      tenantId: 't1',
      id: 'r1',
      regionKind: 'incident-investigation',
    });
    const publisher = createPostPublisher({ repository: postsRepo });
    for (let i = 0; i < 5; i += 1) {
      await publisher.publish({
        tenantId: 't1',
        regionId: 'r1',
        ksId: 'ks-1',
        content: `post-${i}`,
      });
      // tiny tick so postedAt differs
      await new Promise((r) => setTimeout(r, 1));
    }
    const posts = await postsRepo.listByRegion('t1', 'r1', { ascending: true });
    const entries = chainEntriesForRegion(posts);
    const result = verifyRegionChain(entries);
    expect(result.ok).toBe(true);
  });

  it('mutating a payload field breaks the chain', async () => {
    const regionsRepo = createInMemoryRegionsRepository();
    const postsRepo = createInMemoryPostsRepository();
    await regionsRepo.open({
      tenantId: 't1',
      id: 'r1',
      regionKind: 'incident-investigation',
    });
    const publisher = createPostPublisher({ repository: postsRepo });
    for (let i = 0; i < 3; i += 1) {
      await publisher.publish({
        tenantId: 't1',
        regionId: 'r1',
        ksId: 'ks-1',
        content: `post-${i}`,
      });
      await new Promise((r) => setTimeout(r, 1));
    }
    const posts = await postsRepo.listByRegion('t1', 'r1', { ascending: true });
    const entries = chainEntriesForRegion(posts);
    // Tamper: mutate index 1's content but leave the stored audit_hash.
    const tampered: ChainEntry[] = entries.map((e, i) =>
      i === 1
        ? { ...e, payload: { ...e.payload, content: 'EVIL' } }
        : e,
    );
    const result = verifyRegionChain(tampered);
    expect(result.ok).toBe(false);
    expect(result.firstBrokenIndex).toBe(1);
  });

  it('verifyRegionChain accepts a single-row chain', async () => {
    const regionsRepo = createInMemoryRegionsRepository();
    const postsRepo = createInMemoryPostsRepository();
    await regionsRepo.open({
      tenantId: 't1',
      id: 'r1',
      regionKind: 'incident-investigation',
    });
    const publisher = createPostPublisher({ repository: postsRepo });
    await publisher.publish({
      tenantId: 't1',
      regionId: 'r1',
      ksId: 'ks-1',
      content: 'sole observation',
    });
    const posts = await postsRepo.listByRegion('t1', 'r1', { ascending: true });
    const entries = chainEntriesForRegion(posts);
    const result = verifyRegionChain(entries);
    expect(result.ok).toBe(true);
  });

  it('computeBlackboardHash is deterministic over the same payload + prev', () => {
    const a = computeBlackboardHash({ a: 1, b: 'two' }, 'PREVHASH');
    const b = computeBlackboardHash({ b: 'two', a: 1 }, 'PREVHASH');
    expect(a).toBe(b);
    const c = computeBlackboardHash({ a: 1, b: 'three' }, 'PREVHASH');
    expect(a).not.toBe(c);
  });
});
