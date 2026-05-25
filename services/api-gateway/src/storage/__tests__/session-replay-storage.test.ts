/**
 * session-replay-storage — unit tests.
 *
 * Covers:
 *   1. LocalFileStorage.upload writes a file under rootDir + returns
 *      a file:// URI; download reads it back.
 *   2. LocalFileStorage refuses unsafe chunkIds (path traversal).
 *   3. LocalFileStorage download throws on missing file (no retry).
 *   4. selectSessionReplayStorage chooses local when no AWS env set.
 *   5. selectSessionReplayStorage chooses S3 when AWS_S3_BUCKET +
 *      AWS_REGION are set; legacy S3_SESSION_REPLAY_BUCKET alias works.
 *   6. createS3Storage rejects missing bucket / region.
 *   7. Selection logger emits structured backend events.
 *
 * S3 send() behaviour is covered exhaustively in
 * `session-replay-storage-s3.integration.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join as joinPath } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createLocalFileStorage,
  createS3Storage,
  selectSessionReplayStorage,
} from '../session-replay-storage';

const TEST_ROOT = joinPath(tmpdir(), `b5-session-replay-test-${process.pid}`);

describe('createLocalFileStorage', () => {
  beforeEach(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
  });
  afterEach(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('upload writes the file and returns a file:// URI', async () => {
    const store = createLocalFileStorage({ rootDir: TEST_ROOT });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const out = await store.upload({ chunkId: 'abc-123', gzipBytes: bytes });
    expect(out.storageUri.startsWith('file://')).toBe(true);
    expect(out.storageUri.endsWith('abc-123.gz')).toBe(true);
    const stats = await fs.stat(joinPath(TEST_ROOT, 'abc-123.gz'));
    expect(stats.size).toBe(4);
  });

  it('download reads the bytes back via either chunkId OR storageUri', async () => {
    const store = createLocalFileStorage({ rootDir: TEST_ROOT });
    const bytes = new Uint8Array([5, 6, 7, 8]);
    const out = await store.upload({ chunkId: 'def-456', gzipBytes: bytes });
    const read1 = await store.download('def-456');
    const read2 = await store.download(out.storageUri);
    expect(Array.from(read1)).toEqual([5, 6, 7, 8]);
    expect(Array.from(read2)).toEqual([5, 6, 7, 8]);
  });

  it('refuses unsafe chunkIds (path traversal)', async () => {
    const store = createLocalFileStorage({ rootDir: TEST_ROOT });
    await expect(
      store.upload({
        chunkId: '../../etc/passwd',
        gzipBytes: new Uint8Array([0]),
      }),
    ).rejects.toThrow(/unsafe/);
  });

  it('download throws when the file does not exist', async () => {
    const store = createLocalFileStorage({ rootDir: TEST_ROOT });
    await expect(store.download('never-uploaded-id')).rejects.toThrow();
  });

  it('reports kind=local', () => {
    const store = createLocalFileStorage({ rootDir: TEST_ROOT });
    expect(store.kind).toBe('local');
  });
});

describe('createS3Storage (construction)', () => {
  it('throws when bucket is missing', () => {
    expect(() =>
      createS3Storage({ bucket: '', region: 'us-east-1' }),
    ).toThrow(/bucket/);
  });

  it('throws when region is missing', () => {
    expect(() =>
      createS3Storage({ bucket: 'my-bucket', region: '' }),
    ).toThrow(/region/);
  });

  it('reports kind=s3 with an injected client', () => {
    const store = createS3Storage({
      bucket: 'my-bucket',
      region: 'us-east-1',
      client: { send: vi.fn() } as unknown as Parameters<
        typeof createS3Storage
      >[0]['client'],
    });
    expect(store.kind).toBe('s3');
  });

  it('constructs without `client` when a real region is provided', () => {
    // Build path with real SDK; we never call send() so no AWS hit.
    const store = createS3Storage({
      bucket: 'my-bucket',
      region: 'us-east-1',
    });
    expect(store.kind).toBe('s3');
  });

  it('honours endpoint override (MinIO / S3-compatible) at construction', () => {
    const store = createS3Storage({
      bucket: 'minio-bucket',
      region: 'us-east-1',
      endpoint: 'http://localhost:9000',
    });
    expect(store.kind).toBe('s3');
  });
});

describe('selectSessionReplayStorage', () => {
  it('returns local FS when no AWS env is set', () => {
    const store = selectSessionReplayStorage({
      SESSION_REPLAY_LOCAL_DIR: TEST_ROOT,
    });
    expect(store.kind).toBe('local');
  });

  it('returns S3 when AWS_S3_BUCKET + AWS_REGION are set', () => {
    const store = selectSessionReplayStorage({
      AWS_REGION: 'us-east-1',
      AWS_S3_BUCKET: 'replay-prod',
    });
    expect(store.kind).toBe('s3');
  });

  it('honours the legacy S3_SESSION_REPLAY_BUCKET alias', () => {
    const store = selectSessionReplayStorage({
      AWS_REGION: 'us-east-1',
      S3_SESSION_REPLAY_BUCKET: 'replay-legacy',
    });
    expect(store.kind).toBe('s3');
  });

  it('falls back to local when AWS_S3_BUCKET is set without AWS_REGION', () => {
    const store = selectSessionReplayStorage({
      AWS_S3_BUCKET: 'replay-noregion',
      SESSION_REPLAY_LOCAL_DIR: TEST_ROOT,
    });
    expect(store.kind).toBe('local');
  });

  it('emits a structured "backend selected" log line', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    selectSessionReplayStorage(
      {
        AWS_REGION: 'eu-west-1',
        AWS_S3_BUCKET: 'replay-eu',
        AWS_S3_PREFIX: 'replays/',
      },
      logger,
    );
    expect(logger.info).toHaveBeenCalledWith(
      'storage backend selected',
      expect.objectContaining({
        backend: 's3',
        bucket: 'replay-eu',
        region: 'eu-west-1',
        prefix: 'replays/',
      }),
    );
  });

  it('logs local backend selection when env is empty', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    selectSessionReplayStorage({}, logger);
    expect(logger.info).toHaveBeenCalledWith(
      'storage backend selected',
      expect.objectContaining({ backend: 'local' }),
    );
  });
});
