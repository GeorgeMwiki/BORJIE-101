/**
 * Round-trip tests for the in-memory adapter.
 */

import { describe, it, expect } from 'vitest';
import { createInMemoryStorageAdapter } from '../in-memory.js';
import { tenantScopedPath } from '../types.js';

describe('createInMemoryStorageAdapter', () => {
  it('uploads + lists + deletes a single object', async () => {
    const sa = createInMemoryStorageAdapter();
    const path = tenantScopedPath('t1', 'leases/lease-1.pdf');
    const up = await sa.upload('documents', path, 'hello world', 'text/plain');
    expect(up.path).toBe(path);
    expect(up.size).toBe(11);

    const listed = await sa.list('documents');
    expect(listed.length).toBe(1);
    expect(listed[0]?.path).toBe(path);
    expect(listed[0]?.size).toBe(11);

    await sa.delete('documents', path);
    const after = await sa.list('documents');
    expect(after.length).toBe(0);
  });

  it('issues opaque memory:// URLs with future expiry', async () => {
    const sa = createInMemoryStorageAdapter();
    await sa.upload('reports', 't1/r1.pdf', 'x', 'application/pdf');
    const url = await sa.getUrl('reports', 't1/r1.pdf', 600);
    expect(url.url).toBe('memory://reports/t1/r1.pdf');
    expect(url.expiresAt.getTime()).toBeGreaterThan(Date.now() + 599_000);
  });

  it('filters list() by prefix', async () => {
    const sa = createInMemoryStorageAdapter();
    await sa.upload('media-photos', 't1/a.jpg', 'a', 'image/jpeg');
    await sa.upload('media-photos', 't1/b.jpg', 'b', 'image/jpeg');
    await sa.upload('media-photos', 't2/c.jpg', 'c', 'image/jpeg');

    const t1 = await sa.list('media-photos', 't1/');
    expect(t1.length).toBe(2);
    const t2 = await sa.list('media-photos', 't2/');
    expect(t2.length).toBe(1);
  });

  it('isolates objects across buckets', async () => {
    const sa = createInMemoryStorageAdapter();
    await sa.upload('avatars', 't1/me.png', 'a', 'image/png');
    await sa.upload('reports', 't1/r.pdf', 'r', 'application/pdf');
    expect((await sa.list('avatars')).length).toBe(1);
    expect((await sa.list('reports')).length).toBe(1);
    expect((await sa.list('documents')).length).toBe(0);
  });

  it('upsert semantics: re-uploading the same path overwrites', async () => {
    const sa = createInMemoryStorageAdapter();
    await sa.upload('documents', 't1/x.pdf', 'one', 'text/plain');
    await sa.upload('documents', 't1/x.pdf', 'two-and-more', 'text/plain');
    const l = await sa.list('documents');
    expect(l.length).toBe(1);
    expect(l[0]?.size).toBe(12);
  });

  it('delete of non-existent object is a no-op', async () => {
    const sa = createInMemoryStorageAdapter();
    await expect(sa.delete('documents', 'nope')).resolves.toBeUndefined();
  });

  it('accepts string, Uint8Array, ArrayBuffer content', async () => {
    const sa = createInMemoryStorageAdapter();
    await sa.upload('reports', 'a/s.txt', 'hi', 'text/plain');
    await sa.upload(
      'reports',
      'a/u.bin',
      new Uint8Array([1, 2, 3]),
      'application/octet-stream',
    );
    const ab = new ArrayBuffer(4);
    new DataView(ab).setUint32(0, 0xdeadbeef);
    await sa.upload('reports', 'a/a.bin', ab, 'application/octet-stream');
    const l = await sa.list('reports', 'a/');
    expect(l.length).toBe(3);
  });
});
