/**
 * `RlvrVerificationRepository` — persistence port for `rlvr_verifications`.
 */

import type { VerificationResult } from '../types.js';

export interface StoredVerification {
  readonly id: string;
  readonly traceId: string;
  readonly tenantId: string;
  readonly result: VerificationResult;
  readonly verifiedAt: string;
  readonly auditHash: string;
}

export interface RlvrVerificationRepository {
  create(record: StoredVerification): Promise<StoredVerification>;
  listByTrace(traceId: string): Promise<ReadonlyArray<StoredVerification>>;
}

export function createInMemoryRlvrVerificationRepository(): RlvrVerificationRepository {
  let records: ReadonlyArray<StoredVerification> = Object.freeze([]);

  return {
    async create(record: StoredVerification): Promise<StoredVerification> {
      if (records.some((r) => r.id === record.id)) {
        throw new Error(`Verification already exists: ${record.id}`);
      }
      records = Object.freeze([...records, record]);
      return record;
    },

    async listByTrace(
      traceId: string,
    ): Promise<ReadonlyArray<StoredVerification>> {
      return Object.freeze(records.filter((r) => r.traceId === traceId));
    },
  };
}
