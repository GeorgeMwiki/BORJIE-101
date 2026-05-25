/**
 * Round-trip tests for the local-disk adapter.
 *
 * Uses os.tmpdir() so the tests don't pollute the repo.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createLocalDiskStorageAdapter,
  localUrlToPath,
} from '../local-disk.js';
import { tenantScopedPath } from '../types.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('createLocalDiskStorageAdapter', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storage-adapter-test-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes file to disk + recovers via getUrl', async () => {
    const sa = createLocalDiskStorageAdapter({ rootDir: root });
    const path = tenantScopedPath('t1', 'leases/lease.pdf');
    const r = await sa.upload('documents', path, 'hello-disk', 'text/plain');
    expect(r.size).toBe(10);

    const url = await sa.getUrl('documents', path);
    expect(url.url.startsWith('file://')).toBe(true);
    const onDisk = await readFile(localUrlToPath(url.url), 'utf8');
    expect(onDisk).toBe('hello-disk');
  });

  it('lists nested objects with relative paths', async () => {
    const sa = createLocalDiskStorageAdapter({ rootDir: root });
    await sa.upload('reports', 't1/2026/q1.pdf', 'a', 'application/pdf');
    await sa.upload('reports', 't1/2026/q2.pdf', 'b', 'application/pdf');
    await sa.upload('reports', 't2/2026/q1.pdf', 'c', 'application/pdf');

    const all = await sa.list('reports');
    expect(all.length).toBe(3);
    const t1 = await sa.list('reports', 't1/');
    expect(t1.length).toBe(2);
    const t1Paths = t1.map((o) => o.path).sort();
    expect(t1Paths).toEqual(['t1/2026/q1.pdf', 't1/2026/q2.pdf']);
  });

  it('deletes a file that exists', async () => {
    const sa = createLocalDiskStorageAdapter({ rootDir: root });
    await sa.upload('documents', 't1/x.pdf', 'x', 'application/pdf');
    expect((await sa.list('documents')).length).toBe(1);
    await sa.delete('documents', 't1/x.pdf');
    expect((await sa.list('documents')).length).toBe(0);
  });

  it('delete of non-existent file is a no-op', async () => {
    const sa = createLocalDiskStorageAdapter({ rootDir: root });
    await expect(sa.delete('documents', 'absent.pdf')).resolves.toBeUndefined();
  });

  it('rejects bucket with .. or path separators (escape attempt)', async () => {
    const sa = createLocalDiskStorageAdapter({ rootDir: root });
    await expect(sa.list('../escape')).rejects.toThrow();
    await expect(
      sa.upload('../etc', 'passwd', 'pwned', 'text/plain'),
    ).rejects.toThrow();
  });

  it('rejects path containing .. (escape attempt)', async () => {
    const sa = createLocalDiskStorageAdapter({ rootDir: root });
    await expect(
      sa.upload('documents', 't1/../secret.pdf', 'pwned', 'text/plain'),
    ).rejects.toThrow();
  });

  it('list of empty / missing bucket returns []', async () => {
    const sa = createLocalDiskStorageAdapter({ rootDir: root });
    const empty = await sa.list('reports');
    expect(empty).toEqual([]);
  });
});
