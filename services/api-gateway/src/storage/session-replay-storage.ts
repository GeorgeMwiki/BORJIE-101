/**
 * Session replay cold storage — Central Command Phase B (B5) + Phase C (C6).
 *
 * Port-based adapter for the gzip-compressed, PII-masked rrweb event
 * blobs uploaded by the client recorder. The Drizzle service
 * (`createSessionReplayChunksService` in `@borjie/database`) holds
 * the metadata index; this module holds the byte payload.
 *
 * Two implementations:
 *
 *   - createLocalFileStorage({ rootDir })
 *       Writes one file per chunk under `${rootDir}/<chunkId>.gz`.
 *       Default for dev + tests; resolves to `/tmp/session-replay/` when
 *       no rootDir is supplied. Returns `file://...` URIs.
 *
 *   - createS3Storage({ bucket, region, keyPrefix?, endpoint? })
 *       Real `@aws-sdk/client-s3` wiring (installed at Phase C6).
 *       Uploads with `PutObjectCommand` (gzip ContentEncoding); downloads
 *       with `GetObjectCommand` and normalises the streaming body to a
 *       `Uint8Array`. Returns `s3://<bucket>/<key>` URIs. Supports an
 *       optional `endpoint` for MinIO / S3-compatible backends.
 *
 * `selectSessionReplayStorage(env)` is the composition helper used by
 * `services/api-gateway/src/index.ts` — it picks S3 when
 * `AWS_S3_BUCKET` is set (with `AWS_REGION`), otherwise local FS.
 *
 * ── Recognised env vars ────────────────────────────────────────────────
 *   AWS_S3_BUCKET            (required for S3) Target bucket name.
 *   AWS_REGION               (required for S3) AWS region name.
 *   AWS_S3_PREFIX            Optional key prefix; defaults to
 *                            `session-replay/`.
 *   AWS_S3_ENDPOINT          Optional override (MinIO / S3-compatible).
 *   SESSION_REPLAY_LOCAL_DIR Optional local rootDir for the FS adapter.
 *
 *   Legacy aliases also honoured for backwards-compat with B5:
 *   S3_SESSION_REPLAY_BUCKET → AWS_S3_BUCKET
 *
 * Hard rules:
 *   - PII masking is the client's responsibility (rrweb's `maskAllInputs`
 *     + the `pii-mask.ts` selector list). The storage adapter never sees
 *     the cleartext bytes.
 *   - No `download()` retries — the replay viewer is a manual, low-
 *     frequency action; transient S3 errors propagate to the operator.
 *   - Default production backend is still LOCAL (no `AWS_S3_BUCKET`) so
 *     existing deployments are unchanged.
 */

import { promises as fs } from 'node:fs';
import { join as joinPath } from 'node:path';
import { tmpdir } from 'node:os';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';

export type SessionReplayStorageKind = 'local' | 's3';

export interface SessionReplayStorageUploadArgs {
  readonly chunkId: string;
  readonly gzipBytes: Uint8Array;
}

export interface SessionReplayStorageUploadResult {
  readonly storageUri: string;
}

export interface SessionReplayStoragePort {
  readonly kind: SessionReplayStorageKind;
  upload(
    args: SessionReplayStorageUploadArgs,
  ): Promise<SessionReplayStorageUploadResult>;
  download(chunkIdOrUri: string): Promise<Uint8Array>;
}

// ─────────────────────────────────────────────────────────────────────
// Local-file implementation
// ─────────────────────────────────────────────────────────────────────

export interface LocalFileStorageConfig {
  readonly rootDir?: string;
}

