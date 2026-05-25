/**
 * Tests for artifacts.ts.
 *
 * Cover:
 *   - createArtifact starts at version 1
 *   - bumpArtifactVersion increments and sets parent_version_id
 *   - branchArtifact creates a divergent version from a non-latest
 *     parent and bumps version above the current latest
 *   - artifactVersionKey returns id@vN
 *   - listArtifactVersions returns all versions
 */
import { describe, expect, it } from 'vitest';
import {
  artifactVersionKey,
  branchArtifact,
  bumpArtifactVersion,
  createArtifact,
  createInMemoryArtifactRepository,
  listArtifactVersions,
} from '../artifacts.js';

describe('createArtifact', () => {
  it('creates version 1', async () => {
    const repo = createInMemoryArtifactRepository();
    const a = await createArtifact({
      tenantId: 't_abc',
      threadId: 'thr_1',
      artifactType: 'chart',
      contentJsonb: { kind: 'bar', data: [1, 2, 3] },
      title: 'Vacancy by block',
      idGenerator: () => 'a_1',
      repository: repo,
    });
    expect(a.version).toBe(1);
    expect(a.id).toBe('a_1');
    expect(a.title).toBe('Vacancy by block');
  });
});

describe('bumpArtifactVersion', () => {
  it('increments version and stores parent_version_id', async () => {
    const repo = createInMemoryArtifactRepository();
    await createArtifact({
      tenantId: 't_abc',
      threadId: 'thr_1',
      artifactType: 'chart',
      contentJsonb: { kind: 'bar' },
      idGenerator: () => 'a_1',
      repository: repo,
    });
    const v2 = await bumpArtifactVersion({
      tenantId: 't_abc',
      threadId: 'thr_1',
      id: 'a_1',
      contentJsonb: { kind: 'line' },
      repository: repo,
    });
    expect(v2.version).toBe(2);
    expect(v2.parentVersionId).toBe(artifactVersionKey({ id: 'a_1', version: 1 }));
  });

  it('throws when artifact does not exist', async () => {
    const repo = createInMemoryArtifactRepository();
    await expect(
      bumpArtifactVersion({
        tenantId: 't_abc',
        threadId: 'thr_1',
        id: 'missing',
        contentJsonb: {},
        repository: repo,
      }),
    ).rejects.toThrow(/not found/);
  });

  it('inherits title when none provided', async () => {
    const repo = createInMemoryArtifactRepository();
    await createArtifact({
      tenantId: 't_abc',
      threadId: 'thr_1',
      artifactType: 'chart',
      contentJsonb: {},
      title: 'Original',
      idGenerator: () => 'a_1',
      repository: repo,
    });
    const v2 = await bumpArtifactVersion({
      tenantId: 't_abc',
      threadId: 'thr_1',
      id: 'a_1',
      contentJsonb: {},
      repository: repo,
    });
    expect(v2.title).toBe('Original');
  });
});

describe('branchArtifact', () => {
  it('creates a divergent version above the current latest', async () => {
    const repo = createInMemoryArtifactRepository();
    await createArtifact({
      tenantId: 't_abc',
      threadId: 'thr_1',
      artifactType: 'chart',
      contentJsonb: { v: 1 },
      idGenerator: () => 'a_1',
      repository: repo,
    });
    await bumpArtifactVersion({
      tenantId: 't_abc',
      threadId: 'thr_1',
      id: 'a_1',
      contentJsonb: { v: 2 },
      repository: repo,
    });
    await bumpArtifactVersion({
      tenantId: 't_abc',
      threadId: 'thr_1',
      id: 'a_1',
      contentJsonb: { v: 3 },
      repository: repo,
    });
    const branched = await branchArtifact({
      tenantId: 't_abc',
      threadId: 'thr_1',
      id: 'a_1',
      fromVersion: 2,
      contentJsonb: { v: 'branched-from-2' },
      repository: repo,
    });
    expect(branched.version).toBe(4);
    expect(branched.parentVersionId).toBe('a_1@v2');
    expect(branched.contentJsonb).toEqual({ v: 'branched-from-2' });
  });

  it('inherits source content when no override', async () => {
    const repo = createInMemoryArtifactRepository();
    await createArtifact({
      tenantId: 't_abc',
      threadId: 'thr_1',
      artifactType: 'doc',
      contentJsonb: { body: 'original draft' },
      idGenerator: () => 'a_1',
      repository: repo,
    });
    const branched = await branchArtifact({
      tenantId: 't_abc',
      threadId: 'thr_1',
      id: 'a_1',
      fromVersion: 1,
      repository: repo,
    });
    expect(branched.contentJsonb).toEqual({ body: 'original draft' });
  });

  it('throws when source version does not exist', async () => {
    const repo = createInMemoryArtifactRepository();
    await expect(
      branchArtifact({
        tenantId: 't_abc',
        threadId: 'thr_1',
        id: 'missing',
        fromVersion: 7,
        repository: repo,
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe('listArtifactVersions', () => {
  it('returns every version', async () => {
    const repo = createInMemoryArtifactRepository();
    await createArtifact({
      tenantId: 't_abc',
      threadId: 'thr_1',
      artifactType: 'doc',
      contentJsonb: {},
      idGenerator: () => 'a_1',
      repository: repo,
    });
    await bumpArtifactVersion({
      tenantId: 't_abc',
      threadId: 'thr_1',
      id: 'a_1',
      contentJsonb: {},
      repository: repo,
    });
    const versions = await listArtifactVersions({
      tenantId: 't_abc',
      threadId: 'thr_1',
      id: 'a_1',
      repository: repo,
    });
    expect(versions.length).toBe(2);
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
  });
});

describe('artifactVersionKey', () => {
  it('formats id@vN', () => {
    expect(artifactVersionKey({ id: 'a_1', version: 4 })).toBe('a_1@v4');
  });
});
