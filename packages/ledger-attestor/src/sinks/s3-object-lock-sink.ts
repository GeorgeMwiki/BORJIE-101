/**
 * S3 object-lock external sink (LP-19).
 *
 * Publishes a signed checkpoint as an immutable S3 object under
 * Object-Lock (WORM) retention. Once written under a COMPLIANCE-mode
 * retention, the object cannot be overwritten or deleted by ANY
 * principal — including root — until the retention period elapses.
 * That is the tamper-evidence guarantee: an attacker who edits the
 * ledger cannot also rewrite the historical Merkle roots that would
 * expose the edit.
 *
 * We DO NOT depend on `@aws-sdk/client-s3` here — the actual put is
 * injected via {@link ObjectPutPort}. This keeps `@borjie/ledger-attestor`
 * dependency-light (pure-ish), lets the gateway/worker own the AWS SDK
 * version, and makes the sink unit-testable with a fake put. The same
 * port shape fits a transparency-log adapter (Rekor `POST /api/v1/log/entries`)
 * — swap the `ObjectPutPort` for an HTTP append and reuse the sink.
 *
 * Object key layout (sortable, one object per checkpoint):
 *   {prefix}/{chainId}/{attestedAtIso}-{merkleRoot}.json
 *
 * @module @borjie/ledger-attestor/sinks/s3-object-lock-sink
 */

import type {
  ExternalSinkPort,
  ExternalSinkReceipt,
  SignedCheckpoint,
} from '../types.js';

/** What the sink hands the injected backend to write. */
export interface ObjectPutRequest {
  readonly bucket: string;
  readonly key: string;
  readonly body: string;
  readonly contentType: string;
  /** ISO 8601 retain-until — backend maps to S3 ObjectLockRetainUntilDate. */
  readonly retainUntilIso: string;
  /** `COMPLIANCE` (immutable even to root) or `GOVERNANCE` (bypassable by a privileged role). */
  readonly retentionMode: 'COMPLIANCE' | 'GOVERNANCE';
}

export interface ObjectPutResult {
  /** S3 versionId (or any opaque locator the backend returns). */
  readonly versionId: string;
}

/**
 * Injected write backend. Production wires this to `PutObjectCommand`
 * with `ObjectLockMode` + `ObjectLockRetainUntilDate`. MUST throw on
 * failure so the orchestrator records a failed attestation (fail-loud).
 */
export interface ObjectPutPort {
  put(req: ObjectPutRequest): Promise<ObjectPutResult>;
}

export interface S3ObjectLockSinkConfig {
  readonly bucket: string;
  /** Key prefix, e.g. `ledger-attestations`. */
  readonly prefix: string;
  /** Object-lock retention window in days (regulatory retention). */
  readonly retentionDays: number;
  readonly retentionMode?: 'COMPLIANCE' | 'GOVERNANCE';
  readonly name?: string;
  /** Injectable clock (retain-until = now + retentionDays). */
  readonly now?: () => Date;
}

/** Sanitise a chainId for safe use inside an S3 object key. */
function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._:-]/g, '_');
}

export function createS3ObjectLockSink(
  put: ObjectPutPort,
  config: S3ObjectLockSinkConfig,
): ExternalSinkPort {
  const name = config.name ?? 's3-object-lock';
  const retentionMode = config.retentionMode ?? 'COMPLIANCE';
  const clock = config.now ?? (() => new Date());

  return {
    name,
    async publish(checkpoint: SignedCheckpoint): Promise<ExternalSinkReceipt> {
      const { payload } = checkpoint;
      const key =
        `${config.prefix}/${safeSegment(payload.chainId)}/` +
        `${payload.attestedAtIso}-${payload.merkleRoot}.json`;
      const retainUntilIso = new Date(
        clock().getTime() + config.retentionDays * 24 * 60 * 60 * 1000,
      ).toISOString();

      const result = await put.put({
        bucket: config.bucket,
        key,
        body: JSON.stringify(checkpoint),
        contentType: 'application/json',
        retainUntilIso,
        retentionMode,
      });

      return Object.freeze({
        sink: name,
        locator: `s3://${config.bucket}/${key}#${result.versionId}`,
      });
    },
  };
}