export function createLocalFileStorage(
  config: LocalFileStorageConfig = {},
): SessionReplayStoragePort {
  const rootDir = config.rootDir ?? joinPath(tmpdir(), 'session-replay');
  let ensured = false;
  async function ensureRoot(): Promise<void> {
    if (ensured) return;
    // `rootDir` is operator-configured at startup (never tenant input).
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.mkdir(rootDir, { recursive: true });
    ensured = true;
  }
  return {
    kind: 'local',
    async upload({ chunkId, gzipBytes }) {
      if (!chunkId || !isSafeChunkId(chunkId)) {
        throw new Error(
          `LocalFileStorage.upload: unsafe chunkId '${chunkId}'`,
        );
      }
      await ensureRoot();
      const filePath = joinPath(rootDir, `${chunkId}.gz`);
      // `chunkId` validated by `isSafeChunkId` (UUID-only) above; the
      // join with `rootDir` cannot traverse out of the storage root.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.writeFile(filePath, gzipBytes);
      return { storageUri: `file://${filePath}` };
    },
    async download(chunkIdOrUri) {
      const filePath = resolveLocalPath(rootDir, chunkIdOrUri);
      try {
        // `resolveLocalPath` enforces the path stays within `rootDir`
        // and rejects directory-traversal payloads.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const buf = await fs.readFile(filePath);
        return new Uint8Array(buf);
      } catch (error) {
        throw new Error(
          `LocalFileStorage.download: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  };
}

function resolveLocalPath(rootDir: string, chunkIdOrUri: string): string {
  if (chunkIdOrUri.startsWith('file://')) {
    return chunkIdOrUri.slice('file://'.length);
  }
  if (!isSafeChunkId(chunkIdOrUri)) {
    throw new Error(
      `LocalFileStorage.download: unsafe chunkId '${chunkIdOrUri}'`,
    );
  }
  return joinPath(rootDir, `${chunkIdOrUri}.gz`);
}

/** A chunkId must be a UUID-like opaque token. Path-traversal characters
 *  reject the request before any FS call. */
function isSafeChunkId(id: string): boolean {
  return /^[A-Za-z0-9_\-]{4,128}$/.test(id);
}

// ─────────────────────────────────────────────────────────────────────
// S3 implementation
// ─────────────────────────────────────────────────────────────────────

export interface S3StorageConfig {
  readonly bucket: string;
  readonly region: string;
  /** Optional key prefix — defaults to `session-replay/`. */
  readonly keyPrefix?: string;
  /** Optional endpoint override for MinIO / S3-compatible backends. */
  readonly endpoint?: string;
  /** Test seam — inject a pre-built S3Client. */
  readonly client?: Pick<S3Client, 'send'>;
}

const DEFAULT_KEY_PREFIX = 'session-replay/';

/**
 * Build a real S3-backed adapter. Constructs an `S3Client` with the
 * provided region (and optional `endpoint`) unless an already-built
 * `client` is injected via config (used by tests).
 */
export function createS3Storage(
  config: S3StorageConfig,
): SessionReplayStoragePort {
  if (!config.bucket) {
    throw new Error('createS3Storage: `bucket` is required');
  }
  if (!config.region) {
    throw new Error('createS3Storage: `region` is required');
  }
  const keyPrefix = normalisePrefix(config.keyPrefix ?? DEFAULT_KEY_PREFIX);
  const client: Pick<S3Client, 'send'> =
    config.client ??
    buildS3Client({
      region: config.region,
      ...(config.endpoint !== undefined ? { endpoint: config.endpoint } : {}),
    });

  return {
    kind: 's3',
    async upload({ chunkId, gzipBytes }) {
      if (!isSafeChunkId(chunkId)) {
        throw new Error(`S3Storage.upload: unsafe chunkId '${chunkId}'`);
      }
      const key = `${keyPrefix}${chunkId}.gz`;
      const cmd = new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: gzipBytes,
        ContentType: 'application/octet-stream',
        ContentEncoding: 'gzip',
      });
      try {
        // S3Client.send is overloaded; cast to satisfy the narrowed Pick<>.
        await (client.send as (cmd: unknown) => Promise<unknown>)(cmd);
      } catch (error) {
        throw new Error(
          `S3Storage.upload: failed to upload '${chunkId}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return { storageUri: `s3://${config.bucket}/${key}` };
    },
    async download(chunkIdOrUri) {
      const key = resolveS3Key(config.bucket, keyPrefix, chunkIdOrUri);
      const cmd = new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
      });
      let out: GetObjectResponseLike;
      try {
        out = (await (client.send as (cmd: unknown) => Promise<unknown>)(
          cmd,
        )) as GetObjectResponseLike;
      } catch (error) {
        throw new Error(
          `S3Storage.download: failed to fetch '${key}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      if (!out || !out.Body) {
        throw new Error(`S3Storage.download: empty body for '${key}'`);
      }
      return streamBodyToUint8Array(out.Body);
    },
  };
}

function buildS3Client(opts: { region: string; endpoint?: string }): S3Client {
  const cfg: S3ClientConfig = { region: opts.region };
  if (opts.endpoint) {
    cfg.endpoint = opts.endpoint;
    // Path-style is required for MinIO and most S3-compatible servers.
    cfg.forcePathStyle = true;
  }
  return new S3Client(cfg);
}

function normalisePrefix(prefix: string): string {
  if (!prefix) return '';
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

function resolveS3Key(
  bucket: string,
  keyPrefix: string,
  chunkIdOrUri: string,
): string {
  if (chunkIdOrUri.startsWith('s3://')) {
    const expectedPrefix = `s3://${bucket}/`;
    if (!chunkIdOrUri.startsWith(expectedPrefix)) {
      throw new Error(
        `S3Storage.download: URI bucket mismatch (expected '${bucket}')`,
      );
    }
    return chunkIdOrUri.slice(expectedPrefix.length);
  }
  if (!isSafeChunkId(chunkIdOrUri)) {
    throw new Error(
      `S3Storage.download: unsafe chunkId '${chunkIdOrUri}'`,
    );
  }
  return `${keyPrefix}${chunkIdOrUri}.gz`;
}

/**
 * The AWS v3 SDK returns the response body as a Node `Readable`, a Web
 * `ReadableStream`, or a `Blob` depending on the runtime. All three
 * implement `transformToByteArray()` via the SDK's `@smithy/util-stream`
 * mixin. We prefer that helper, then fall back to async-iteration for
 * test doubles that ship a bare `AsyncIterable<Uint8Array>`.
 */
interface GetObjectResponseLike {
  Body?: {
    transformToByteArray?: () => Promise<Uint8Array>;
  } & Partial<AsyncIterable<Uint8Array>>;
}

async function streamBodyToUint8Array(
  body: NonNullable<GetObjectResponseLike['Body']>,
): Promise<Uint8Array> {
  if (typeof body.transformToByteArray === 'function') {
    return body.transformToByteArray();
  }
  const iterable = body as AsyncIterable<Uint8Array>;
  if (typeof iterable[Symbol.asyncIterator] !== 'function') {
    throw new Error('S3Storage.download: response Body is not iterable');
  }
  const chunks: Uint8Array[] = [];
  for await (const c of iterable) chunks.push(c);
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged;
}

// ─────────────────────────────────────────────────────────────────────
// Composition selector
// ─────────────────────────────────────────────────────────────────────

export interface StorageEnv {
  readonly AWS_REGION?: string;
  readonly AWS_S3_BUCKET?: string;
  readonly AWS_S3_PREFIX?: string;
  readonly AWS_S3_ENDPOINT?: string;
  /** Legacy alias (B5). Used as a fallback for `AWS_S3_BUCKET`. */
  readonly S3_SESSION_REPLAY_BUCKET?: string;
  readonly SESSION_REPLAY_LOCAL_DIR?: string;
}

export interface StorageSelectionLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
}

const defaultLogger: StorageSelectionLogger = {
  // eslint-disable-next-line no-console
  info: (m, c) => console.info(`[session-replay] ${m}`, c ?? {}),
  // eslint-disable-next-line no-console
  warn: (m, c) => console.warn(`[session-replay] ${m}`, c ?? {}),
};

/**
 * Pick the storage backend based on environment variables.
 *
 *  - Returns S3 when `AWS_S3_BUCKET` (or legacy `S3_SESSION_REPLAY_BUCKET`)
 *    AND `AWS_REGION` are set.
 *  - Otherwise returns local FS (default — preserves existing deployments).
 *
 * Falls back to local on any S3 init failure so the api-gateway can boot
 * even if the SDK is partially mis-configured.
 */
export function selectSessionReplayStorage(
  env: StorageEnv,
  logger: StorageSelectionLogger = defaultLogger,
): SessionReplayStoragePort {
  const bucket = env.AWS_S3_BUCKET ?? env.S3_SESSION_REPLAY_BUCKET;
  const wantsS3 = !!bucket && !!env.AWS_REGION;

  if (wantsS3) {
    try {
      const store = createS3Storage({
        bucket: bucket as string,
        region: env.AWS_REGION as string,
        ...(env.AWS_S3_PREFIX !== undefined ? { keyPrefix: env.AWS_S3_PREFIX } : {}),
        ...(env.AWS_S3_ENDPOINT !== undefined ? { endpoint: env.AWS_S3_ENDPOINT } : {}),
      });
      logger.info('storage backend selected', {
        backend: 's3',
        bucket,
        region: env.AWS_REGION,
        prefix: env.AWS_S3_PREFIX ?? DEFAULT_KEY_PREFIX,
        endpoint: env.AWS_S3_ENDPOINT ?? null,
      });
      return store;
    } catch (error) {
      logger.warn('S3 storage init failed — falling back to local FS', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  logger.info('storage backend selected', {
    backend: 'local',
    rootDir: env.SESSION_REPLAY_LOCAL_DIR ?? '<tmpdir>/session-replay',
  });
  return createLocalFileStorage(
    env.SESSION_REPLAY_LOCAL_DIR !== undefined
      ? { rootDir: env.SESSION_REPLAY_LOCAL_DIR }
      : {},
  );
}
