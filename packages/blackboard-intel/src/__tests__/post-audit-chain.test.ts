import { describe, it, expect } from 'vitest';
import {
  computeScoreAuditHash,
  createDefaultAuditChainPort,
  verifyScoreChain,
} from '../audit/post-audit-chain.js';
import type { PostQualityScore } from '../types.js';

const auditChain = createDefaultAuditChainPort();

function buildChain(): ReadonlyArray<PostQualityScore> {
  const rows: PostQualityScore[] = [];
  const axes: Array<['groundedness' | 'calibration' | 'utility', number]> = [
    ['groundedness', 1.0],
    ['calibration', 0.5],
    ['utility', 0.25],
  ];
  let prev = '';
  let ts = Date.parse('2026-05-27T10:00:00.000Z');
  for (let i = 0; i < axes.length; i += 1) {
    const axisEntry = axes[i];
    if (axisEntry === undefined) continue;
    const [axis, score] = axisEntry;
    const id = `score-${i + 1}`;
    const scoredAt = new Date(ts).toISOString();
    const auditHash = computeScoreAuditHash(
      prev,
      {
        id,
        tenantId: 'tenant-a',
        postId: 'post-1',
        axis,
        score,
        scoredAt,
      },
      auditChain,
    );
    rows.push(
      Object.freeze({
        id,
        tenantId: 'tenant-a',
        postId: 'post-1',
        axis,
        score,
        scoredAt,
        prevHash: prev,
        auditHash,
      }),
    );
    prev = auditHash;
    ts += 1;
  }
  return Object.freeze([...rows]);
}

describe('verifyScoreChain', () => {
  it('returns ok for an unbroken chain', () => {
    const chain = buildChain();
    const result = verifyScoreChain(chain, auditChain);
    expect(result.ok).toBe(true);
  });

  it('flags a tampered row', () => {
    const chain = buildChain();
    const tampered = chain.map((r, i) =>
      i === 1
        ? Object.freeze({ ...r, score: 0.99 })
        : r,
    );
    const result = verifyScoreChain(tampered, auditChain);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.badRowId).toBe(tampered[1]?.id);
  });

  it('detects a broken prev-hash link', () => {
    const chain = buildChain();
    const broken = chain.map((r, i) =>
      i === 2
        ? Object.freeze({ ...r, prevHash: 'wrong-prev-hash' })
        : r,
    );
    const result = verifyScoreChain(broken, auditChain);
    expect(result.ok).toBe(false);
  });
});
