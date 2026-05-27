/**
 * Seal a recommendation result with a PO-14-style audit hash.
 *
 * The seal is sha256 over the canonical-JSON of the result minus
 * `auditHash` itself, chained with `prevHash`. Replay-safe under a
 * seeded random — the same logical request + the same prevHash always
 * produces the same auditHash. This mirrors the audit convention
 * used by `forecast_runs` (PO-14) and by `anomaly_detections`
 * (migration 0070).
 */

import { canonicalJSON, sha256Hex } from './hash.js';
import type {
  AlgorithmTag,
  MatchTarget,
  RecommendationResult,
  ScoredItem,
} from '../types.js';

export interface SealArgs {
  readonly tenantId: string;
  readonly target: MatchTarget;
  readonly algorithm: AlgorithmTag;
  readonly userId: string;
  readonly topK: ReadonlyArray<ScoredItem>;
  readonly candidates: ReadonlyArray<string>;
  readonly servedAt: number;
  readonly prevHash?: string;
}

export function sealResult(args: SealArgs): RecommendationResult {
  const prevHash = args.prevHash ?? '';
  const payload = {
    tenantId: args.tenantId,
    target: args.target,
    algorithm: args.algorithm,
    userId: args.userId,
    topK: args.topK,
    candidates: args.candidates,
    servedAt: args.servedAt,
    prevHash,
  };
  const auditHash = sha256Hex(`${prevHash}|${canonicalJSON(payload)}`);
  return {
    ...payload,
    auditHash,
  };
}
