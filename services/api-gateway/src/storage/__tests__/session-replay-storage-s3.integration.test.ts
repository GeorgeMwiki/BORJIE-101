/**
 * session-replay-storage — S3 integration tests (mocked client).
 *
 * Uses the `client` injection seam on `createS3Storage` to plug in a
 * Vitest-spy implementation of `S3Client.send`. No real AWS calls.
 *
 * Covers:
 *   1. upload happy path (PutObjectCommand fields).
 *   2. upload sets ContentType=application/octet-stream + ContentEncoding=gzip.
 *   3. upload applies the keyPrefix (default + custom).
 *   4. upload network failure wraps the error and includes the chunkId.
 *   5. upload rejects unsafe chunkId before send().
 *   6. download happy path via chunkId — converts stream → Uint8Array.
 *   7. download via s3:// URI re-uses the embedded key.
 *   8. download with an AsyncIterable body (no transformToByteArray).
 *   9. download missing-key 404 surfaces the underlying message.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import {
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { createS3Storage } from '../session-replay-storage';

interface SendSpy {
  send: ReturnType<typeof vi.fn>;
}

function makeClient(impl?: (cmd: unknown) => unknown): SendSpy {
  const fn = vi.fn(async (cmd: unknown) => (impl ? impl(cmd) : {}));
  return { send: fn };
}

function bodyWithTransform(bytes: Uint8Array) {
  return {
    transformToByteArray: vi.fn(async () => bytes),
  };
}

describe('S3Storage.upload (mocked send)', () => {
  let client: SendSpy;

  beforeEach(() => {
    client = makeClient();
  });

  it('issues a PutObjectCommand with the correct bucket + key + body', async () => {
    const store = createS3Storage({
      bucket: 'replay-prod',
      region: 'us-east-1',
      client: client as unknown as Parameters<typeof createS3Storage>[0]['client'],
    });
    const bytes = new Uint8Array([9, 8, 7, 6, 5]);
    const out = await store.upload({ chunkId: 'chunk-001', gzipBytes: bytes });

    expect(out.storageUri).toBe('s3://replay-prod/session-replay/chunk-001.gz');
    expect(client.send).toHaveBeenCalledTimes(1);
    const cmd = client.send.mock.calls[0]?.[0] as PutObjectCommand;
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input.Bucket).toBe('replay-prod');
    expect(cmd.input.Key).toBe('session-replay/chunk-001.gz');
    expect(cmd.input.Body).toBe(bytes);
  });

  it('sets ContentType=application/octet-stream and ContentEncoding=gzip', async () => {
    const store = createS3Storage({
      bucket: 'b',
      region: 'us-east-1',
      client: client as unknown as Parameters<typeof createS3Storage>[0]['client'],
    });
    await store.upload({ chunkId: 'hdr-test', gzipBytes: new Uint8Array([1]) });
    const cmd = client.send.mock.calls[0]?.[0] as PutObjectCommand;
    expect(cmd.input.ContentType).toBe('application/octet-stream');
    expect(cmd.input.ContentEncoding).toBe('gzip');
  });

  it('applies a custom keyPrefix and normalises a missing trailing slash', async () => {
    const store = createS3Storage({
      bucket: 'b',
      region: 'us-east-1',
      keyPrefix: 'tenants/acme/replays',
      client: client as unknown as Parameters<typeof createS3Storage>[0]['client'],
    });
    const out = await store.upload({
      chunkId: 'pfx-1',
      gzipBytes: new Uint8Array([0]),
    });
    expect(out.storageUri).toBe('s3://b/tenants/acme/replays/pfx-1.gz');
    const cmd = client.send.mock.calls[0]?.[0] as PutObjectCommand;
    expect(cmd.input.Key).toBe('tenants/acme/replays/pfx-1.gz');
  });

  it('wraps a network failure with a descriptive error', async () => {
    const failing = makeClient(() => {
      throw new Error('ECONNRESET');
    });
    const store = createS3Storage({
      bucket: 'b',
      region: 'us-east-1',
      client: failing as unknown as Parameters<typeof createS3Storage>[0]['client'],
    });
    await expect(
      store.upload({ chunkId: 'will-fail', gzipBytes: new Uint8Array([1]) }),
    ).rejects.toThrow(/S3Storage\.upload.*will-fail.*ECONNRESET/);
  });

  it('rejects unsafe chunkId before any send() call', async () => {
    const store = createS3Storage({
      bucket: 'b',
      region: 'us-east-1',
      client: client as unknown as Parameters<typeof createS3Storage>[0]['client'],
    });
    await expect(
      store.upload({
        chunkId: '../../oops',
        gzipBytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/unsafe/);
    expect(client.send).not.toHaveBeenCalled();
  });
});

describe('S3Storage.download (mocked send)', () => {
  it('issues a GetObjectCommand and returns the bytes via transformToByteArray', async () => {
    const bytes = new Uint8Array([10, 20, 30, 40]);
    const client = makeClient(() => ({ Body: bodyWithTransform(bytes) }));
    const store = createS3Storage({
      bucket: 'replay-prod',
      region: 'us-east-1',
      client: client as unknown as Parameters<typeof createS3Storage>[0]['client'],
    });
    const out = await store.download('chunk-dl-1');
    expect(Array.from(out)).toEqual([10, 20, 30, 40]);
    const cmd = client.send.mock.calls[0]?.[0] as GetObjectCommand;
    expect(cmd).toBeInstanceOf(GetObjectCommand);
    expect(cmd.input.Bucket).toBe('replay-prod');
    expect(cmd.input.Key).toBe('session-replay/chunk-dl-1.gz');
  });

  it('resolves a key from an s3:// URI argument', async () => {
    const bytes = new Uint8Array([1]);
    const client = makeClient(() => ({ Body: bodyWithTransform(bytes) }));
    const store = createS3Storage({
      bucket: 'replay-prod',
      region: 'us-east-1',
      client: client as unknown as Parameters<typeof createS3Storage>[0]['client'],
    });
    await store.download('s3://replay-prod/custom/path/chunk-x.gz');
    const cmd = client.send.mock.calls[0]?.[0] as GetObjectCommand;
    expect(cmd.input.Key).toBe('custom/path/chunk-x.gz');
  });

  it('falls back to AsyncIterable when transformToByteArray is absent', async () => {
    // Node Readable from a sequence of chunks → implements AsyncIterable.
    const stream = Readable.from([
      Uint8Array.from([1, 2]),
      Uint8Array.from([3, 4, 5]),
    ]);
    const client = makeClient(() => ({ Body: stream }));
    const store = createS3Storage({
      bucket: 'b',
      region: 'us-east-1',
      client: client as unknown as Parameters<typeof createS3Storage>[0]['client'],
    });
    const out = await store.download('iter-1');
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it('surfaces a 404 / NoSuchKey error from the underlying send()', async () => {
    const failing = makeClient(() => {
      const err = new Error('NoSuchKey: The specified key does not exist.');
      throw err;
    });
    const store = createS3Storage({
      bucket: 'b',
      region: 'us-east-1',
      client: failing as unknown as Parameters<typeof createS3Storage>[0]['client'],
    });
    await expect(store.download('gone')).rejects.toThrow(
      /S3Storage\.download.*session-replay\/gone\.gz.*NoSuchKey/,
    );
  });

  it('throws when the response Body is missing entirely', async () => {
    const client = makeClient(() => ({ Body: undefined }));
    const store = createS3Storage({
      bucket: 'b',
      region: 'us-east-1',
      client: client as unknown as Parameters<typeof createS3Storage>[0]['client'],
    });
    await expect(store.download('empty-body')).rejects.toThrow(/empty body/);
  });

  it('rejects an s3:// URI whose bucket does not match config.bucket', async () => {
    const client = makeClient(() => ({
      Body: bodyWithTransform(new Uint8Array([0])),
    }));
    const store = createS3Storage({
      bucket: 'mine',
      region: 'us-east-1',
      client: client as unknown as Parameters<typeof createS3Storage>[0]['client'],
    });
    await expect(
      store.download('s3://someone-elses-bucket/foo.gz'),
    ).rejects.toThrow(/bucket mismatch/);
    expect(client.send).not.toHaveBeenCalled();
  });
});
