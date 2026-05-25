/**
 * Tests for the Supabase storage adapter — mocked transport.
 *
 * Verifies:
 *   - Logical bucket names get prefixed with borjie-<env>-.
 *   - Errors from the SDK become StorageAdapterError.
 *   - Round-trip semantics (upload → getUrl → list → delete).
 */

import { describe, it, expect, vi } from 'vitest';
import { createSupabaseStorageAdapter } from '../supabase.js';
import { StorageAdapterError } from '../types.js';

interface MockStorageFile {
  bucket: string;
  path: string;
  bytes: Uint8Array;
  contentType: string;
}

function makeMockSupabase(opts: {
  uploadError?: { message: string };
  signedUrlError?: { message: string };
  removeError?: { message: string };
  listError?: { message: string };
  preloaded?: MockStorageFile[];
} = {}): {
  client: Parameters<typeof createSupabaseStorageAdapter>[0]['supabase'];
  files: MockStorageFile[];
} {
  const files: MockStorageFile[] = [...(opts.preloaded ?? [])];

  const bucketApi = (bucket: string) => ({
    upload: vi.fn(
      async (
        path: string,
        bytes: Uint8Array,
        meta: { contentType: string },
      ) => {
        if (opts.uploadError) return { data: null, error: opts.uploadError };
        files.push({ bucket, path, bytes, contentType: meta.contentType });
        return { data: { path }, error: null };
      },
    ),
    createSignedUrl: vi.fn(async (path: string, expiresIn: number) => {
      if (opts.signedUrlError)
        return { data: null, error: opts.signedUrlError };
      return {
        data: { signedUrl: `https://example.test/sig/${bucket}/${path}?exp=${expiresIn}` },
        error: null,
      };
    }),
    remove: vi.fn(async (paths: string[]) => {
      if (opts.removeError) return { data: null, error: opts.removeError };
      for (const p of paths) {
        const idx = files.findIndex((f) => f.bucket === bucket && f.path === p);
        if (idx >= 0) files.splice(idx, 1);
      }
      return { data: paths.map((p) => ({ name: p })), error: null };
    }),
    list: vi.fn(async (prefix: string) => {
      if (opts.listError) return { data: null, error: opts.listError };
      const matched = files
        .filter((f) => f.bucket === bucket)
        .filter((f) => !prefix || f.path.startsWith(prefix));
      return {
        data: matched.map((f) => ({
          name: prefix
            ? f.path.slice(prefix.replace(/\/$/, '').length + 1)
            : f.path,
          updated_at: new Date('2026-01-01').toISOString(),
          metadata: { size: f.bytes.byteLength },
        })),
        error: null,
      };
    }),
  });

  const client = {
    storage: {
      from: vi.fn(bucketApi),
    },
  } as unknown as Parameters<
    typeof createSupabaseStorageAdapter
  >[0]['supabase'];

  return { client, files };
}

describe('createSupabaseStorageAdapter', () => {
  it('prefixes logical bucket with borjie-<env>-', async () => {
    const { client } = makeMockSupabase();
    const sa = createSupabaseStorageAdapter({
      supabase: client,
      environment: 'staging',
    });
    await sa.upload('documents', 't1/x.pdf', 'hi', 'text/plain');
    expect(client.storage.from).toHaveBeenCalledWith(
      'borjie-staging-documents',
    );
  });

  it('upload round-trips bytes and contentType', async () => {
    const { client, files } = makeMockSupabase();
    const sa = createSupabaseStorageAdapter({
      supabase: client,
      environment: 'production',
    });
    const r = await sa.upload(
      'media-photos',
      't1/a.jpg',
      'photo-bytes',
      'image/jpeg',
    );
    expect(r.path).toBe('t1/a.jpg');
    expect(r.size).toBe(11);
    expect(files.length).toBe(1);
    expect(files[0]?.contentType).toBe('image/jpeg');
  });

  it('upload error becomes StorageAdapterError', async () => {
    const { client } = makeMockSupabase({
      uploadError: { message: 'access denied' },
    });
    const sa = createSupabaseStorageAdapter({
      supabase: client,
      environment: 'dev',
    });
    await expect(
      sa.upload('documents', 't1/x.pdf', 'x', 'text/plain'),
    ).rejects.toThrow(StorageAdapterError);
  });

  it('getUrl returns a signed URL + expiry', async () => {
    const { client } = makeMockSupabase();
    const sa = createSupabaseStorageAdapter({
      supabase: client,
      environment: 'staging',
    });
    const u = await sa.getUrl('documents', 't1/x.pdf', 1800);
    expect(u.url).toContain('sig/borjie-staging-documents/t1/x.pdf');
    expect(u.expiresAt.getTime()).toBeGreaterThan(Date.now() + 1_799_000);
  });

  it('getUrl error becomes StorageAdapterError', async () => {
    const { client } = makeMockSupabase({
      signedUrlError: { message: 'not found' },
    });
    const sa = createSupabaseStorageAdapter({
      supabase: client,
      environment: 'dev',
    });
    await expect(sa.getUrl('documents', 'nope')).rejects.toThrow(
      StorageAdapterError,
    );
  });

  it('delete removes the file from the underlying bucket', async () => {
    const { client, files } = makeMockSupabase({
      preloaded: [
        {
          bucket: 'borjie-dev-documents',
          path: 't1/x.pdf',
          bytes: new Uint8Array([1]),
          contentType: 'text/plain',
        },
      ],
    });
    const sa = createSupabaseStorageAdapter({
      supabase: client,
      environment: 'dev',
    });
    expect(files.length).toBe(1);
    await sa.delete('documents', 't1/x.pdf');
    expect(files.length).toBe(0);
  });

  it('list returns objects with size + lastModified', async () => {
    const { client } = makeMockSupabase({
      preloaded: [
        {
          bucket: 'borjie-prod-reports',
          path: 't1/q1.pdf',
          bytes: new Uint8Array(1234),
          contentType: 'application/pdf',
        },
      ],
    });
    const sa = createSupabaseStorageAdapter({
      supabase: client,
      environment: 'prod',
    });
    const r = await sa.list('reports');
    expect(r.length).toBe(1);
    expect(r[0]?.size).toBe(1234);
    expect(r[0]?.lastModified).toBeInstanceOf(Date);
  });

  it('rejects missing supabase or environment', () => {
    expect(() =>
      createSupabaseStorageAdapter({
        supabase: undefined as unknown as Parameters<
          typeof createSupabaseStorageAdapter
        >[0]['supabase'],
        environment: 'dev',
      }),
    ).toThrow();
    expect(() =>
      createSupabaseStorageAdapter({
        supabase: makeMockSupabase().client,
        environment: '',
      }),
    ).toThrow();
  });
});
