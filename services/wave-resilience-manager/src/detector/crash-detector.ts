/**
 * Crash detector — runs every 60 s.
 *
 * Per AGENT_SELF_REVIVAL_SPEC §3 R2 + §6:
 *   - For each wave whose latest progress row is in status='running'
 *     AND whose heartbeat_at is older than `staleHeartbeatMs`, emit a
 *     new progress row with status='crashed'.
 *   - Idempotent — running the sweep twice produces a single crashed
 *     row (the second sweep finds the wave already in 'crashed').
 *
 * Pure orchestration — all I/O goes through the injected repository.
 */

import type {
  ProgressRepository,
} from '../storage/progress-repository.js';
import { sealEvent, type AuditChainState } from '../audit/audit-emit.js';
import type { ResilienceLogger, WaveProgressEntry } from '../types.js';

export interface CrashDetectorDeps {
  readonly progress: ProgressRepository;
  readonly now?: () => Date;
  readonly staleHeartbeatMs: number;
  readonly chainState: AuditChainState;
  readonly logger?: ResilienceLogger;
}

export interface DetectorSweepResult {
  readonly scanned: number;
  readonly crashed: ReadonlyArray<string>; // wave_ids newly marked crashed
  readonly nextChainHash: string | null;
}

export function isHeartbeatStale(
  entry: WaveProgressEntry,
  nowMs: number,
  staleMs: number,
): boolean {
  const hbMs = Date.parse(entry.heartbeat_at);
  if (!Number.isFinite(hbMs)) return false;
  return nowMs - hbMs > staleMs;
}

export async function runCrashDetectorSweep(
  deps: CrashDetectorDeps,
): Promise<DetectorSweepResult> {
  const now = deps.now ?? (() => new Date());
  const nowMs = now().getTime();
  const latest = await deps.progress.listLatestPerWave();
  const crashedWaveIds: string[] = [];
  let chain: AuditChainState = deps.chainState;

  for (const entry of latest) {
    if (entry.status !== 'running') continue;
    if (!isHeartbeatStale(entry, nowMs, deps.staleHeartbeatMs)) continue;

    const sealed = sealEvent(chain, {
      kind: 'wave.crashed',
      wave_id: entry.wave_id,
      seq: entry.checkpoint_seq + 1,
      extra: {
        last_heartbeat_at: entry.heartbeat_at,
        attempt_number: entry.attempt_number,
      },
    });
    await deps.progress.append({
      wave_id: entry.wave_id,
      agent_id: entry.agent_id,
      tenant_id: entry.tenant_id,
      status: 'crashed',
      checkpoint_label: entry.checkpoint_label,
      checkpoint_payload: entry.checkpoint_payload,
      attempt_number: entry.attempt_number,
      audit_hash: sealed.nextHash,
    });
    chain = { previousHash: sealed.nextHash };
    crashedWaveIds.push(entry.wave_id);
    deps.logger?.warn(
      { wave_id: entry.wave_id, last_heartbeat: entry.heartbeat_at },
      'wave-resilience: crash detected',
    );
  }

  return {
    scanned: latest.length,
    crashed: crashedWaveIds,
    nextChainHash: chain.previousHash,
  };
}
