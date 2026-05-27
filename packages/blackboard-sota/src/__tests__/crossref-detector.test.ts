/**
 * Cross-reference detector tests.
 *
 * Wave BLACKBOARD-CORE. Verifies:
 *   - explicit `"see post <id>"` phrasing → `cites` ref
 *   - explicit `"contradicts post <id>"` → `contradicts` ref
 *   - semantic cosine >= 0.85 (threshold) → `elaborates` ref
 *   - posts without embeddings are skipped on the semantic pass
 *   - self-references are filtered out
 *
 * Spec: Docs/DESIGN/BLACKBOARD_SOTA_2026.md §7.
 */

import { describe, it, expect } from 'vitest';
import {
  BLACKBOARD_CONSTANTS,
  createCrossReferenceDetector,
  type Post,
} from '../index.js';
import { createDeterministicEmbedder } from '../__fixtures__/embedder.js';

const embedder = createDeterministicEmbedder();

async function mkPost(args: {
  readonly id: string;
  readonly content: string;
  readonly postedAt: Date;
  readonly withEmbedding?: boolean;
}): Promise<Post> {
  const embedding = args.withEmbedding === false
    ? null
    : await embedder.embed(args.content);
  return Object.freeze({
    id: args.id,
    tenantId: 't1',
    regionId: 'r1',
    ksId: 'ks',
    parentPostId: null,
    content: args.content,
    contentEmbedding: embedding,
    structured: {},
    postedAt: args.postedAt,
    editCount: 0,
    prevHash: '',
    auditHash: 'h',
  });
}

describe('crossref-detector — explicit regex refs', () => {
  it('detects "see post <id>" as cites', async () => {
    const detector = createCrossReferenceDetector();
    const target = await mkPost({
      id: '12345678-aaaa-bbbb-cccc-deadbeef0001',
      content: 'borehole reading 412 ppm',
      postedAt: new Date(1),
    });
    const refRow = await mkPost({
      id: '12345678-aaaa-bbbb-cccc-deadbeef0002',
      content: 'see post 12345678-aaaa-bbbb-cccc-deadbeef0001 for context',
      postedAt: new Date(2),
    });
    const refs = detector.detect({ tenantId: 't1', posts: [target, refRow] });
    const cite = refs.find((r) => r.refKind === 'cites');
    expect(cite).toBeDefined();
    expect(cite?.srcPostId).toBe(refRow.id);
    expect(cite?.dstPostId).toBe(target.id);
    expect(cite?.confidence).toBeGreaterThan(0.9);
  });

  it('detects "contradicts post <id>" as contradicts', async () => {
    const detector = createCrossReferenceDetector();
    const a = await mkPost({
      id: '11111111-aaaa-bbbb-cccc-deadbeef0001',
      content: 'borehole reading 412 ppm',
      postedAt: new Date(1),
    });
    const b = await mkPost({
      id: '22222222-aaaa-bbbb-cccc-deadbeef0002',
      content:
        'this finding contradicts post 11111111-aaaa-bbbb-cccc-deadbeef0001 strongly',
      postedAt: new Date(2),
    });
    const refs = detector.detect({ tenantId: 't1', posts: [a, b] });
    const contra = refs.find((r) => r.refKind === 'contradicts');
    expect(contra).toBeDefined();
    expect(contra?.dstPostId).toBe(a.id);
  });

  it('does not record self-references', async () => {
    const detector = createCrossReferenceDetector();
    const self = await mkPost({
      id: 'aaaaaaaa-aaaa-bbbb-cccc-deadbeef0001',
      content: 'this post mentions itself: see post aaaaaaaa-aaaa-bbbb-cccc-deadbeef0001',
      postedAt: new Date(1),
    });
    const refs = detector.detect({ tenantId: 't1', posts: [self] });
    expect(refs).toHaveLength(0);
  });
});

describe('crossref-detector — semantic cosine refs', () => {
  it('emits an elaborates ref when cosine >= threshold', async () => {
    const detector = createCrossReferenceDetector();
    // Hand-built embeddings — same direction, slightly perturbed →
    // cosine well above 0.85 regardless of the embedder fixture's
    // token-overlap heuristics.
    const dim = 1536;
    const baseVec = new Array<number>(dim).fill(0);
    baseVec[0] = 1;
    baseVec[1] = 0.05;
    const perturbedVec = new Array<number>(dim).fill(0);
    perturbedVec[0] = 1;
    perturbedVec[1] = 0.1;
    const a: Post = Object.freeze({
      id: 'aaaa1111-aaaa-bbbb-cccc-deadbeef0001',
      tenantId: 't1',
      regionId: 'r1',
      ksId: 'ks',
      parentPostId: null,
      content: 'borehole reading 412 ppm at parcel KAH-088',
      contentEmbedding: baseVec,
      structured: {},
      postedAt: new Date(1),
      editCount: 0,
      prevHash: '',
      auditHash: 'h',
    });
    const b: Post = Object.freeze({
      id: 'bbbb2222-aaaa-bbbb-cccc-deadbeef0002',
      tenantId: 't1',
      regionId: 'r1',
      ksId: 'ks',
      parentPostId: null,
      content: 'the borehole reading was 412 ppm at parcel KAH-088 today',
      contentEmbedding: perturbedVec,
      structured: {},
      postedAt: new Date(2),
      editCount: 0,
      prevHash: '',
      auditHash: 'h',
    });
    const refs = detector.detect({ tenantId: 't1', posts: [a, b] });
    const semantic = refs.find(
      (r) =>
        r.refKind === 'elaborates' &&
        r.srcPostId === b.id &&
        r.dstPostId === a.id,
    );
    expect(semantic).toBeDefined();
    expect(semantic?.confidence).toBeGreaterThanOrEqual(
      BLACKBOARD_CONSTANTS.SEMANTIC_XREF_THRESHOLD,
    );
  });

  it('skips semantic comparison when one of the posts lacks an embedding', async () => {
    const detector = createCrossReferenceDetector();
    const a = await mkPost({
      id: 'aaaa3333-aaaa-bbbb-cccc-deadbeef0001',
      content: 'borehole reading 412 ppm at parcel KAH-088',
      postedAt: new Date(1),
      withEmbedding: false,
    });
    const b = await mkPost({
      id: 'bbbb4444-aaaa-bbbb-cccc-deadbeef0002',
      content: 'the borehole reading was 412 ppm at parcel KAH-088 today',
      postedAt: new Date(2),
      withEmbedding: false,
    });
    const refs = detector.detect({ tenantId: 't1', posts: [a, b] });
    expect(refs.filter((r) => r.refKind === 'elaborates')).toHaveLength(0);
  });

  it('uses a custom semanticThreshold when supplied', async () => {
    const detector = createCrossReferenceDetector();
    const a = await mkPost({
      id: 'aaaa5555-aaaa-bbbb-cccc-deadbeef0001',
      content: 'unrelated short note about fuel',
      postedAt: new Date(1),
    });
    const b = await mkPost({
      id: 'bbbb6666-aaaa-bbbb-cccc-deadbeef0002',
      content: 'borehole reading 412 ppm at parcel KAH-088',
      postedAt: new Date(2),
    });
    // Very high threshold — should produce NO semantic refs.
    const refs = detector.detect({
      tenantId: 't1',
      posts: [a, b],
      semanticThreshold: 0.999,
    });
    expect(refs.filter((r) => r.refKind === 'elaborates')).toHaveLength(0);
  });
});
